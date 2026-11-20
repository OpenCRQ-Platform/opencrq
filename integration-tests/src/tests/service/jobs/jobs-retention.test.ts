import type { EventOrigin, PurgeLimits, TerminalRunStatus } from '@app/module';
import { jobErrors, jobLogs, jobs as jobsTable } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KIND = 'noop';
const DAY_MS = 24 * 60 * 60 * 1000;
// Small enough that reaching the batch cap takes a handful of rows, not a production-sized backlog.
const SMALL_LIMITS: PurgeLimits = { batchSize: 2, maxBatches: 3 };

const jobs = () => services.withOrigin(SYSTEM_ORIGIN).jobs;

// Both `finished_at` and `enqueued_at` are stamped by the database clock, so a run just short of
// its cutoff needs its row moved into the past directly rather than through the service surface.
const backdate = async (jobId: string, daysAgo: number) => {
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  await db.update(jobsTable).set({ finishedAt: at, enqueuedAt: at }).where(eq(jobsTable.id, jobId));
};

const succeed = async (forTenantId: string, daysAgoFinished: number) => {
  const { jobId } = await jobs().enqueueJob({ kind: KIND, tenantId: forTenantId, payload: {} });
  await jobs().claimNext(`worker-${jobId}`, [KIND], 30_000);
  await jobs().recordSuccess(jobId, `worker-${jobId}`);
  await backdate(jobId, daysAgoFinished);
  return jobId;
};

// Inserted directly: enqueue/claim/finish only ever ends on `succeeded`, and one row at a time.
const insertFinishedRuns = async (forTenantId: string, count: number, status: TerminalRunStatus, daysAgoFinished: number) => {
  const finishedAt = new Date(Date.now() - daysAgoFinished * DAY_MS);
  await db.insert(jobsTable).values(Array.from({ length: count }, () => ({
    id: uuidv7(),
    tenantId: forTenantId,
    kind: KIND,
    payload: {},
    payloadHash: uuidv7(),
    status,
    enqueuedAt: finishedAt,
    finishedAt,
  })));
};

const purgeAfterThirtyDays = (forTenantId: string, limits?: PurgeLimits) => jobs().purgeExpiredRuns(forTenantId, {
  runOlderThan: new Date(Date.now() - 30 * DAY_MS),
}, limits);

const countRuns = async (forTenantId: string) =>
  (await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.tenantId, forTenantId))).length;

describe('jobs retention purge', () => {
  let tenantId: string;
  let otherTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createTenantWithAdmin(services);
    tenantId = admin.tenantId;
    otherTenantId = await createTenant(services, admin.userId);
  });

  it('purges a terminal run past the run retention bound, taking its errors and its logs with it', async () => {
    const jobId = await succeed(tenantId, 31);
    await succeed(tenantId, 1);
    await db.insert(jobErrors).values([{ id: uuidv7(), jobId, attempt: 1, retryable: false, message: 'boom' }]);
    await db.insert(jobLogs).values([{ id: uuidv7(), tenantId, jobId, scopeId: jobId, scopeKind: KIND, level: 'trace', message: 'line' }]);

    const purged = await jobs().purgeExpiredRuns(tenantId, {
      runOlderThan: new Date(Date.now() - 30 * DAY_MS),
    });

    expect(purged.runsDeleted).toBe(1);
    expect(await db.select().from(jobsTable).where(eq(jobsTable.id, jobId))).toEqual([]);
    expect(await db.select().from(jobErrors).where(eq(jobErrors.jobId, jobId))).toEqual([]);
    expect(await db.select().from(jobLogs).where(eq(jobLogs.jobId, jobId))).toEqual([]);
  });

  it('leaves a terminal run that has not reached the retention bound yet', async () => {
    const jobId = await succeed(tenantId, 29);

    const purged = await jobs().purgeExpiredRuns(tenantId, {
      runOlderThan: new Date(Date.now() - 30 * DAY_MS),
    });

    expect(purged.runsDeleted).toBe(0);
    expect(await db.select().from(jobsTable).where(eq(jobsTable.id, jobId))).toHaveLength(1);
  });

  it('leaves a running job untouched however old it is, since it never stamps finished_at', async () => {
    const { jobId } = await jobs().enqueueJob({ kind: KIND, tenantId, payload: {} });
    await jobs().claimNext(`worker-${jobId}`, [KIND], 30_000);
    await db.update(jobsTable).set({ enqueuedAt: new Date(Date.now() - 366 * DAY_MS) }).where(eq(jobsTable.id, jobId));

    const purged = await jobs().purgeExpiredRuns(tenantId, {
      runOlderThan: new Date(Date.now() - 30 * DAY_MS),
    });

    expect(purged.runsDeleted).toBe(0);
    const row = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    expect(row).toHaveLength(1);
    expect(row[0]?.status).toBe('running');
  });

  it('does not purge a run of another tenant', async () => {
    const otherJobId = await succeed(otherTenantId, 31);
    await succeed(otherTenantId, 1);

    const purged = await jobs().purgeExpiredRuns(tenantId, {
      runOlderThan: new Date(Date.now() - 30 * DAY_MS),
    });

    expect(purged.runsDeleted).toBe(0);
    expect(await db.select().from(jobsTable).where(eq(jobsTable.id, otherJobId))).toHaveLength(1);
  });

  it('purges past the retention bound in more than one batch', async () => {
    const rowCount = SMALL_LIMITS.batchSize + 3;
    await insertFinishedRuns(tenantId, rowCount, 'succeeded', 31);
    await succeed(tenantId, 1);

    const purged = await purgeAfterThirtyDays(tenantId, SMALL_LIMITS);

    expect(purged.runsDeleted).toBe(rowCount);
    expect(await countRuns(tenantId)).toBe(1);
  });

  it('purges cancelled and dlq runs as it does succeeded ones', async () => {
    await insertFinishedRuns(tenantId, 1, 'cancelled', 31);
    await insertFinishedRuns(tenantId, 1, 'dlq', 31);
    await succeed(tenantId, 1);

    const purged = await purgeAfterThirtyDays(tenantId);

    expect(purged.runsDeleted).toBe(2);
    expect(await countRuns(tenantId)).toBe(1);
  });

  it('leaves a queued job untouched however old it is, since it never stamps finished_at', async () => {
    const { jobId } = await jobs().enqueueJob({ kind: KIND, tenantId, payload: {} });
    await db.update(jobsTable).set({ enqueuedAt: new Date(Date.now() - 366 * DAY_MS) }).where(eq(jobsTable.id, jobId));

    const purged = await purgeAfterThirtyDays(tenantId);

    expect(purged.runsDeleted).toBe(0);
    expect(await db.select().from(jobsTable).where(eq(jobsTable.id, jobId))).toHaveLength(1);
  });

  it('keeps the last terminal run of a kind past the bound, so the kind does not read as never ran', async () => {
    await succeed(tenantId, 62);
    const lastRunId = await succeed(tenantId, 31);

    const purged = await purgeAfterThirtyDays(tenantId);

    expect(purged.runsDeleted).toBe(1);
    expect(await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.tenantId, tenantId))).toEqual([{ id: lastRunId }]);
  });

  it('stops at its batch cap and leaves the rest of the backlog to the next run', async () => {
    const cap = SMALL_LIMITS.batchSize * SMALL_LIMITS.maxBatches;
    await insertFinishedRuns(tenantId, cap + 1, 'succeeded', 31);
    await succeed(tenantId, 1);

    const first = await purgeAfterThirtyDays(tenantId, SMALL_LIMITS);
    expect(first.runsDeleted).toBe(cap);
    expect(await countRuns(tenantId)).toBe(2);

    const second = await purgeAfterThirtyDays(tenantId, SMALL_LIMITS);
    expect(second.runsDeleted).toBe(1);
    expect(await countRuns(tenantId)).toBe(1);
  });
});
