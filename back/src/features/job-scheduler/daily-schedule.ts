import type { EnqueueJobOptions, EnqueueJobResult, JobScheduleRow, Schedule, ScheduledBooking } from '@app/module';
import { ACTIVE_JOB_STATUSES } from '@app/module';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A shared instant would put every tenant's full recompute against a `jobs.max_concurrent` that is
 * global to every job kind, so tenants are released across the hour that follows theirs.
 */
const SPREAD_MS = 60 * 60 * 1000;

/**
 * How long a failed day waits before its first retry. Each later one waits twice as long as the
 * distance already covered since the occurrence, so a failure that clears within the day is caught
 * while a failure that never clears costs a handful of runs rather than one per check.
 */
export const RETRY_BASE_MS = 15 * 60 * 1000;

/**
 * How long a row whose run is enqueued or in flight waits before its bookings are read again: it
 * bounds how late a retry starts, against one read per tick for as long as a run lasts.
 */
export const RECHECK_MS = 15 * 60 * 1000;

/**
 * Two ended bookings bear on the decision: the last one, and whether a second has ended since the
 * occurrence, which is what tells a first failure from a chain already retried. The third row is
 * slack for one another process added between this read and its own write: reading one row too many
 * is free, one too few would misread how long the day has already been retried for.
 */
const BOOKING_HISTORY_DEPTH = 3;

const ACTIVE = new Set<string>(ACTIVE_JOB_STATUSES);

export interface DailyOccurrence {
  /** A UTC calendar date: the scoring inputs that move with the clock alone move in whole UTC days. */
  date: string,
  at: Date,
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const midnightMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

const shiftDay = (date: string, days: number): string => utcDay(midnightMs(date) + days * DAY_MS);

/** FNV-1a over the tenant id, so a tenant keeps its slot when the tenant list changes. */
const spreadOf = (tenantId: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < tenantId.length; index += 1) {
    hash = Math.imul(hash ^ tenantId.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0) % SPREAD_MS;
};

/** `HH:MM` on a 24-hour clock. The config schema refuses any other shape, so nothing is checked here. */
export const minutesOfDay = (dailyAt: string): number => {
  const [hours, minutes] = dailyAt.split(':');
  return Number(hours) * 60 + Number(minutes);
};

const occurrenceOn = (date: string, tenantId: string, atMinutes: number): DailyOccurrence => ({
  date,
  at: new Date(midnightMs(date) + atMinutes * 60_000 + spreadOf(tenantId)),
});

/**
 * The most recent occurrence that is due. The spread can push one past midnight, so the day `now`
 * falls in may not have reached its own occurrence yet, and the day is walked back rather than
 * derived.
 */
export const lastDueOccurrence = (nowMs: number, tenantId: string, atMinutes: number): DailyOccurrence => {
  let due = occurrenceOn(utcDay(nowMs), tenantId, atMinutes);
  while (due.at.getTime() > nowMs) {
    due = occurrenceOn(shiftDay(due.date, -1), tenantId, atMinutes);
  }
  return due;
};

const occurrenceAfter = (due: DailyOccurrence, tenantId: string, atMinutes: number): DailyOccurrence =>
  occurrenceOn(shiftDay(due.date, 1), tenantId, atMinutes);

/** The first occurrence still ahead of `nowMs`: the one a served day waits for. */
export const nextDailyOccurrence = (nowMs: number, tenantId: string, atMinutes: number): DailyOccurrence =>
  occurrenceAfter(lastDueOccurrence(nowMs, tenantId, atMinutes), tenantId, atMinutes);

/**
 * One key for every occurrence of a kind, so `jobs_idempotency_idx` admits a single standing
 * booking of it per tenant.
 */
export const dailyIdempotencyKey = (kind: string): string => `${kind}:daily`;

export type DailyPlan =
  | { outcome: 'pending' }
  /** `occurrence` is the next attempt: due already, or held back until its `at`. */
  | { outcome: 'scheduled' | 'exhausted', occurrence: DailyOccurrence };

/**
 * The next attempt at a tenant's daily run, from the scheduler's own bookings of it, newest first:
 * the occurrence already due for as long as it has not been served, the next one otherwise. A run is
 * a full recompute, so one that ended after the due occurrence serves it whatever day it was booked
 * for. One that failed sends the day round again at twice the distance already covered, until the
 * next occurrence would come first and supersedes it.
 */
export const planDailyOccurrence = (
  nowMs: number,
  tenantId: string,
  atMinutes: number,
  bookings: ReadonlyArray<ScheduledBooking>,
): DailyPlan => {
  if (bookings.some((booking) => ACTIVE.has(booking.status))) {
    return { outcome: 'pending' };
  }
  const due = lastDueOccurrence(nowMs, tenantId, atMinutes);
  const nextOccurrence = occurrenceAfter(due, tenantId, atMinutes);

  const ended = bookings
    .filter((booking) => booking.finishedAt !== null && booking.finishedAt.getTime() >= due.at.getTime())
    .map((booking) => ({ succeeded: booking.status === 'succeeded', atMs: booking.finishedAt?.getTime() ?? 0 }));
  if (ended.length === 0) {
    return { outcome: 'scheduled', occurrence: due };
  }
  if (ended.some((booking) => booking.succeeded)) {
    return { outcome: 'scheduled', occurrence: nextOccurrence };
  }

  const failedAtMs = Math.max(...ended.map((booking) => booking.atMs));
  const spacedAtMs = due.at.getTime() + Math.max(RETRY_BASE_MS, (failedAtMs - due.at.getTime()) * 2);
  // Doubling can overshoot the next occurrence before the day has been retried at all, and what it
  // doubles is queue wait as much as run time, so a first failure falls back to one base delay
  // after itself rather than costing the day its retry.
  const retryAtMs = spacedAtMs >= nextOccurrence.at.getTime() && ended.length === 1
    ? failedAtMs + RETRY_BASE_MS
    : spacedAtMs;
  if (retryAtMs >= nextOccurrence.at.getTime()) {
    return { outcome: 'exhausted', occurrence: nextOccurrence };
  }
  return { outcome: 'scheduled', occurrence: { date: due.date, at: new Date(retryAtMs) } };
};

/** The row every tenant holds for a daily kind: the spread lives in its next run, not in its time. */
export const dailySchedule = (atMinutes: number): Schedule => ({ cadence: 'daily', atMinute: atMinutes, weekday: null, timeZone: 'UTC' });

const holdsSchedule = (row: JobScheduleRow, schedule: Schedule): boolean =>
  row.cadence === schedule.cadence && row.atMinute === schedule.atMinute
  && row.weekday === schedule.weekday && row.timeZone === schedule.timeZone;

export type DailyOutcome =
  /** The row was written from `recompute.daily_at`, due at once so that the next tick decides the day. */
  | 'seeded'
  | 'pending'
  | 'enqueued'
  /** Nothing to run yet: the day is served, or its retry is held back. */
  | 'rescheduled'
  | 'exhausted'
  | 'claimed_elsewhere';

export type DailyReport =
  | {
    kind: string,
    outcome: DailyOutcome,
    nextRunAt: Date,
    /** Set on `enqueued`: whether the queue folded the run into one already standing. */
    alreadyExisted?: boolean,
  }
  | { kind: string, outcome: 'failed', error: unknown };

export interface DailyScheduleDeps {
  kinds: ReadonlyArray<string>,
  atMinutes: number,
  schedules: {
    getSchedules: (tenantId: string) => Promise<Array<JobScheduleRow>>,
    seedSchedule: (tenantId: string, kind: string, schedule: Schedule, nextRunAt: Date) => Promise<void>,
    moveNextRun: (row: JobScheduleRow, to: Date) => Promise<boolean>,
    releaseOccurrence: (row: JobScheduleRow, claimed: Date) => Promise<void>,
  },
  jobs: {
    listRecentScheduledBookings: (tenantId: string, kind: string, limit: number) => Promise<Array<ScheduledBooking>>,
    enqueueJob: (options: EnqueueJobOptions) => Promise<EnqueueJobResult>,
  },
  now: () => number,
}

/**
 * Serves one tenant's daily kinds from their schedule rows, reading a row's bookings only once it is
 * due. Every outcome moves the row with a conditional update, so of several processes ticking at once
 * one acts. The run's payload carries the date so that `jobs_dedup_idx` never folds it into a
 * change-driven run already in flight. A kind that throws is reported `failed` and the next kinds are
 * still served.
 */
export const runDailySchedules = async (tenantId: string, deps: DailyScheduleDeps): Promise<Array<DailyReport>> => {
  const nowMs = deps.now();
  const schedule = dailySchedule(deps.atMinutes);
  const rowByKind = new Map((await deps.schedules.getSchedules(tenantId)).map((row) => [row.kind, row]));
  const reports: Array<DailyReport> = [];

  const serve = async (kind: string): Promise<void> => {
    const row = rowByKind.get(kind);
    if (!row || !holdsSchedule(row, schedule)) {
      const nextRunAt = new Date(nowMs);
      await deps.schedules.seedSchedule(tenantId, kind, schedule, nextRunAt);
      reports.push({ kind, outcome: 'seeded', nextRunAt });
      return;
    }
    if (row.nextRunAt === null || row.nextRunAt.getTime() > nowMs) {
      return;
    }
    const move = async (to: Date, outcome: DailyOutcome): Promise<boolean> => {
      const moved = await deps.schedules.moveNextRun(row, to);
      if (!moved) {
        reports.push({ kind, outcome: 'claimed_elsewhere', nextRunAt: to });
      } else if (outcome !== 'enqueued') {
        reports.push({ kind, outcome, nextRunAt: to });
      }
      return moved;
    };

    const bookings = await deps.jobs.listRecentScheduledBookings(tenantId, kind, BOOKING_HISTORY_DEPTH);
    const plan = planDailyOccurrence(nowMs, tenantId, deps.atMinutes, bookings);
    if (plan.outcome === 'pending') {
      await move(new Date(nowMs + RECHECK_MS), 'pending');
      return;
    }
    if (plan.occurrence.at.getTime() > nowMs) {
      await move(plan.occurrence.at, plan.outcome === 'exhausted' ? 'exhausted' : 'rescheduled');
      return;
    }
    const claimed = new Date(nowMs + RECHECK_MS);
    if (!await move(claimed, 'enqueued')) {
      return;
    }
    let enqueued: EnqueueJobResult;
    try {
      enqueued = await deps.jobs.enqueueJob({
        kind,
        tenantId,
        payload: { date: plan.occurrence.date },
        idempotencyKey: dailyIdempotencyKey(kind),
        triggeredBy: 'scheduler',
      });
    } catch (error) {
      await deps.schedules.releaseOccurrence(row, claimed);
      throw error;
    }
    reports.push({ kind, outcome: 'enqueued', nextRunAt: claimed, alreadyExisted: enqueued.alreadyExisted });
  };

  for (const kind of deps.kinds) {
    try {
      await serve(kind);
    } catch (error) {
      reports.push({ kind, outcome: 'failed', error });
    }
  }
  return reports;
};
