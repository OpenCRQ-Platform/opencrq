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

describe('jobs crash recovery — state_snapshot preserved across re-claim', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('a job that checkpointed state and crashed is re-claimable with the snapshot intact', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      maxAttempts: 3,
    });
    const claimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('crashed-worker', ['noop'], 30_000);
    expect(claimed?.stateSnapshot).toBeNull();

    await services.withOrigin(SYSTEM_ORIGIN).jobs.saveStateSnapshot(jobId, 'crashed-worker', {
      cursor: 'abc-def',
      pagesProcessed: 42,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.updateProgress(jobId, 'crashed-worker', {
      processedTotal: 42,
      expectedTotal: 100,
    });

    await expireLease(jobId);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.reapOrphans();

    const reclaimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('healthy-worker', ['noop'], 30_000);
    expect(reclaimed?.id).toBe(jobId);
    expect(reclaimed?.stateSnapshot).toEqual({ cursor: 'abc-def', pagesProcessed: 42 });
    expect(reclaimed?.processedTotal).toBe(42);
    expect(reclaimed?.expectedTotal).toBe(100);
    expect(reclaimed?.attempt).toBe(2);
  });

  it('progress counters are visible to consumers (admin tRPC) between claim and crash', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.updateProgress(jobId, 'w1', {
      processedTotal: 17,
      expectedTotal: 200,
    });

    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(jobId);
    expect(job?.processedTotal).toBe(17);
    expect(job?.expectedTotal).toBe(200);
    expect(job?.status).toBe('running');
  });
});
