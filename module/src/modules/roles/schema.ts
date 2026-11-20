import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityPolicy, manageSecurityWritePolicy, roleCapabilitiesLinkPolicy } from '../../security/policies';
import { capabilities, tenants } from '../schema';

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
});

defineSecurityPolicies(roles, tenantIsolationPolicy, manageSecurityPolicy);

export const roleCapabilities = pgTable('role_capabilities', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => capabilities.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.capabilityId] }),
]);

defineSecurityPolicies(roleCapabilities, manageSecurityWritePolicy, roleCapabilitiesLinkPolicy);
