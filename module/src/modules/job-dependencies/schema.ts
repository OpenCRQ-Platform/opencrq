import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';

/** The sentinel table name meaning "subscribed to every table": the state of a job that was never
 * cleanly observed. An empty set is a failed observation, never a subscription to nothing. */
export const SUBSCRIBE_ALL_SENTINEL = '*';

export const JOB_DEPENDENCY_ACCESSES = ['read', 'write'] as const;
export type JobDependencyAccess = (typeof JOB_DEPENDENCY_ACCESSES)[number];

export const jobDependencies = pgTable('job_dependencies', {
  id: uuid('id').primaryKey(),
  jobKind: text('job_kind').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tableName: text('table_name').notNull(),
  access: text('access').notNull().$type<JobDependencyAccess>(),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('job_dependencies_kind_tenant_table_access_idx').on(table.jobKind, table.tenantId, table.tableName, table.access),
]);

defineSecurityPolicies(jobDependencies, tenantIsolationPolicy);
