import { sql } from 'drizzle-orm';
import { check, doublePrecision, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, nativeMarkingPolicy, riskScenarioTenantIsolationPolicy, tenantIsolationPolicy } from '../../security';
import { attackOutcomes } from '../attack-outcomes/schema';
import { businessValueCategories } from '../business-value-categories/schema';
import { organizations } from '../organizations/schema';
import { primaryAssets } from '../primary-assets/schema';
import { tenants } from '../tenants';
import { users } from '../users';

export const TEF_MODE_VALUES = ['manual', 'auto'] as const;
export type TefMode = typeof TEF_MODE_VALUES[number];

export const riskScenarios = pgTable('risk_scenarios', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  description: text('description'),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  attackOutcomeId: uuid('attack_outcome_id').notNull(),
  // Defaults to `auto` because the estimate needs no input from the analyst: a scenario carries a
  // frequency, and so an ALE, the moment it exists.
  tefMode: text('tef_mode').notNull().default('auto').$type<TefMode>(),
  /**
   * Which version of the financial answers this scenario's estimates were derived from: the
   * profile's own `updated_at` as the run read it, never the clock. A profile that has moved past
   * it is what the staleness notice reads, and it answers for this scenario alone — a sibling
   * still queued, or failing, leaves this one's figures correctly described as current.
   */
  derivedAnswersUpdatedAt: timestamp('derived_answers_updated_at', { withTimezone: true }),
  /**
   * The OpenCRQ markings the scenario carries, by STIX id (CTEM marking parity, G2): a person reads
   * it only when they are cleared for all of them (`nativeMarkingPolicy`). Unmarked by default.
   */
  markingRefs: text('marking_refs').array().notNull().default(sql`'{}'::text[]`),
}, (table) => [
  // Both references carry the tenant, so a scenario naming another tenant's scope or outcome is
  // refused by the database whatever the service checked.
  foreignKey({
    name: 'risk_scenarios_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }),
  foreignKey({
    name: 'risk_scenarios_attack_outcome_tenant_fk',
    columns: [table.attackOutcomeId, table.tenantId],
    foreignColumns: [attackOutcomes.id, attackOutcomes.tenantId],
  }),
  index('risk_scenarios_organization_idx').on(table.organizationId),
]);

defineSecurityPolicies(riskScenarios, tenantIsolationPolicy, nativeMarkingPolicy);

export const riskScenarioPrimaryAssets = pgTable('risk_scenario_primary_assets', {
  riskScenarioId: uuid('risk_scenario_id').notNull().references(() => riskScenarios.id, { onDelete: 'cascade' }),
  primaryAssetId: uuid('primary_asset_id').notNull().references(() => primaryAssets.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.riskScenarioId, t.primaryAssetId], name: 'rs_primary_assets_pk' }),
  index('risk_scenario_primary_assets_primary_asset_idx').on(t.primaryAssetId),
]);

defineSecurityPolicies(riskScenarioPrimaryAssets, riskScenarioTenantIsolationPolicy);

/**
 * The scenario's loss scope: what the attack destroys, owned by the scenario rather than read
 * through its primary assets, so two scenarios aimed at one asset can open different loss lines.
 */
export const riskScenarioBusinessValueCategories = pgTable('risk_scenario_business_value_categories', {
  riskScenarioId: uuid('risk_scenario_id').notNull().references(() => riskScenarios.id, { onDelete: 'cascade' }),
  businessValueCategoryId: uuid('business_value_category_id').notNull().references(() => businessValueCategories.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.riskScenarioId, t.businessValueCategoryId], name: 'rs_business_value_categories_pk' }),
]);

defineSecurityPolicies(riskScenarioBusinessValueCategories, riskScenarioTenantIsolationPolicy);

/** A scenario's own risk tolerance, overriding its scope's. No row means the scenario follows its scope. */
export const riskScenarioRiskTolerances = pgTable('risk_scenario_risk_tolerances', {
  id: uuid('id').primaryKey(),
  riskScenarioId: uuid('risk_scenario_id').notNull(),
  annualLoss: doublePrecision('annual_loss').notNull(),
  maxExceedanceProbability: doublePrecision('max_exceedance_probability').notNull(),
}, (table) => [
  unique('risk_scenario_risk_tolerances_scenario_unique').on(table.riskScenarioId),
  foreignKey({ name: 'risk_scenario_risk_tolerances_scenario_fk', columns: [table.riskScenarioId], foreignColumns: [riskScenarios.id] }).onDelete('cascade'),
  check('risk_scenario_risk_tolerances_annual_loss_ck', sql`${table.annualLoss} > 0`),
  check('risk_scenario_risk_tolerances_probability_ck', sql`${table.maxExceedanceProbability} BETWEEN 0.001 AND 1`),
]);

defineSecurityPolicies(riskScenarioRiskTolerances, riskScenarioTenantIsolationPolicy);
