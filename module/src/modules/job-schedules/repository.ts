import type { Schedule } from './cadence';
import { and, eq, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { jobSchedules } from './schema';

export type JobScheduleRow = typeof jobSchedules.$inferSelect;
export type JobScheduleValues = Pick<typeof jobSchedules.$inferInsert, 'id' | 'tenantId' | 'kind' | 'cadence' | 'atMinute' | 'weekday' | 'timeZone' | 'nextRunAt'>;

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
const sqlNow = (): Date => sql`now()` as unknown as Date;

export const jobSchedulesRepository = defineRepository({
  findByTenant: ({ db, views }, tenantId: string): Promise<Array<JobScheduleRow>> =>
    db.select().from(views.jobSchedules).where(eq(views.jobSchedules.tenantId, tenantId)),

  findByTenantAndKind: async ({ db, views }, tenantId: string, kind: string): Promise<JobScheduleRow | undefined> => {
    const rows = await db.select().from(views.jobSchedules)
      .where(and(eq(views.jobSchedules.tenantId, tenantId), eq(views.jobSchedules.kind, kind)))
      .limit(1);
    return rows.at(0);
  },

  upsertSchedule: ({ db }, values: JobScheduleValues) =>
    db.insert(jobSchedules)
      .values([values])
      .onConflictDoUpdate({
        target: [jobSchedules.tenantId, jobSchedules.kind],
        set: {
          cadence: values.cadence,
          atMinute: values.atMinute,
          weekday: values.weekday,
          timeZone: values.timeZone,
          nextRunAt: values.nextRunAt,
          updatedAt: sqlNow(),
        },
      }),

  insertScheduleIfAbsent: ({ db }, values: JobScheduleValues) =>
    db.insert(jobSchedules).values([values]).onConflictDoNothing(),

  /**
   * Moves the next run from `from` to `to` only if the row still holds `from` and the schedule the
   * caller read, which makes the move the claim on that occurrence: of several processes ticking at
   * once exactly one gets a row back, and a schedule saved since the read voids it even when its
   * next run lands on the same instant.
   */
  moveNextRun: async ({ db }, id: string, seen: Schedule, from: Date, to: Date): Promise<boolean> => {
    const rows = await db.update(jobSchedules)
      .set({ nextRunAt: to, updatedAt: sqlNow() })
      .where(and(
        eq(jobSchedules.id, id),
        eq(jobSchedules.nextRunAt, from),
        eq(jobSchedules.cadence, seen.cadence),
        sql`${jobSchedules.atMinute} IS NOT DISTINCT FROM ${seen.atMinute}`,
        sql`${jobSchedules.weekday} IS NOT DISTINCT FROM ${seen.weekday}`,
        sql`${jobSchedules.timeZone} IS NOT DISTINCT FROM ${seen.timeZone}`,
      ))
      .returning();
    return rows.length > 0;
  },
});
