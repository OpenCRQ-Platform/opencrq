import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';

/**
 * A tenant with no row is enabled: the connector is on by default, and switching it off is what
 * writes one. The load record is what a sync compares the file against, and it is cleared whenever
 * the next sync must load whatever the file says.
 */
export const defaultThreatsSettings = pgTable('default_threats_settings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  etag: text('etag'),
  lastModified: text('last_modified'),
  // The app and outcome model versions that loaded the file: an upgrade brings catalogue techniques the last load ignored.
  appVersion: text('app_version'),
  attackRelease: text('attack_release'),
  loadedAt: timestamp('loaded_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('default_threats_settings_tenantid_idx').on(table.tenantId),
]);

defineSecurityPolicies(defaultThreatsSettings, tenantIsolationPolicy);
