import type { EventOrigin } from '@app/module';
import { jobs as jobsTable } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

// The application clock is moved ahead of the database's, as on two hosts whose clocks drift apart.
const APPLICATION_CLOCK_AHEAD_MS = 60_000;

describe('jobs run_after stamped by the database clock', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should claim a job queued without runAfter at once when the application clock runs ahead', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + APPLICATION_CLOCK_AHEAD_MS);

    const enqueue = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({ kind: 'noop', tenantId, payload: {} });
    const claimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('worker-1', ['noop'], 30_000);

    expect(claimed?.id).toBe(enqueue.jobId);
  });

  it('should store the database now() as run_after when no runAfter is given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + APPLICATION_CLOCK_AHEAD_MS);

    const enqueue = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({ kind: 'noop', tenantId, payload: {} });
    const [row] = await db
      .select({ due: sql<boolean>`${jobsTable.runAfter} <= now()` })
      .from(jobsTable)
      .where(eq(jobsTable.id, enqueue.jobId));

    expect(row?.due).toBe(true);
  });

  it('should keep an explicit runAfter unchanged', async () => {
    const runAfter = new Date(Date.now() + APPLICATION_CLOCK_AHEAD_MS);

    const enqueue = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({ kind: 'noop', tenantId, payload: {}, runAfter });
    const job = await services.withOrigin(SYSTEM_ORIGIN).jobs.getJob(enqueue.jobId);
    const claimed = await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('worker-1', ['noop'], 30_000);

    expect(job?.runAfter.getTime()).toBe(runAfter.getTime());
    expect(claimed).toBeUndefined();
  });
});
