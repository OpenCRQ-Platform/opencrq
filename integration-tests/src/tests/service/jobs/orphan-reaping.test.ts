import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const expireLease = async (jobId: string) => {
  await db.execute(sql`
    UPDATE jobs SET leased_until = now() - interval '1 second' WHERE id = ${jobId}
  `);
};

describe('jobs orphan reaping', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('reapOrphans re-queues a job whose lease expired (attempt < max)', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 3,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('crashed-worker', ['noop'], 30_000);
    await expireLease(jobId);

    const result = await services.withOrigin(SYSTEM_ORIGIN).jobs.reapOrphans();
    expect(result.requeued).toBe(1);
    expect(result.dlqed).toBe(0);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('queued');
    expect(job?.claimedBy).toBeNull();
    expect(job?.leasedUntil).toBeNull();
  });

  it('reapOrphans sends to DLQ when attempt has already reached max', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 1,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('crashed-worker', ['noop'], 30_000);
    await expireLease(jobId);

    const result = await services.withOrigin(SYSTEM_ORIGIN).jobs.reapOrphans();
    expect(result.requeued).toBe(0);
    expect(result.dlqed).toBe(1);

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.status).toBe('dlq');
  });

  it('reapOrphans ignores jobs whose lease has not expired', async () => {
    await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('healthy-worker', ['noop'], 60_000);

    const result = await services.withOrigin(SYSTEM_ORIGIN).jobs.reapOrphans();
    expect(result.requeued).toBe(0);
    expect(result.dlqed).toBe(0);
  });

  it('a reaped + requeued job becomes claimable again', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 3,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('crashed', ['noop'], 30_000);
    await expireLease(jobId);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.reapOrphans();

    const reclaimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w2', ['noop'], 30_000);
    expect(reclaimed?.id).toBe(jobId);
    expect(reclaimed?.attempt).toBe(2);
  });
});
