import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const FIXED_DELAY = (delayMs: number) => () => delayMs;

describe('jobs retry on error', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('retryable failure re-queues the job with bumped run_after', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 3,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    const outcome = await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'transient' },
      true,
      FIXED_DELAY(60_000),
    );

    expect(outcome.outcome).toBe('retry');

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('queued');
    expect(job?.attempt).toBe(1);
    expect(job?.claimedBy).toBeNull();
    expect(job?.leasedUntil).toBeNull();
    expect(job?.errorMessage).toBe('transient');
    expect(job?.runAfter).toBeInstanceOf(Date);
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it('non-retryable failure sends the job to DLQ immediately', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 5,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    const outcome = await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'fatal', stack: 'Error\n  at ...' },
      false,
      FIXED_DELAY(60_000),
    );

    expect(outcome.outcome).toBe('dlq');

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('dlq');
    expect(job?.finishedAt).toBeInstanceOf(Date);
    expect(job?.errorMessage).toBe('fatal');
  });

  it('records a job_errors row with the failure metadata', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 3,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'boom', stack: 'Error: boom\n  at fn' },
      true,
      FIXED_DELAY(60_000),
    );

    const errorsResult = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM job_errors WHERE job_id = ${jobId}`,
    );

    expect(Number(errorsResult.rows[0].count)).toBe(1);
  });
});
