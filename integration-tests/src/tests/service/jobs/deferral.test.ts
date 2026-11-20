import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KEY = 'scenario-42';

const jobs = () => services.withOrigin(SYSTEM_ORIGIN).jobs;

const POLICY = { minDelayMs: 5_000, maxDelayMs: 12_000, maxWaitMs: 60_000 };

let tenantId: string;

const bookAndClaim = async () => {
  const { jobId } = await jobs().enqueueJob({ kind: 'noop', tenantId, payload: {}, idempotencyKey: KEY, maxAttempts: 3 });
  await jobs().claimNext('w1', ['noop'], 30_000);
  return jobId;
};

const startedSecondsAgo = async (jobId: string, seconds: number) => {
  await db.execute(sql`UPDATE jobs SET started_at = now() - make_interval(secs => ${seconds}) WHERE id = ${jobId}`);
};

describe('jobs deferral', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('should put the run back in the queue without an error or a spent attempt', async () => {
    const jobId = await bookAndClaim();

    const outcome = await jobs().deferRun(jobId, 'w1', POLICY);

    expect(outcome).toMatchObject({ outcome: 'deferred', delayMs: POLICY.minDelayMs });
    const job = await jobs().getJob(jobId);
    expect(job?.status).toBe('queued');
    expect(job?.attempt).toBe(0);
    expect(job?.claimedBy).toBeNull();
    expect(job?.leasedUntil).toBeNull();
    expect(job?.errorMessage).toBeNull();
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now() + 1_000);
    const errors = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM job_errors WHERE job_id = ${jobId}`);
    expect(Number(errors.rows[0]?.count)).toBe(0);
  });

  it('should clear the ask the run absorbed, since the next attempt starts clean and answers it', async () => {
    const jobId = await bookAndClaim();
    await jobs().enqueueJob({ kind: 'noop', tenantId, payload: {}, idempotencyKey: KEY });
    const before = await jobs().getJob(jobId);
    expect(before?.absorbedAsk).toBe(true);

    await jobs().deferRun(jobId, 'w1', POLICY);

    const job = await jobs().getJob(jobId);
    expect(job?.status).toBe('queued');
    expect(job?.absorbedAsk).toBe(false);
  });

  it('should give the attempt that answers an ask somebody waits on the awaited window', async () => {
    const jobId = await bookAndClaim();
    await jobs().enqueueJob({ kind: 'noop', tenantId, payload: {}, idempotencyKey: KEY, interactive: true });
    expect((await jobs().getJob(jobId))?.interactive).toBe(false);

    await jobs().deferRun(jobId, 'w1', POLICY);

    const job = await jobs().getJob(jobId);
    expect(job?.interactive).toBe(true);
    expect(job?.absorbedAsk).toBe(false);
    expect(job?.absorbedAskInteractive).toBe(false);
  });

  it('should cancel the run instead of deferring it when a cancel reached it during the attempt', async () => {
    const jobId = await bookAndClaim();
    await jobs().cancelJob(jobId);

    const outcome = await jobs().deferRun(jobId, 'w1', POLICY);

    expect(outcome.outcome).toBe('cancelled');
    const job = await jobs().getJob(jobId);
    expect(job?.status).toBe('cancelled');
    expect(job?.finishedAt).not.toBeNull();
  });

  it('should wait a quarter of the time the run has already waited for its inputs', async () => {
    const jobId = await bookAndClaim();
    await startedSecondsAgo(jobId, 40);

    const outcome = await jobs().deferRun(jobId, 'w1', POLICY);

    if (outcome.outcome !== 'deferred') {
      expect.unreachable(`the run was not deferred: ${outcome.outcome}`);
    }
    expect(outcome.delayMs).toBeGreaterThanOrEqual(10_000);
    expect(outcome.delayMs).toBeLessThan(POLICY.maxDelayMs);
  });

  it('should wait no longer than the longest delay of the policy', async () => {
    const jobId = await bookAndClaim();
    await startedSecondsAgo(jobId, 59);

    const outcome = await jobs().deferRun(jobId, 'w1', POLICY);

    expect(outcome).toMatchObject({ outcome: 'deferred', delayMs: POLICY.maxDelayMs });
  });

  it('should not count the time the run spent queued before its first start', async () => {
    const jobId = await bookAndClaim();
    await db.execute(sql`UPDATE jobs SET enqueued_at = now() - interval '61 seconds' WHERE id = ${jobId}`);

    const outcome = await jobs().deferRun(jobId, 'w1', POLICY);

    expect(outcome.outcome).toBe('deferred');
  });

  it('should leave the run running once it has waited for its inputs longer than the policy allows', async () => {
    const jobId = await bookAndClaim();
    await startedSecondsAgo(jobId, 61);

    const outcome = await jobs().deferRun(jobId, 'w1', POLICY);

    expect(outcome.outcome).toBe('expired');
    const job = await jobs().getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.claimedBy).toBe('w1');
  });

  it('should lose the race when another worker owns the run', async () => {
    const jobId = await bookAndClaim();

    const outcome = await jobs().deferRun(jobId, 'w2', POLICY);

    expect(outcome.outcome).toBe('lost-race');
    const job = await jobs().getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.claimedBy).toBe('w1');
  });
});
