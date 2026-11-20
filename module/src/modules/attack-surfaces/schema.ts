import { foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { AssetCategory } from '../supporting-assets/schema';
import { attackSurfaceTenantIsolationPolicy, defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { mitreTechniques } from '../mitre-attack/schema';
import { tenants } from '../tenants';

export const attackSurfaces = pgTable('attack_surfaces', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().$type<AssetCategory>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('attack_surfaces_tenant_category_uq').on(table.tenantId, table.categoryId),
]);

defineSecurityPolicies(attackSurfaces, tenantIsolationPolicy);

/**
 * The techniques that can plausibly run on the attack surface's asset category, seeded per tenant
 * from vendored reference data with no write path anywhere. Per-tenant storage is deliberate: it
 * makes a later tenant overlay an unlock rather than a remodel.
 * The surface is already unique per (tenant, category), so the category is never restated here.
 */
export const attackSurfaceMitreTechniques = pgTable('attack_surface_mitre_techniques', {
  attackSurfaceId: uuid('attack_surface_id').notNull(),
  mitreTechniqueId: uuid('mitre_technique_id').notNull(),
}, (table) => [
  primaryKey({ name: 'attack_surface_mitre_tech_pk', columns: [table.attackSurfaceId, table.mitreTechniqueId] }),
  // The primary key leads on the surface, and the read path filters on the technique alone.
  index('attack_surface_mitre_tech_technique_idx').on(table.mitreTechniqueId),
  foreignKey({ name: 'attack_surface_mitre_tech_surface_fk', columns: [table.attackSurfaceId], foreignColumns: [attackSurfaces.id] }).onDelete('cascade'),
  foreignKey({ name: 'attack_surface_mitre_tech_technique_fk', columns: [table.mitreTechniqueId], foreignColumns: [mitreTechniques.id] }).onDelete('cascade'),
]);

defineSecurityPolicies(attackSurfaceMitreTechniques, attackSurfaceTenantIsolationPolicy);
