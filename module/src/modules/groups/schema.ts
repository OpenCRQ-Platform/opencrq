import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { groupRolesLinkPolicy, groupUsersLinkPolicy, manageSecurityPolicy, manageSecurityWritePolicy } from '../../security/policies';
import { roles, tenants, users } from '../schema';

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  slug: text('slug'),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('groups_tenant_slug_unique').on(t.tenantId, t.slug),
]);

defineSecurityPolicies(groups, tenantIsolationPolicy, manageSecurityPolicy);

export const groupUsers = pgTable('group_users', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.userId] }),
]);

defineSecurityPolicies(groupUsers, manageSecurityWritePolicy, groupUsersLinkPolicy);

export const groupRoles = pgTable('group_roles', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.roleId] }),
]);

defineSecurityPolicies(groupRoles, manageSecurityWritePolicy, groupRolesLinkPolicy);
