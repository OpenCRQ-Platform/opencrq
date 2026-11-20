import type { IntegrationSource } from './constants';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { serviceAccounts } from '../service-accounts/schema';
import { tenants } from '../tenants';

export { INTEGRATION_SOURCES, isIntegrationSource } from './constants';
export type { IntegrationSource } from './constants';

export const integrationSettings = pgTable('integration_settings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  source: text('source').notNull().$type<IntegrationSource>(),
  serviceAccountId: uuid('service_account_id').references(() => serviceAccounts.id, { onDelete: 'set null' }),
  lastReportedAt: timestamp('last_reported_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('integration_settings_tenantid_source_idx').on(table.tenantId, table.source),
]);

defineSecurityPolicies(integrationSettings, tenantIsolationPolicy);
