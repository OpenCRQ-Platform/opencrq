import type { EnqueueJobOptions, JobScheduleRow, JobStatus } from '@app/module';
import { describe, expect, it } from 'vitest';
import type { DailyScheduleDeps } from './daily-schedule';
import {
  dailyIdempotencyKey,
  lastDueOccurrence,
  minutesOfDay,
  nextDailyOccurrence,
  RECHECK_MS,
  RETRY_BASE_MS,
  runDailySchedules,
} from './daily-schedule';

const KIND = 'finding-score-recompute';
const AT_0300 = minutesOfDay('03:00');
const TENANT = '9f0b6a3c-1d4e-7b2a-8c5d-3e6f01234567';
const HOUR_MS = 60 * 60 * 1000;

const at = (iso: string): number => Date.parse(iso);

/**
 * The schedule row and the queue, each on its own rules: the row moves only from the next run the
 * caller read, the queue keeps one active row per idempotency key, stamps a finish time on every
 * terminal transition, and hands a row out at once since nothing is booked ahead of its hour.
 */
const createScheduler = (startMs: number) => {
  let currentMs = startMs;
  let row: JobScheduleRow | undefined;
  const rows: Array<{ status: JobStatus, finishedAt: Date | null }> = [];
  const enqueued: Array<{ atMs: number, options: EnqueueJobOptions }> = [];
  let failNextEnqueue = false;

  const deps: DailyScheduleDeps = {
    kinds: [KIND],
    atMinutes: AT_0300,
    schedules: {
      getSchedules: () => Promise.resolve(row ? [{ ...row }] : []),
      seedSchedule: (tenantId, kind, schedule, nextRunAt) => {
        row = {
          id: row?.id ?? 'row-1', tenantId, kind, ...schedule, nextRunAt, createdAt: new Date(currentMs), updatedAt: new Date(currentMs),
        };
        return Promise.resolve();
      },
      moveNextRun: (seen, to) => {
        if (!row || row.nextRunAt?.getTime() !== seen.nextRunAt?.getTime()) {
          return Promise.resolve(false);
        }
        row.nextRunAt = to;
        return Promise.resolve(true);
      },
      releaseOccurrence: (seen, claimed) => {
        if (row && row.nextRunAt?.getTime() === claimed.getTime()) {
          row.nextRunAt = seen.nextRunAt;
        }
        return Promise.resolve();
      },
    },
    jobs: {
      listRecentScheduledBookings: (_tenantId, _kind, limit) =>
        Promise.resolve([...rows].reverse().slice(0, limit).map(({ status, finishedAt }) => ({ status, finishedAt }))),
      enqueueJob: (options) => {
        if (failNextEnqueue) {
          failNextEnqueue = false;
          return Promise.reject(new Error('queue down'));
        }
        const alreadyExisted = rows.some((candidate) => candidate.status === 'queued' || candidate.status === 'running');
        if (!alreadyExisted) {
          rows.push({ status: 'queued', finishedAt: null });
          enqueued.push({ atMs: currentMs, options });
        }
        return Promise.resolve({ jobId: 'job', alreadyExisted });
      },
    },
    now: () => currentMs,
  };

  const nextRunAtMs = (): number => row?.nextRunAt?.getTime() ?? Number.NaN;

  return {
    deps,
    rows,
    enqueued,
    nextRunAtMs,
    setNow: (ms: number) => {
      currentMs = ms;
    },
    failNextEnqueue: () => {
      failNextEnqueue = true;
    },
    tick: () => runDailySchedules(TENANT, deps),
    /** Moves the clock to the row's next run and ticks there. */
    advance: () => {
      currentMs = nextRunAtMs();
      return runDailySchedules(TENANT, deps);
    },
    end: (status: JobStatus): boolean => {
      const queued = rows.find((candidate) => candidate.status === 'queued');
      if (queued) {
        queued.status = status;
        queued.finishedAt = new Date(currentMs);
      }
      return queued !== undefined;
    },
  };
};

/** A tenant whose 09-03 is served, the clock on its 09-04 occurrence, that run just enqueued. */
const scheduledOn0904 = async () => {
  const scheduler = createScheduler(at('2026-09-03T10:00:00Z'));
  await scheduler.tick();
  await scheduler.tick();
  scheduler.end('succeeded');
  await scheduler.advance();
  const dueAtMs = lastDueOccurrence(at('2026-09-04T23:00:00Z'), TENANT, AT_0300).at.getTime();
  expect(scheduler.nextRunAtMs()).toBe(dueAtMs);
  await scheduler.advance();
  return { scheduler, dueAtMs };
};

describe('daily occurrence math', () => {
  it('should place a tenant at a fixed offset inside the hour that follows the configured one', () => {
    const due = lastDueOccurrence(at('2026-09-04T23:00:00Z'), TENANT, AT_0300);

    expect(due.date).toBe('2026-09-04');
    expect(due.at.getTime()).toBeGreaterThanOrEqual(at('2026-09-04T03:00:00Z'));
    expect(due.at.getTime()).toBeLessThan(at('2026-09-04T04:00:00Z'));
    expect(lastDueOccurrence(at('2026-11-17T23:00:00Z'), TENANT, AT_0300).at.getTime() % 86_400_000)
      .toBe(due.at.getTime() % 86_400_000);
  });

  it('should spread tenants across the hour rather than releasing them together', () => {
    const instants = new Set(['tenant-a', 'tenant-b', 'tenant-c']
      .map((tenantId) => lastDueOccurrence(at('2026-09-04T23:00:00Z'), tenantId, AT_0300).at.getTime()));

    expect(instants.size).toBe(3);
  });

  it('should walk back to the previous day before the hour has come', () => {
    expect(lastDueOccurrence(at('2026-09-04T01:00:00Z'), TENANT, AT_0300).date).toBe('2026-09-03');
  });

  it('should never hand back an occurrence that has not come, whatever the hour and the spread', () => {
    const nowMs = at('2026-09-04T00:30:00Z');
    for (const hour of ['00:00', '03:00', '12:45', '23:30', '23:59']) {
      for (const tenantId of ['tenant-a', 'tenant-b', TENANT]) {
        const due = lastDueOccurrence(nowMs, tenantId, minutesOfDay(hour));
        expect(due.at.getTime()).toBeLessThanOrEqual(nowMs);
        expect(nowMs - due.at.getTime()).toBeLessThan(2 * 86_400_000);
      }
    }
  });

  it('should hand back the occurrence of the day after the last one due, still ahead', () => {
    const nowMs = at('2026-09-04T23:00:00Z');
    const due = lastDueOccurrence(nowMs, TENANT, AT_0300);
    const next = nextDailyOccurrence(nowMs, TENANT, AT_0300);

    expect(next.date).toBe('2026-09-05');
    expect(next.at.getTime() - due.at.getTime()).toBe(86_400_000);
    expect(next.at.getTime()).toBeGreaterThan(nowMs);
  });
});

describe('daily schedule', () => {
  it('should seed the row from the configured hour, due at once', async () => {
    const scheduler = createScheduler(at('2026-09-04T10:00:00Z'));

    const reports = await scheduler.tick();

    expect(reports.map((report) => report.outcome)).toEqual(['seeded']);
    expect(scheduler.nextRunAtMs()).toBe(at('2026-09-04T10:00:00Z'));
    expect(scheduler.enqueued).toHaveLength(0);
  });

  it('should run the day already due when nothing ran, dated, as the scheduler', async () => {
    const scheduler = createScheduler(at('2026-09-04T10:00:00Z'));
    await scheduler.tick();

    const reports = await scheduler.tick();

    expect(reports.map((report) => report.outcome)).toEqual(['enqueued']);
    expect(scheduler.enqueued[0]?.options).toMatchObject({
      kind: KIND, tenantId: TENANT, payload: { date: '2026-09-04' }, idempotencyKey: dailyIdempotencyKey(KIND), triggeredBy: 'scheduler',
    });
    expect(scheduler.enqueued[0]?.options.runAfter).toBeUndefined();
    expect(scheduler.nextRunAtMs()).toBe(at('2026-09-04T10:00:00Z') + RECHECK_MS);
  });

  it('should hold the row back, rather than read it each tick, while the run is in flight', async () => {
    const scheduler = createScheduler(at('2026-09-04T10:00:00Z'));
    await scheduler.tick();
    await scheduler.tick();

    expect(await scheduler.tick()).toEqual([]);
    const reports = await scheduler.advance();

    expect(reports.map((report) => report.outcome)).toEqual(['pending']);
    expect(scheduler.nextRunAtMs()).toBe(at('2026-09-04T10:00:00Z') + 2 * RECHECK_MS);
    expect(scheduler.rows).toHaveLength(1);
  });

  it('should wait for the next day once the day is served', async () => {
    const scheduler = createScheduler(at('2026-09-04T10:00:00Z'));
    await scheduler.tick();
    await scheduler.tick();
    scheduler.end('succeeded');

    const reports = await scheduler.advance();

    expect(reports.map((report) => report.outcome)).toEqual(['rescheduled']);
    expect(scheduler.nextRunAtMs()).toBe(nextDailyOccurrence(at('2026-09-04T10:00:00Z'), TENANT, AT_0300).at.getTime());
    expect(scheduler.enqueued).toHaveLength(1);
  });

  it('should seed the row again when the configured hour changes', async () => {
    const scheduler = createScheduler(at('2026-09-04T10:00:00Z'));
    await scheduler.tick();
    scheduler.deps.atMinutes = minutesOfDay('05:00');

    const reports = await scheduler.tick();

    expect(reports.map((report) => report.outcome)).toEqual(['seeded']);
    expect(scheduler.enqueued).toHaveLength(0);
  });

  it('should hand the occurrence back when the queue refuses it', async () => {
    const scheduler = createScheduler(at('2026-09-04T10:00:00Z'));
    await scheduler.tick();
    scheduler.failNextEnqueue();

    const reports = await scheduler.tick();

    expect(reports).toEqual([{ kind: KIND, outcome: 'failed', error: new Error('queue down') }]);
    expect(scheduler.nextRunAtMs()).toBe(at('2026-09-04T10:00:00Z'));
    await scheduler.tick();
    expect(scheduler.enqueued).toHaveLength(1);
  });

  it('should still serve the next kinds when one keeps failing', async () => {
    const scheduler = createScheduler(at('2026-09-04T10:00:00Z'));
    const { schedules } = scheduler.deps;
    const deps: DailyScheduleDeps = {
      ...scheduler.deps,
      kinds: ['broken-recompute', KIND],
      schedules: {
        ...schedules,
        seedSchedule: (tenantId, kind, schedule, nextRunAt) => (kind === KIND
          ? schedules.seedSchedule(tenantId, kind, schedule, nextRunAt)
          : Promise.reject(new Error('row refused'))),
      },
    };

    await runDailySchedules(TENANT, deps);
    const reports = await runDailySchedules(TENANT, deps);

    expect(reports.map((report) => [report.kind, report.outcome])).toEqual([['broken-recompute', 'failed'], [KIND, 'enqueued']]);
    expect(scheduler.enqueued).toHaveLength(1);
  });

  it('should hold the first retry of a failed day back by the base delay', async () => {
    const { scheduler, dueAtMs } = await scheduledOn0904();
    // Failing as soon as it is handed out, so nothing but the base delay separates the retry.
    scheduler.end('dlq');

    await scheduler.advance();

    expect(scheduler.enqueued.map(({ atMs }) => atMs - dueAtMs).slice(-2)).toEqual([0, RETRY_BASE_MS]);
    expect(scheduler.enqueued.at(-1)?.options.payload).toEqual({ date: '2026-09-04' });
  });

  it('should double the distance covered since the occurrence on each further failure', async () => {
    const { scheduler, dueAtMs } = await scheduledOn0904();

    const offsets: Array<number> = [];
    while (offsets.length < 4) {
      // Each attempt fails the instant it is handed out, so the distance covered is its own offset.
      scheduler.end('dlq');
      const before = scheduler.enqueued.length;
      while (scheduler.enqueued.length === before) {
        await scheduler.advance();
      }
      offsets.push((scheduler.enqueued.at(-1)?.atMs ?? 0) - dueAtMs);
    }

    expect(offsets).toEqual([RETRY_BASE_MS, RETRY_BASE_MS * 2, RETRY_BASE_MS * 4, RETRY_BASE_MS * 8]);
  });

  it('should retry a first failure landing too late to be doubled, while the day has room', async () => {
    const { scheduler, dueAtMs } = await scheduledOn0904();
    // Half a day of queue wait before the failure: twice that would land past the next occurrence.
    const failedAtMs = dueAtMs + 13 * HOUR_MS;
    scheduler.setNow(failedAtMs);
    scheduler.end('dlq');

    const reports = await scheduler.tick();

    expect(reports.map((report) => report.outcome)).toEqual(['rescheduled']);
    expect(scheduler.nextRunAtMs()).toBe(failedAtMs + RETRY_BASE_MS);
  });

  it('should give the day up when even a first failure leaves no room before the next occurrence', async () => {
    const { scheduler, dueAtMs } = await scheduledOn0904();
    scheduler.setNow(dueAtMs + 24 * HOUR_MS - RETRY_BASE_MS / 2);
    scheduler.end('dlq');

    const reports = await scheduler.tick();

    expect(reports.map((report) => report.outcome)).toEqual(['exhausted']);
    expect(scheduler.nextRunAtMs()).toBe(dueAtMs + 24 * HOUR_MS);
  });

  it('should give the day up rather than retry past the next occurrence', async () => {
    const { scheduler, dueAtMs } = await scheduledOn0904();
    scheduler.end('dlq');
    await scheduler.advance();
    // The retry waits half a day before failing in its turn: twice that lands past the next one.
    scheduler.setNow(dueAtMs + 13 * HOUR_MS);
    scheduler.end('dlq');

    const reports = await scheduler.tick();

    expect(reports.map((report) => report.outcome)).toEqual(['exhausted']);
    expect(scheduler.nextRunAtMs()).toBe(dueAtMs + 24 * HOUR_MS);
  });

  it('should cover a whole failed day in a handful of runs rather than one per tick', async () => {
    const { scheduler, dueAtMs } = await scheduledOn0904();
    const before = scheduler.enqueued.length;

    for (let minute = 0; minute < 24 * 60; minute += 1) {
      scheduler.setNow(dueAtMs + minute * 60_000);
      scheduler.end('dlq');
      await scheduler.tick();
    }

    expect(scheduler.enqueued.length - before).toBeLessThan(12);
    expect(scheduler.nextRunAtMs()).toBe(dueAtMs + 24 * HOUR_MS);
  });

  it('should run once when the platform comes back after a single missed hour', async () => {
    const scheduler = createScheduler(at('2026-09-02T10:00:00Z'));
    await scheduler.tick();
    await scheduler.tick();
    scheduler.end('succeeded');
    await scheduler.advance();

    scheduler.setNow(at('2026-09-03T10:00:00Z'));
    await scheduler.tick();
    await scheduler.tick();

    expect(scheduler.enqueued.map(({ options }) => options.payload)).toEqual([{ date: '2026-09-02' }, { date: '2026-09-03' }]);
  });

  it('should run once, not twice, when the outage spans more than one hour', async () => {
    const scheduler = createScheduler(at('2026-09-02T10:00:00Z'));
    await scheduler.tick();
    await scheduler.tick();
    scheduler.end('succeeded');
    await scheduler.advance();

    scheduler.setNow(at('2026-09-04T10:00:00Z'));
    await scheduler.tick();
    scheduler.end('succeeded');
    await scheduler.advance();

    expect(scheduler.enqueued.map(({ options }) => options.payload)).toEqual([{ date: '2026-09-02' }, { date: '2026-09-04' }]);
    expect(scheduler.nextRunAtMs()).toBe(nextDailyOccurrence(at('2026-09-04T10:00:00Z'), TENANT, AT_0300).at.getTime());
  });
});
