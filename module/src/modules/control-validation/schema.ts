import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { CapabilityFunction } from '../controls/capability/constants';
import type { TechniqueTestGrain } from './technique-test-results';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { controlCapabilities } from '../controls/capability/schema';
import { mitreTechniques } from '../mitre-attack/schema';
import { organizations } from '../organizations/schema';
import { tenants } from '../tenants/schema';

/**
 * What the simulations proved on one control and function, one line each time a count moved.
 *
 * A line holds until the next one for its key, so a key with no line in a window is the previous
 * line still in force, never an absence of measurement.
 */
export const controlProvenPostureHistory = pgTable('control_proven_posture_history', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  // Which level the line speaks for; null is the tenant level.
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  function: text('function').notNull().$type<CapabilityFunction>(),
  credited: integer('credited').notNull(),
  tested: integer('tested').notNull(),
  held: integer('held').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  // Rebuilt from the stored changes of state rather than recorded on the day, so only approximate.
  replayed: boolean('replayed').notNull().default(false),
}, (table) => [
  index('control_proven_posture_history_key_changed_idx')
    .on(table.capabilityId, table.tenantId, table.organizationId, table.function, table.changedAt.desc().nullsFirst()),
  index('control_proven_posture_history_tenant_changed_idx').on(table.tenantId, table.changedAt),
  index('control_proven_posture_history_organization_idx').on(table.organizationId),
]);

defineSecurityPolicies(controlProvenPostureHistory, tenantIsolationPolicy);

/**
 * What OpenAEV observed of one control on one technique and function, per level: its tests, those
 * that held and their share, how many of the level's hosts they reached, and how many it holds.
 * `grain` tells a parent technique's row, which the engine and the levers read, from a sub-technique's
 * own row, which only the screens read.
 * The audited efficacy is not stored, since the declaration it is read against moves without an
 * import. Rewritten whole by the capability derivation, and only for a technique with a result left.
 *
 * The `booked_*` columns hold the result a risk scope's control levers were last priced on, null when
 * they were priced on the declaration alone and at the tenant level, which prices none: a technique
 * whose efficacy moves far enough from it books them again.
 */
export const controlTechniqueTestResults = pgTable('control_technique_test_results', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  // Which level the row speaks for; null is the tenant level, read on the open estate.
  organizationId: uuid('organization_id'),
  function: text('function').notNull().$type<CapabilityFunction>(),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  grain: text('grain').notNull().$type<TechniqueTestGrain>(),
  rate: doublePrecision('rate').notNull(),
  tests: integer('tests').notNull(),
  heldTests: integer('held_tests').notNull(),
  hostsTested: integer('hosts_tested').notNull(),
  scopeHosts: integer('scope_hosts').notNull(),
  bookedRate: doublePrecision('booked_rate'),
  bookedHostsTested: integer('booked_hosts_tested'),
  bookedScopeHosts: integer('booked_scope_hosts'),
}, (table) => [
  unique('control_technique_test_results_cell_uq')
    .on(table.capabilityId, table.tenantId, table.organizationId, table.function, table.mitreTechniqueId)
    .nullsNotDistinct(),
  foreignKey({
    name: 'control_technique_test_results_organization_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('control_technique_test_results_organization_idx').on(table.tenantId, table.organizationId),
  index('control_technique_test_results_technique_idx').on(table.mitreTechniqueId, table.tenantId, table.organizationId),
  check('control_technique_test_results_grain_ck', sql`${table.grain} IN ('technique', 'sub_technique')`),
  check('control_technique_test_results_booked_grain_ck', sql`${table.grain} = 'technique' OR ${table.bookedRate} IS NULL`),
  check('control_technique_test_results_rate_ck', sql`${table.rate} BETWEEN 0 AND 1`),
  check('control_technique_test_results_tests_ck', sql`${table.heldTests} BETWEEN 0 AND ${table.tests} AND ${table.hostsTested} <= ${table.tests}`),
  check('control_technique_test_results_hosts_ck', sql`${table.hostsTested} > 0 AND ${table.hostsTested} <= ${table.scopeHosts}`),
]);

defineSecurityPolicies(controlTechniqueTestResults, tenantIsolationPolicy);
