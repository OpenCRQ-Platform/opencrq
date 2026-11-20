import type { EventOrigin } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KIND = 'drata-sync';

describe('connector run history', () => {
  let tenantId: string;
  let adminId: string;
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminId = setup.userId;
    adminOrigin = setup.origin;
  });

  const system = () => services.withOrigin(SYSTEM_ORIGIN).jobs;
  const reader = () => services.withOrigin(adminOrigin).jobs;

  /**
   * `claimNext` takes the oldest queued run of the kind, so a caller asking for a terminal run must
   * have left none behind.
   */
  const runTo = async (status: 'queued' | 'running' | 'succeeded' | 'dlq', payload: Record<string, unknown>) => {
    const { jobId } = await system().enqueueJob({ kind: KIND, tenantId, payload });
    if (status === 'queued') {
      return jobId;
    }
    await system().claimNext('worker-1', [KIND], 30_000);
    if (status === 'running') {
      return jobId;
    }
    if (status === 'succeeded') {
      await system().recordSuccess(jobId, 'worker-1');
      return jobId;
    }
    await system().recordFailure(jobId, 'worker-1', { message: 'Drata API returned 429' }, false, () => 0);
    return jobId;
  };

  it('splits the runs in flight from the runs that stopped', async () => {
    const succeeded = await runTo('succeeded', { b: 2 });
    const queued = await runTo('queued', { a: 1 });

    const inFlight = await reader().listRunsForKind(tenantId, KIND, ['queued', 'running'], 'enqueued-asc', 50);
    const stopped = await reader().listRunsForKind(tenantId, KIND, ['succeeded', 'cancelled', 'dlq'], 'finished-desc', 50);

    expect(inFlight.map((run) => run.id)).toEqual([queued]);
    expect(stopped.map((run) => run.id)).toEqual([succeeded]);
    expect(await reader().countRunsForKind(tenantId, KIND)).toEqual({ active: 1, terminal: 1 });
  });

  it('counts every run, not the ones the capped list returned', async () => {
    await runTo('succeeded', { a: 1 });
    await runTo('succeeded', { b: 2 });
    await runTo('succeeded', { c: 3 });

    const listed = await reader().listRunsForKind(tenantId, KIND, ['succeeded', 'cancelled', 'dlq'], 'finished-desc', 2);

    expect(listed).toHaveLength(2);
    expect((await reader().countRunsForKind(tenantId, KIND)).terminal).toBe(3);
  });

  // The order is orthogonal to the status set, so the ascending display order is exercised here on
  // terminal runs: the queue refuses a second active run of one connector, so fifty cannot be built.
  it('caps on the newest runs even when it shows them oldest first', async () => {
    const first = await runTo('succeeded', { a: 1 });
    const second = await runTo('succeeded', { b: 2 });
    const third = await runTo('succeeded', { c: 3 });

    const listed = await reader().listRunsForKind(tenantId, KIND, ['succeeded'], 'enqueued-asc', 2);

    expect(listed.map((run) => run.id)).toEqual([second, third]);
    expect(listed.map((run) => run.id)).not.toContain(first);
  });

  it('carries each run its own error count, zero included', async () => {
    const failed = await runTo('dlq', { a: 1 });
    const clean = await runTo('succeeded', { b: 2 });

    const runs = await reader().listRunsForKind(tenantId, KIND, ['succeeded', 'cancelled', 'dlq'], 'finished-desc', 50);

    expect(runs.find((run) => run.id === failed)?.errorCount).toBe(1);
    expect(runs.find((run) => run.id === clean)?.errorCount).toBe(0);
  });

  it('reads a failed run its recorded errors', async () => {
    const failed = await runTo('dlq', { a: 1 });

    const errors = await reader().getJobErrors(failed);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ attempt: 1, retryable: false, message: 'Drata API returned 429' });
  });

  it('shows a tenant neither the runs nor the errors of another', async () => {
    const otherTenantId = await createTenant(services, adminId);
    const { jobId } = await system().enqueueJob({ kind: KIND, tenantId: otherTenantId, payload: { a: 1 } });
    await system().claimNext('worker-2', [KIND], 30_000);
    await system().recordFailure(jobId, 'worker-2', { message: 'not yours' }, false, () => 0);

    expect(await reader().listRunsForKind(otherTenantId, KIND, ['succeeded', 'cancelled', 'dlq'], 'finished-desc', 50)).toEqual([]);
    expect(await reader().countRunsForKind(otherTenantId, KIND)).toEqual({ active: 0, terminal: 0 });
    expect(await reader().getJobErrors(jobId)).toEqual([]);
  });
});

describe('what a run says about itself while it waits or works', () => {
  let tenantId: string;
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminOrigin = setup.origin;
  });

  const system = () => services.withOrigin(SYSTEM_ORIGIN).jobs;
  const reader = () => services.withOrigin(adminOrigin).jobs;

  it('carries the step the handler named and the lease the worker holds', async () => {
    const { jobId } = await system().enqueueJob({ kind: KIND, tenantId, payload: { a: 1 } });
    const claimed = await system().claimNext('worker-1', [KIND], 30_000);
    await system().updateProgress(jobId, 'worker-1', { message: 'Fetching page 4 from Microsoft Graph' });

    const [run] = await reader().listRunsForKind(tenantId, KIND, ['running'], 'enqueued-asc', 50);

    expect(run.progressMessage).toBe('Fetching page 4 from Microsoft Graph');
    expect(run.leasedUntil?.getTime()).toBe(claimed?.leasedUntil.getTime());
    expect(run.attempt).toBe(1);
    expect(run.errorMessage).toBeNull();
  });

  it('names the attempt a failed run waits for, when it comes, and why it failed', async () => {
    const { jobId } = await system().enqueueJob({ kind: KIND, tenantId, payload: { a: 1 } });
    await system().claimNext('worker-1', [KIND], 30_000);
    const outcome = await system().recordFailure(jobId, 'worker-1', { message: 'Rate limited (429)' }, true, () => 60_000);

    const [run] = await reader().listRunsForKind(tenantId, KIND, ['queued'], 'enqueued-asc', 50);

    expect(outcome.outcome).toBe('retry');
    expect(run.attempt).toBe(1);
    expect(run.maxAttempts).toBe(3);
    expect(run.errorMessage).toBe('Rate limited (429)');
    expect(run.leasedUntil).toBeNull();
    expect(run.runAfter.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(outcome.outcome === 'retry' && outcome.runAfter.getTime()).toBe(run.runAfter.getTime());
  });
});
