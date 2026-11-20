import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { Schedule } from './cadence';
import type { JobScheduleRow } from './repository';
import { defineService } from '../../registry';
import { isWellFormedSchedule, nextOccurrence } from './cadence';
import { jobSchedulesRepository } from './repository';

const assertWellFormed = (schedule: Schedule): void => {
  if (!isWellFormedSchedule(schedule)) {
    throw newError('Malformed schedule', { ...schedule });
  }
};

export const jobSchedulesService = defineService(
  'jobSchedules',
  jobSchedulesRepository,
).implement({
  getSchedules: async ({ repo }, tenantId: string): Promise<Array<JobScheduleRow>> => repo.findByTenant(tenantId),

  getSchedule: async ({ repo }, tenantId: string, kind: string): Promise<JobScheduleRow | null> =>
    await repo.findByTenantAndKind(tenantId, kind) ?? null,

  /** The next run is the first slot after `nowMs`, whatever ran before. */
  saveSchedule: async ({ repo }, tenantId: string, kind: string, schedule: Schedule, nowMs: number): Promise<void> => {
    assertWellFormed(schedule);
    await repo.upsertSchedule({ id: uuidv7(), tenantId, kind, ...schedule, nextRunAt: nextOccurrence(schedule, nowMs) });
  },

  /** Writes `schedule` only for a kind that has none, so a schedule somebody saved is never replaced. */
  ensureSchedule: async ({ repo }, tenantId: string, kind: string, schedule: Schedule, nowMs: number): Promise<void> => {
    assertWellFormed(schedule);
    await repo.insertScheduleIfAbsent({ id: uuidv7(), tenantId, kind, ...schedule, nextRunAt: nextOccurrence(schedule, nowMs) });
  },

  /** Writes `schedule` with a next run of the caller's own, for a kind whose slots `nextOccurrence` cannot place. */
  seedSchedule: async ({ repo }, tenantId: string, kind: string, schedule: Schedule, nextRunAt: Date): Promise<void> => {
    assertWellFormed(schedule);
    await repo.upsertSchedule({ id: uuidv7(), tenantId, kind, ...schedule, nextRunAt });
  },

  /** Moves the next run to `to` as a claim: false when another process moved the row first. */
  moveNextRun: async ({ repo }, row: JobScheduleRow, to: Date): Promise<boolean> =>
    row.nextRunAt !== null && await repo.moveNextRun(row.id, row, row.nextRunAt, to),

  /**
   * Claims a due occurrence by moving the row to its first slot after `nowMs`, so every occurrence
   * missed in between is passed over rather than replayed. Returns that slot, or null when another
   * process claimed it first or the schedule changed since it was read.
   */
  claimOccurrence: async ({ repo }, row: JobScheduleRow, nowMs: number): Promise<Date | null> => {
    const next = nextOccurrence(row, nowMs);
    if (row.nextRunAt === null || next === null) {
      return null;
    }
    return await repo.moveNextRun(row.id, row, row.nextRunAt, next) ? next : null;
  },

  /** Hands a claimed occurrence back, so the next tick serves it. A no-op once the row moved on. */
  releaseOccurrence: async ({ repo }, row: JobScheduleRow, claimed: Date): Promise<void> => {
    if (row.nextRunAt !== null) {
      await repo.moveNextRun(row.id, row, claimed, row.nextRunAt);
    }
  },
});
