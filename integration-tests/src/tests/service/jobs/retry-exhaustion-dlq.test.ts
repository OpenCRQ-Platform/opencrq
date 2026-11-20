import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const IMMEDIATE_RETRY = () => 0;

describe('jobs retry exhaustion → DLQ', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('after max_attempts retryable failures, the job lands in DLQ', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 2,
    });

    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    let outcome = await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'fail-1' },
      true,
      IMMEDIATE_RETRY,
    );
    expect(outcome.outcome).toBe('retry');

    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    outcome = await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'fail-2' },
      true,
      IMMEDIATE_RETRY,
    );
    expect(outcome.outcome).toBe('dlq');

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('dlq');
    expect(job?.attempt).toBe(2);
  });

  it('writes one job_errors row per failure', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 2,
    });

    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'fail-1' },
      true,
      IMMEDIATE_RETRY,
    );
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordFailure(
      jobId,
      'w1',
      { message: 'fail-2' },
      true,
      IMMEDIATE_RETRY,
    );

    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM job_errors WHERE job_id = ${jobId}`,
    );
    expect(Number(result.rows[0].count)).toBe(2);
  });
});
