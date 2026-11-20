import type { EventOrigin } from '@app/module';
import { LeaseLostError } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const FIXED_DELAY = (delayMs: number) => () => delayMs;

// Simulates the reaper handing the job to a new worker after W1's lease loss.
const handoffTo = async (jobId: string, newWorkerId: string) => {
  await db.execute(sql`
    UPDATE jobs
    SET claimed_by = ${newWorkerId},
        leased_until = now() + interval '30 seconds',
        attempt = attempt + 1
    WHERE id = ${jobId}
  `);
};

describe('jobs lost-race outcomes — stale worker writes are fenced', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('recordSuccess from a stale worker reports recorded:false and leaves the row owned by the new worker', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    await handoffTo(jobId, 'w2');

    const result = await services.withOrigin(SYSTEM_ORIGIN).jobs.recordSuccess(jobId, 'w1');
    expect(result.recorded).toBe(false);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.claimedBy).toBe('w2');
  });

  it('recordFailure from a stale worker reports lost-race AND skips the audit row (no mis-attribution to the new owner\'s attempt)', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 5,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    await handoffTo(jobId, 'w2');

    const outcome = await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'w1 thinks it failed' },
      true,
      FIXED_DELAY(60_000),
    );
    expect(outcome.outcome).toBe('lost-race');

    // No job_errors row: attributing w1's error to w2's attempt number would
    // corrupt the audit trail.
    const errors = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM job_errors WHERE job_id = ${jobId}`,
    );
    expect(Number(errors.rows[0].count)).toBe(0);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.claimedBy).toBe('w2');
  });

  it('recordCancelled from a stale worker reports recorded:false', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    await handoffTo(jobId, 'w2');

    const result = await services.withOrigin(SYSTEM_ORIGIN).jobs.recordCancelled(jobId, 'w1');
    expect(result.recorded).toBe(false);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.claimedBy).toBe('w2');
  });

  it('updateProgress from a stale worker throws LeaseLostError (instead of silently dropping the write)', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    await handoffTo(jobId, 'w2');

    await expect(
      services.withOrigin(SYSTEM_ORIGIN).jobs.updateProgress(jobId, 'w1', { processedTotal: 999 }),
    ).rejects.toBeInstanceOf(LeaseLostError);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.processedTotal).toBe(0);
  });

  it('saveStateSnapshot from a stale worker throws LeaseLostError', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    await handoffTo(jobId, 'w2');

    await expect(
      services.withOrigin(SYSTEM_ORIGIN).jobs.saveStateSnapshot(jobId, 'w1', { cursor: 'stale' }),
    ).rejects.toBeInstanceOf(LeaseLostError);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.stateSnapshot).toBeNull();
  });

  it('releaseClaim from a stale worker reports a lost race (no state change)', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    await handoffTo(jobId, 'w2');

    const result = await services.withOrigin(SYSTEM_ORIGIN).jobs.releaseClaim(jobId, 'w1');
    expect(result.outcome).toBe('lost-race');

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.claimedBy).toBe('w2');
  });
});

describe('jobs releaseClaim — engine-shutdown path does not burn attempts', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('releaseClaim rolls back the attempt bump and re-queues the row for the next claim', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 3,
    });

    const claim1 = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    expect(claim1?.attempt).toBe(1);

    const release = await services.withOrigin(SYSTEM_ORIGIN).jobs.releaseClaim(jobId, 'w1');
    expect(release.outcome).toBe('released');

    const afterRelease = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(afterRelease?.status).toBe('queued');
    expect(afterRelease?.claimedBy).toBeNull();
    expect(afterRelease?.leasedUntil).toBeNull();
    // Rolled back: net zero attempts consumed by the aborted claim.
    expect(afterRelease?.attempt).toBe(0);

    const claim2 = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w2', ['noop'], 30_000);
    expect(claim2?.attempt).toBe(1);
  });

  it('releaseClaim floors attempt at 0 even if called twice in quick succession', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.releaseClaim(jobId, 'w1');

    // Second release is a no-op via the claimed_by fence; the GREATEST() guard
    // would still prevent attempt from going negative.
    const second = await services.withOrigin(SYSTEM_ORIGIN).jobs.releaseClaim(jobId, 'w1');
    expect(second.outcome).toBe('lost-race');

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.attempt).toBe(0);
  });
});
