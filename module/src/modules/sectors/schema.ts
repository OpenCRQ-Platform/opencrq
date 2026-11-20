import { pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';

export const sectors = pgTable('sectors', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
}, (table) => [
  unique('sectors_tenant_id_name_unique').on(table.tenantId, table.name),
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('sectors_id_tenant_id_uq').on(table.id, table.tenantId),
]);

defineSecurityPolicies(sectors, tenantIsolationPolicy);
