import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { MappingRole } from './data/curated-technique-mappings';
import type { MappingLane, TechniqueGrain, TechniqueResolutionState } from './constants';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { cve } from '../cve/schema';
import { mitreTechniques } from '../mitre-attack/schema';
import { tenants } from '../tenants';

export { MAPPING_LANE_VALUES, TECHNIQUE_GRAIN_VALUES, TECHNIQUE_RESOLUTION_STATE_VALUES } from './constants';
export type { MappingLane, TechniqueGrain, TechniqueResolutionState } from './constants';

/**
 * One row per resolved vulnerability. Its absence is "never resolved", a row whose state is
 * `unresolved` is "resolved to nothing", and the two are not the same claim.
 */
export const cveTechniqueResolution = pgTable('cve_technique_resolution', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  state: text('state').$type<TechniqueResolutionState>().notNull(),
  tablesVersion: text('tables_version').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [
  uniqueIndex('cve_technique_resolution_cve_uq').on(table.cveId),
]);

defineSecurityPolicies(cveTechniqueResolution, tenantIsolationPolicy);

export const cveTechniqueMapping = pgTable('cve_technique_mapping', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  resolutionId: uuid('resolution_id').notNull().references(() => cveTechniqueResolution.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  role: text('role').$type<MappingRole>().notNull(),
  lane: text('lane').$type<MappingLane>().notNull(),
  grain: text('grain').$type<TechniqueGrain>().notNull(),
  tablesVersion: text('tables_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  // The lane sits outside the key on purpose: a resolver that forgot to keep only the strongest
  // lane for a technique and role fails on this constraint instead of writing the pair twice.
  uniqueIndex('cve_technique_mapping_cve_technique_role_uq').on(table.cveId, table.mitreTechniqueId, table.role),
  index('cve_technique_mapping_resolution_idx').on(table.resolutionId),
]);

defineSecurityPolicies(cveTechniqueMapping, tenantIsolationPolicy);
