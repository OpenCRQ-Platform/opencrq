import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityWritePolicy } from '../../security/policies';
import { tenants } from '../tenants';

export const dashboardSettings = pgTable('dashboard_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  /** An id of the front-end dashboard registry, which the server does not know. */
  homeDashboardId: text('home_dashboard_id').notNull(),
});

defineSecurityPolicies(dashboardSettings, tenantIsolationPolicy, manageSecurityWritePolicy);
