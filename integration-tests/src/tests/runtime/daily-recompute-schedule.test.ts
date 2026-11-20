import type { EventOrigin } from '@app/module';
import { jobs as jobsTable, jobSchedules } from '@app/module';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyScheduleDeps } from '../../../../back/src/features/job-scheduler/daily-schedule';
import { dailyIdempotencyKey, minutesOfDay, nextDailyOccurrence, runDailySchedules } from '../../../../back/src/features/job-scheduler/daily-schedule';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KIND = 'finding-score-recompute';
const AT_0300 = minutesOfDay('03:00');

const system = () => services.withOrigin(SYSTEM_ORIGIN);

const listJobs = (tenantId: string) => db.select().from(jobsTable).where(eq(jobsTable.tenantId, tenantId));

const scheduleRow = async (tenantId: string) =>
  (await db.select().from(jobSchedules).where(and(eq(jobSchedules.tenantId, tenantId), eq(jobSchedules.kind, KIND)))).at(0);

describe('daily recompute schedule against the queue', () => {
  let tenantId: string;
  let otherTenantId: string;
  let nowMs: number;
  let deps: DailyScheduleDeps;

  const tick = (forTenantId: string = tenantId) => runDailySchedules(forTenantId, deps);

  const outcomes = async (forTenantId: string = tenantId) => (await tick(forTenantId)).map((report) => report.outcome);

  const seedAndEnqueue = async (forTenantId: string = tenantId) => {
    expect(await outcomes(forTenantId)).toEqual(['seeded']);
    expect(await outcomes(forTenantId)).toEqual(['enqueued']);
  };

  /** Ends the run the queue hands out, finished at the test's clock rather than the database's. */
  const endNext = async (outcome: 'succeeded' | 'dlq') => {
    const claimed = await system().jobs.claimNext('w1', [KIND], 30_000);
    if (!claimed) {
      throw new Error('nothing queued');
    }
    if (outcome === 'succeeded') {
      await system().jobs.recordSuccess(claimed.id, 'w1');
    } else {
      await system().jobs.recordFailure(claimed.id, 'w1', { message: 'boom' }, false, () => 0);
    }
    await db.update(jobsTable).set({ finishedAt: new Date(nowMs) }).where(eq(jobsTable.id, claimed.id));
  };

  const advance = async () => {
    nowMs = (await scheduleRow(tenantId))?.nextRunAt?.getTime() ?? Number.NaN;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createTenantWithAdmin(services);
    tenantId = admin.tenantId;
    otherTenantId = await createTenant(services, admin.userId);
    nowMs = Date.parse('2026-09-04T10:00:00Z');
    deps = {
      kinds: [KIND],
      atMinutes: AT_0300,
      schedules: system().jobSchedules,
      jobs: system().jobs,
      now: () => nowMs,
    };
  });

  it('seeds a daily row from the configured hour and runs the day due, dated, as the scheduler', async () => {
    await seedAndEnqueue();

    const row = await scheduleRow(tenantId);
    expect(row).toMatchObject({ cadence: 'daily', atMinute: AT_0300, weekday: null, timeZone: 'UTC' });
    const [job] = await listJobs(tenantId);
    expect(job).toMatchObject({
      kind: KIND, status: 'queued', triggeredBy: 'scheduler', idempotencyKey: dailyIdempotencyKey(KIND), payload: { date: '2026-09-04' },
    });
  });

  it('enqueues an occurrence once when two processes tick at the same instant', async () => {
    expect(await outcomes()).toEqual(['seeded']);
    // Both processes read the row before either moves it.
    const schedules = system().jobSchedules;
    const seen = await schedules.getSchedules(tenantId);
    deps = {
      ...deps,
      schedules: {
        getSchedules: () => Promise.resolve(seen),
        seedSchedule: (...args) => schedules.seedSchedule(...args),
        moveNextRun: (...args) => schedules.moveNextRun(...args),
        releaseOccurrence: (...args) => schedules.releaseOccurrence(...args),
      },
    };

    const raced = await Promise.all([outcomes(), outcomes()]);

    expect(raced.flat().toSorted()).toEqual(['claimed_elsewhere', 'enqueued']);
    expect(await listJobs(tenantId)).toHaveLength(1);
  });

  it('does not let the dedup index fold a change-driven ask into the scheduled run', async () => {
    await seedAndEnqueue();

    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: {}, triggeredBy: 'event', interactive: true });

    const jobs = await listJobs(tenantId);
    expect(jobs.map((job) => job.triggeredBy).toSorted()).toEqual(['event', 'scheduler']);
  });

  it('waits for the next day once the day is served, without booking it in the queue', async () => {
    await seedAndEnqueue();
    await endNext('succeeded');
    await advance();

    expect(await outcomes()).toEqual(['rescheduled']);

    expect((await scheduleRow(tenantId))?.nextRunAt?.getTime()).toBe(nextDailyOccurrence(nowMs, tenantId, AT_0300).at.getTime());
    expect((await listJobs(tenantId)).filter((job) => job.status === 'queued')).toHaveLength(0);
  });

  it('retries a failed day once its backoff has passed, and not at every tick before', async () => {
    await seedAndEnqueue();
    await endNext('dlq');
    await advance();

    expect(await outcomes()).toEqual(['rescheduled']);
    const retryAtMs = (await scheduleRow(tenantId))?.nextRunAt?.getTime() ?? 0;
    expect(retryAtMs).toBeGreaterThan(nowMs);
    expect(retryAtMs).toBeLessThan(nextDailyOccurrence(nowMs, tenantId, AT_0300).at.getTime());
    expect(await outcomes()).toEqual([]);

    nowMs = retryAtMs;
    expect(await outcomes()).toEqual(['enqueued']);

    const jobs = await listJobs(tenantId);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.payload)).toEqual([{ date: '2026-09-04' }, { date: '2026-09-04' }]);
  });

  it('gives the day up after its last retry and waits for the next occurrence', async () => {
    await seedAndEnqueue();
    await endNext('dlq');
    // A first failure that leaves no room for a retry before the next occurrence.
    nowMs = nextDailyOccurrence(Date.parse('2026-09-04T10:00:00Z'), tenantId, AT_0300).at.getTime() - 60_000;
    await db.update(jobsTable).set({ finishedAt: new Date(nowMs) }).where(eq(jobsTable.tenantId, tenantId));

    expect(await outcomes()).toEqual(['exhausted']);
    expect((await scheduleRow(tenantId))?.nextRunAt?.getTime()).toBe(nowMs + 60_000);
  });

  it('runs once, not once per missed day, when the platform comes back', async () => {
    await seedAndEnqueue();
    await endNext('succeeded');
    await advance();
    await tick();

    nowMs = Date.parse('2026-09-07T10:00:00Z');
    expect(await outcomes()).toEqual(['enqueued']);
    expect(await outcomes()).toEqual([]);

    const queued = (await listJobs(tenantId)).filter((job) => job.status === 'queued');
    expect(queued.map((job) => job.payload)).toEqual([{ date: '2026-09-07' }]);
  });

  it('gives two tenants two different instants inside the hour', async () => {
    for (const forTenantId of [tenantId, otherTenantId]) {
      await seedAndEnqueue(forTenantId);
    }
    for (let index = 0; index < 2; index += 1) {
      await endNext('succeeded');
    }
    nowMs += 20 * 60 * 1000;
    await tick(tenantId);
    await tick(otherTenantId);

    const mine = (await scheduleRow(tenantId))?.nextRunAt?.getTime();
    const theirs = (await scheduleRow(otherTenantId))?.nextRunAt?.getTime();
    expect(mine).toBeGreaterThanOrEqual(Date.parse('2026-09-05T03:00:00Z'));
    expect(theirs).toBeLessThan(Date.parse('2026-09-05T04:00:00Z'));
    expect(mine).not.toBe(theirs);
  });
});
