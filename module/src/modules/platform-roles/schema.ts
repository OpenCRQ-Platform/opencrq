import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies } from '../../security';
import { platformSecurityPolicy } from '../../security/policies';
import { platformCapabilities } from '../schema';

export const platformRoles = pgTable('platform_roles', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
});

defineSecurityPolicies(platformRoles, platformSecurityPolicy);

export const platformRoleCapabilities = pgTable('platform_role_capabilities', {
  platformRoleId: uuid('platform_role_id').notNull().references(() => platformRoles.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => platformCapabilities.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.platformRoleId, t.capabilityId] }),
]);

defineSecurityPolicies(platformRoleCapabilities, platformSecurityPolicy);
