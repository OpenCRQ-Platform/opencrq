import { pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';

export const countries = pgTable('countries', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isoAlpha2: text('iso_alpha_2').notNull(),
  isoAlpha3: text('iso_alpha_3').notNull(),
}, (table) => [
  unique('countries_tenant_id_iso_alpha_3_unique').on(table.tenantId, table.isoAlpha3),
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('countries_id_tenant_id_uq').on(table.id, table.tenantId),
]);

defineSecurityPolicies(countries, tenantIsolationPolicy);
