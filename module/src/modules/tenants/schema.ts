import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { SupportedLocale } from '../users/validation';
import { defineSecurityPolicies, tenantMembershipPolicy, tenantUpdatePolicy, tenantUserRowsPolicy } from '../../security';
import { users } from '../users';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  /** Null is Automatic: each member's browser decides. */
  defaultLocale: text('default_locale').$type<SupportedLocale>(),
});

defineSecurityPolicies(tenants, tenantMembershipPolicy, tenantUpdatePolicy);

export const tenantUsers = pgTable('tenant_users', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  title: text('title'),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.userId] }),
]);

defineSecurityPolicies(tenantUsers, tenantUserRowsPolicy);
