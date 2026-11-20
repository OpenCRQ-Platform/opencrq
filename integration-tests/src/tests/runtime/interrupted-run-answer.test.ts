import { executeJob } from '@app/back/src/engines/job-runtime/execution-loop';
import { HandlerRegistry } from '@app/back/src/engines/job-runtime/handler-registry';
import { deferralPolicyFor } from '@app/module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../setup/db';
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

const KIND = 'interrupted-run-test-job';
const WORKER_ID = 'interrupted-run-test-worker';

/**
 * A cancel makes the row terminal without waiting for the handler, which keeps reading and writing.
 * The run answering what that one absorbed must not be claimable before the handler has stopped, or
 * a second replica prices the same entity while the first is still writing it. So the queue hands
 * that booking to the runtime, which already waits for the handler before releasing the run's slot.
 */
describe('a run interrupted while it still holds its key', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  const rowsOfKind = () => system().jobs.listJobs({ tenantId, kind: KIND });

  it('should leave the answering run unbooked until the runtime says the handler has stopped', async () => {
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });
    let releaseHandler = (): void => {};
    const handlerHeld = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const registry = new HandlerRegistry();
    registry.register(KIND, async (ctx) => {
      await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {}, interactive: true });
      await system().jobs.cancelJob(ctx.jobId);
      await handlerHeld;
    });
    const claimed = await system().jobs.claimNext(WORKER_ID, [KIND], 30_000, []);
    let answerOwedFor: string | undefined;

    await executeJob({
      job: claimed!,
      workerId: WORKER_ID,
      jobsService: system().jobs,
      handlerRegistry: registry,
      engineSignal: new AbortController().signal,
      deferralPolicy: deferralPolicyFor(1_000),
      abortPollIntervalMs: 20,
      onAnswerOwed: (owedFor) => {
        answerOwedFor = owedFor;
      },
    });

    expect(answerOwedFor).toBe(jobId);
    const whileHandlerRuns = await rowsOfKind();
    expect(whileHandlerRuns.find((row) => row.id === jobId)?.status).toBe('cancelled');
    expect(whileHandlerRuns.filter((row) => row.status === 'queued')).toEqual([]);

    releaseHandler();
    await system().jobs.answerAbsorbedAsk(jobId);

    const answered = (await rowsOfKind()).filter((row) => row.status === 'queued');
    expect(answered).toHaveLength(1);
    expect(answered[0].interactive).toBe(true);
  });

  it('should answer nothing for an interrupted run that absorbed no ask', async () => {
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {} });
    let releaseHandler = (): void => {};
    const handlerHeld = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const registry = new HandlerRegistry();
    registry.register(KIND, async (ctx) => {
      await system().jobs.cancelJob(ctx.jobId);
      await handlerHeld;
    });
    const claimed = await system().jobs.claimNext(WORKER_ID, [KIND], 30_000, []);

    await executeJob({
      job: claimed!,
      workerId: WORKER_ID,
      jobsService: system().jobs,
      handlerRegistry: registry,
      engineSignal: new AbortController().signal,
      deferralPolicy: deferralPolicyFor(1_000),
      abortPollIntervalMs: 20,
    });

    releaseHandler();
    await system().jobs.answerAbsorbedAsk(jobId);

    expect((await rowsOfKind()).filter((row) => row.status === 'queued')).toEqual([]);
  });
});
