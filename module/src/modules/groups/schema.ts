import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('groups_id_tenant_id_uq').on(t.id, t.tenantId),
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
