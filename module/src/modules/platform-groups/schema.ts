import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies } from '../../security';
import { platformSecurityPolicy } from '../../security/policies';
import { platformRoles } from '../platform-roles';
import { users } from '../users';

export const platformGroups = pgTable('platform_groups', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
});

defineSecurityPolicies(platformGroups, platformSecurityPolicy);

export const platformGroupUsers = pgTable('platform_group_users', {
  platformGroupId: uuid('platform_group_id').notNull().references(() => platformGroups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.platformGroupId, t.userId] }),
]);

defineSecurityPolicies(platformGroupUsers, platformSecurityPolicy);

export const platformGroupRoles = pgTable('platform_group_roles', {
  platformGroupId: uuid('platform_group_id').notNull().references(() => platformGroups.id, { onDelete: 'cascade' }),
  platformRoleId: uuid('platform_role_id').notNull().references(() => platformRoles.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.platformGroupId, t.platformRoleId] }),
]);

defineSecurityPolicies(platformGroupRoles, platformSecurityPolicy);
