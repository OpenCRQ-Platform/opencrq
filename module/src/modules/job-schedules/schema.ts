import type { ScheduleCadence } from './cadence';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';

/**
 * One recurring schedule per job kind and tenant. The row carries its own next run instead of a
 * queued job booked for that hour: the queue's dedupe folds every enqueue of the same kind and
 * payload into an active row without moving its `run_after`, so a booked row would hold back every
 * manual run until its hour.
 */
export const jobSchedules = pgTable('job_schedules', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  cadence: text('cadence').notNull().$type<ScheduleCadence>(),
  atMinute: integer('at_minute'),
  weekday: integer('weekday'),
  timeZone: text('time_zone'),
  /** Null on a manual schedule, which never comes due. */
  nextRunAt: timestamp('next_run_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('job_schedules_tenant_kind_idx').on(table.tenantId, table.kind),
  check('job_schedules_cadence_ck', sql`cadence IN ('manual', 'hourly', 'every_6_hours', 'every_12_hours', 'daily', 'weekly')`),
  check('job_schedules_at_minute_ck', sql`(at_minute IS NOT NULL) = (cadence IN ('daily', 'weekly')) AND (at_minute IS NULL OR at_minute BETWEEN 0 AND 1439)`),
  check('job_schedules_weekday_ck', sql`(weekday IS NOT NULL) = (cadence = 'weekly') AND (weekday IS NULL OR weekday BETWEEN 0 AND 6)`),
  check('job_schedules_time_zone_ck', sql`(time_zone IS NOT NULL) = (cadence IN ('daily', 'weekly'))`),
  check('job_schedules_next_run_ck', sql`(next_run_at IS NULL) = (cadence = 'manual')`),
]);

defineSecurityPolicies(jobSchedules, tenantIsolationPolicy);
