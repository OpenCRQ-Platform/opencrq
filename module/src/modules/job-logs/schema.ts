import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { jobs } from '../jobs/schema';
import { tenants } from '../tenants';

export const JOB_LOG_LEVELS = ['trace', 'error'] as const;
export type JobLogLevel = (typeof JOB_LOG_LEVELS)[number];

/** The scope kind of the OpenCTI stream session, which never becomes a job and so has no job kind. */
export const STREAM_LOG_SCOPE_KIND = 'opencti-stream';

export const JOB_LOGS_TABLE = 'job_logs';

/**
 * One captured log line. `scopeKind` is the job kind wherever a job exists and `STREAM_LOG_SCOPE_KIND`
 * otherwise: both retentions key on it, and a store keyed on the connector could not bound the lines
 * of a job no connector owns.
 */
export const jobLogs = pgTable(JOB_LOGS_TABLE, {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Null for a stream session. The tenant is denormalised rather than joined through the job for the
  // same reason: a policy resolving it through `jobs` would have nothing to resolve on those rows.
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  scopeId: text('scope_id').notNull(),
  scopeKind: text('scope_kind').notNull(),
  level: text('level').notNull().$type<JobLogLevel>(),
  message: text('message').notNull(),
  detail: text('detail'),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  // Led by the job rather than the tenant: the cascade from a purged job looks rows up by the job alone.
  index('job_logs_job_idx').on(table.jobId, table.occurredAt),
  index('job_logs_scope_kind_idx').on(table.tenantId, table.scopeKind, table.occurredAt),
]);

defineSecurityPolicies(jobLogs, tenantIsolationPolicy);
