import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityPolicy, manageSecurityWritePolicy, serviceAccountGroupsLinkPolicy } from '../../security/policies';
import { groups } from '../groups/schema';
import { tenants } from '../tenants';

export const serviceAccounts = pgTable('service_accounts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

defineSecurityPolicies(serviceAccounts, tenantIsolationPolicy, manageSecurityPolicy);

export const serviceAccountGroups = pgTable('service_account_groups', {
  serviceAccountId: uuid('service_account_id').notNull().references(() => serviceAccounts.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.serviceAccountId, t.groupId] }),
]);

defineSecurityPolicies(serviceAccountGroups, manageSecurityWritePolicy, serviceAccountGroupsLinkPolicy);
