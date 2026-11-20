import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { CriterionInheritance } from '../asset-dependencies/link-roles';
import type { AnchorProvenance } from '../threat-analyses/activity-scoring';
import type { ThreatEntityType } from '../threat-analyses/entity-types';
import type { TerminalTacticExternalId } from './data/attack-outcomes-data';
import { attackOutcomeTenantIsolationPolicy, defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { mitreTechniques } from '../mitre-attack/schema';
import { tenants } from '../tenants';
// After `../tenants`: loaded first, `organizations/schema` reaches the countries seed before it initializes.
import { organizations } from '../organizations/schema';
import { THREAT_ENTITY_TYPES } from '../threat-analyses/entity-types';

export const attackOutcomes = pgTable('attack_outcomes', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  description: text('description'),
  /** Attacker dwell time, in days, the catalog loss payloads are calibrated against. */
  referenceDwellDays: doublePrecision('reference_dwell_days').notNull(),
  /** Nullable only until the boot seeder has reprovisioned the row from the catalog. */
  terminalTactic: text('terminal_tactic').$type<TerminalTacticExternalId>(),
  reachesAvailability: text('reaches_availability').$type<CriterionInheritance>().notNull().default('none'),
  reachesIntegrity: text('reaches_integrity').$type<CriterionInheritance>().notNull().default('none'),
  reachesConfidentiality: text('reaches_confidentiality').$type<CriterionInheritance>().notNull().default('none'),
  reachesTraceability: text('reaches_traceability').$type<CriterionInheritance>().notNull().default('none'),
}, (table) => [
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('attack_outcomes_id_tenant_id_uq').on(table.id, table.tenantId),
]);

defineSecurityPolicies(attackOutcomes, tenantIsolationPolicy);

export const attackOutcomeMitreTechniques = pgTable('attack_outcome_mitre_techniques', {
  attackOutcomeId: uuid('attack_outcome_id').notNull().references(() => attackOutcomes.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  category: text('category').notNull().$type<'signature' | 'related'>(),
}, (table) => [
  primaryKey({ columns: [table.attackOutcomeId, table.mitreTechniqueId] }),
]);

defineSecurityPolicies(attackOutcomeMitreTechniques, attackOutcomeTenantIsolationPolicy);

/**
 * The attacker mixture of one (organization, attack outcome) pair, written by the
 * `attack-outcome-mixture-recompute` job alone. Its readers take the stored result instead of
 * recomputing it from the tenant's whole threat estate on every call. The row is absent until the
 * job has computed the pair, and a pair with no admitted actor holds a row with no group.
 */
export const attackOutcomeMixtures = pgTable('attack_outcome_mixtures', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  attackOutcomeId: uuid('attack_outcome_id').notNull(),
  /** The mixture clock the actors' activity was decayed against, not the instant of the write. */
  computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).notNull(),
  denominator: doublePrecision('denominator').notNull(),
}, (table) => [
  primaryKey({ name: 'attack_outcome_mixtures_pk', columns: [table.tenantId, table.organizationId, table.attackOutcomeId] }),
  foreignKey({
    name: 'attack_outcome_mixtures_organization_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'attack_outcome_mixtures_attack_outcome_fk',
    columns: [table.attackOutcomeId, table.tenantId],
    foreignColumns: [attackOutcomes.id, attackOutcomes.tenantId],
  }).onDelete('cascade'),
  // The primary key serves the organization key; this one serves the outcome key.
  index('attack_outcome_mixtures_attack_outcome_idx').on(table.tenantId, table.attackOutcomeId),
]);

defineSecurityPolicies(attackOutcomeMixtures, tenantIsolationPolicy);

const THREAT_ENTITY_TYPE_LITERALS = sql.raw(THREAT_ENTITY_TYPES.map((type) => `'${type}'`).join(', '));

/**
 * One row per actor group of a stored mixture. The lists are `text[]` columns rather than child
 * tables: they are read whole with their group and never filtered on.
 */
export const attackOutcomeMixtureGroups = pgTable('attack_outcome_mixture_groups', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  attackOutcomeId: uuid('attack_outcome_id').notNull(),
  /** Index of the group in the computed mixture: the sums downstream depend on that order. */
  position: integer('position').notNull(),
  groupKey: text('group_key').notNull(),
  name: text('name').notNull(),
  entityType: text('entity_type').notNull().$type<ThreatEntityType>(),
  mitreGroupId: text('mitre_group_id'),
  share: doublePrecision('share').notNull(),
  theta: doublePrecision('theta').notNull(),
  rho: doublePrecision('rho').notNull(),
  tau: doublePrecision('tau').notNull(),
  anchorProvenance: text('anchor_provenance').notNull().$type<AnchorProvenance>(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' }),
  countryMatch: boolean('country_match').notNull(),
  sectorMatch: boolean('sector_match').notNull(),
  memberGroupKeys: text('member_group_keys').array().notNull(),
  dedupedStixIds: text('deduped_stix_ids').array().notNull(),
  techniqueExternalIds: text('technique_external_ids').array().notNull(),
}, (table) => [
  // The key doubles as the index serving the foreign key to the parent row.
  primaryKey({ name: 'attack_outcome_mixture_groups_pk', columns: [table.tenantId, table.organizationId, table.attackOutcomeId, table.groupKey] }),
  foreignKey({
    name: 'attack_outcome_mixture_groups_mixture_fk',
    columns: [table.tenantId, table.organizationId, table.attackOutcomeId],
    foreignColumns: [attackOutcomeMixtures.tenantId, attackOutcomeMixtures.organizationId, attackOutcomeMixtures.attackOutcomeId],
  }).onDelete('cascade'),
  check('attack_outcome_mixture_groups_entity_type_ck', sql`${table.entityType} IN (${THREAT_ENTITY_TYPE_LITERALS})`),
  check('attack_outcome_mixture_groups_anchor_provenance_ck', sql`${table.anchorProvenance} IN ('observed', 'authored', 'none')`),
]);

defineSecurityPolicies(attackOutcomeMixtureGroups, tenantIsolationPolicy);
