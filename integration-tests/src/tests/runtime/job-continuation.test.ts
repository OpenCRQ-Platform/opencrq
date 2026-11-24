import { executeJob } from '@app/back/src/engines/job-runtime/execution-loop';
import { HandlerRegistry } from '@app/back/src/engines/job-runtime/handler-registry';
import type { JobHandler } from '@app/module';
import { deferralPolicyFor } from '@app/module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTenantWithAdmin } from '../../helpers/factories';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The execution loop reaches the backend config through its logger, which the shared setup stubs.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const services = createTestServices(db);
const system = () => services.withOrigin({ type: 'system' });

const KIND = 'continuation-test-job';
const WORKER_ID = 'continuation-test-worker';

/**
 * A run cannot book its own follow-up: the dedupe folds any enqueue into a queued or running row of
 * the same key, and while the handler runs that row is its own. These read the `jobs` table because
 * that is where the defect was invisible, the handler having been told its enqueue had landed.
 */
describe('a run that leaves work behind its own bound', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  const runOnce = async (handler: JobHandler): Promise<void> => {
    const registry = new HandlerRegistry();
    registry.register(KIND, handler);
    const claimed = await system().jobs.claimNext(WORKER_ID, [KIND], 30_000, []);
    expect(claimed).not.toBeNull();
    await executeJob({
      job: claimed!,
      workerId: WORKER_ID,
      jobsService: system().jobs,
      handlerRegistry: registry,
      engineSignal: new AbortController().signal,
      deferralPolicy: deferralPolicyFor(1_000),
    });
  };

  const rowsOfKind = () => system().jobs.listJobs({ tenantId, kind: KIND });

  it('should leave a queued row behind once its own row is no longer running', async () => {
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });

    await runOnce(() => Promise.resolve({ continuation: true }));

    const rows = await rowsOfKind();
    expect(rows.find((row) => row.id === jobId)?.status).toBe('partial');
    const queued = rows.filter((row) => row.status === 'queued');
    expect(queued).toHaveLength(1);
    expect(queued[0].id).not.toBe(jobId);
  });

  // An interrupted segment read as succeeded tells the operator the pass is over while its follow-up
  // still has the rest to do. Only the segment that ends the pass is a success.
  it('should end the segment that handed work on as partial and the one that ends the pass as succeeded', async () => {
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });
    await runOnce(() => Promise.resolve({ continuation: true, state: { startIndex: 59_500 } }));
    const [queued] = (await rowsOfKind()).filter((row) => row.status === 'queued');

    await runOnce(() => Promise.resolve());

    const rows = await rowsOfKind();
    expect(rows.find((row) => row.id === jobId)?.status).toBe('partial');
    expect(rows.find((row) => row.id === queued.id)?.status).toBe('succeeded');
  });

  it('should swallow an enqueue the handler makes for itself and still queue the runtime continuation', async () => {
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });
    let bookedJobId = '';
    let queuedDuringRun: Array<string> = [];

    await runOnce(async () => {
      ({ jobId: bookedJobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} }));
      queuedDuringRun = (await rowsOfKind()).filter((row) => row.status === 'queued').map((row) => row.id);
      return { continuation: true };
    });

    expect(bookedJobId).toBe(jobId);
    expect(queuedDuringRun).toEqual([]);
    const queued = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(queued).toHaveLength(1);
    expect(queued[0].id).not.toBe(jobId);
  });

  it('should hand the follow-up the state the run stopped at, which the new row would otherwise start without', async () => {
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });

    await runOnce(() => Promise.resolve({ continuation: true, state: { startIndex: 59_500 } }));

    const [queued] = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(queued.stateSnapshot).toEqual({ startIndex: 59_500 });
  });

  it('should let the follow-up resume where its predecessor stopped', async () => {
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });
    await runOnce(() => Promise.resolve({ continuation: true, state: { startIndex: 59_500 } }));

    let resumedFrom: unknown;
    await runOnce((ctx) => {
      resumedFrom = ctx.state;
      return Promise.resolve();
    });

    expect(resumedFrom).toEqual({ startIndex: 59_500 });
  });

  it('should grant the follow-up the bounds of the run that booked it, not the queue defaults', async () => {
    await system().jobs.enqueueJob({
      kind: KIND,
      tenantId,
      payload: {},
      maxRuntimeMs: 30 * 60 * 1000,
      maxAttempts: 5,
    });

    await runOnce(() => Promise.resolve({ continuation: true }));

    const [queued] = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(queued).toMatchObject({ maxRuntimeMs: 30 * 60 * 1000, maxAttempts: 5 });
  });

  // Settling a run and booking its follow-up must look like one step from outside, or an
  // enqueue landing between them takes the follow-up's place and the crawl restarts from zero. A lock
  // on the tenant row holds the settle open at its successor's insert, where the foreign key check
  // waits on it, so the test can look into that instant.
  it('should keep the resume state when an enqueue lands while the run settles', async () => {
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });
    expect(await system().jobs.claimNext(WORKER_ID, [KIND], 30_000, [])).not.toBeNull();

    const waitingLocks = async (): Promise<number> => {
      const { rows } = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      );
      return rows[0].count;
    };
    const untilWaiting = async (count: number): Promise<void> => {
      await vi.waitFor(async () => {
        expect(await waitingLocks()).toBeGreaterThanOrEqual(count);
      }, { timeout: 5_000, interval: 20 });
    };

    const holder = await pool.connect();
    let settle: Promise<unknown> = Promise.resolve();
    let concurrentEnqueue: Promise<unknown> = Promise.resolve();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);

      settle = system().jobs.recordSuccess(jobId, WORKER_ID, { state: { startIndex: 59_500 } });
      await untilWaiting(1);
      const activeMidSettle = (await rowsOfKind()).filter((row) => row.status === 'running' || row.status === 'queued');
      expect(activeMidSettle.map((row) => row.id)).toEqual([jobId]);
      concurrentEnqueue = system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {}, interactive: true });
      await untilWaiting(2);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await Promise.allSettled([settle, concurrentEnqueue]);
    }
    await Promise.all([settle, concurrentEnqueue]);

    const queued = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(queued).toHaveLength(1);
    expect(queued[0].stateSnapshot).toEqual({ startIndex: 59_500 });
  });

  // An ask absorbed mid-crawl and the continuation both want the same key. Answering the ask as
  // the window ends would put a clean row in the queue for the continuation to fold into, and the
  // crawl would lose the index it had reached and start over.
  it('should carry an ask absorbed mid-chain to the end rather than restart the chain', async () => {
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });

    await runOnce(async () => {
      await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {}, interactive: true });
      return { continuation: true, state: { startIndex: 59_500 } };
    });

    const resumed = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(resumed).toHaveLength(1);
    expect(resumed[0].stateSnapshot).toEqual({ startIndex: 59_500 });

    await runOnce(() => Promise.resolve());

    const answering = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(answering).toHaveLength(1);
    expect(answering[0].stateSnapshot).toBeNull();
    expect(answering[0].interactive).toBe(true);
  });

  // The next page of the same run, so unlike the run that answers an absorbed ask it keeps both
  // what the run was booked under and whether anybody is still waiting on it.
  it('should carry who asked and whether anybody waits over to the continuation', async () => {
    await system().jobs.enqueueJob({
      kind: KIND,
      tenantId,
      payload: {},
      triggeredBy: 'user',
      triggeredById: 'user-1',
      interactive: true,
    });

    await runOnce(() => Promise.resolve({ continuation: true }));

    const [queued] = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(queued).toMatchObject({ triggeredBy: 'user', triggeredById: 'user-1', interactive: true });
  });

  it('should leave nothing queued when the run asks for no continuation', async () => {
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });

    await runOnce(() => Promise.resolve());

    expect((await rowsOfKind()).filter((row) => row.status === 'queued')).toEqual([]);
  });
});
