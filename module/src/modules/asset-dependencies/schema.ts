import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { IntegrationSource } from '../integration-settings/constants';
import type { AssetCategory, AssetSubcategory } from '../supporting-assets/constants';
import type { DependencyRuleNamePatternKind } from './rule-matching';
import type { SupportToPrimaryLinkRole } from './link-roles';
import type { PrimaryToPrimaryLinkStrength } from './link-strengths';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { organizations } from '../organizations/schema';
import { primaryAssets } from '../primary-assets/schema';
import { supportingAssets, tags } from '../supporting-assets/schema';
import { tenants } from '../tenants';
import { SUPPORT_TO_PRIMARY_LINK_ROLES, UNKNOWN_LINK_ROLE } from './link-roles';
import { PRIMARY_TO_PRIMARY_LINK_STRENGTHS, UNKNOWN_LINK_STRENGTH } from './link-strengths';
import { MAX_REACH_DEPTH } from './reach';

const SUPPORT_TO_PRIMARY_PAIR_UNIQUE = 'support_to_primary_links_pair_uq';
const SUPPORT_TO_SUPPORT_PAIR_UNIQUE = 'support_to_support_links_pair_uq';
const PRIMARY_TO_PRIMARY_PAIR_UNIQUE = 'primary_to_primary_links_pair_uq';
export const DEPENDENCY_RESOURCE_TYPE_NAME_UNIQUE = 'dependency_resource_types_tenant_name_uq';

const LINK_ROLE_LITERALS = sql.raw(SUPPORT_TO_PRIMARY_LINK_ROLES.map((role) => `'${role}'`).join(', '));
const LINK_STRENGTH_LITERALS = sql.raw(PRIMARY_TO_PRIMARY_LINK_STRENGTHS.map((strength) => `'${strength}'`).join(', '));

/**
 * A rule links every supporting asset matching all its set conditions to one primary asset, with its
 * roles. The links it writes carry its id; the `dependency-rules-apply` job keeps them equal to what
 * the rules match, so a sync or a rule change re-applies them.
 */
export const dependencyRules = pgTable('dependency_rules', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  primaryAssetId: uuid('primary_asset_id').notNull(),
  roles: text('roles').array().$type<Array<SupportToPrimaryLinkRole>>().notNull().default(sql.raw(`'{${UNKNOWN_LINK_ROLE}}'`)),
  enabled: boolean('enabled').notNull().default(true),
  categoryId: text('category_id').$type<AssetCategory>(),
  subcategoryId: text('subcategory_id').$type<AssetSubcategory>(),
  /** Matched case-insensitively against the asset's display name and every hostname its sources report. */
  namePattern: text('name_pattern'),
  namePatternKind: text('name_pattern_kind').$type<DependencyRuleNamePatternKind>(),
  tagId: uuid('tag_id'),
  /** The connector family that reports the asset, the `source` of `integration_settings`. */
  source: text('source').$type<IntegrationSource>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('dependency_rules_id_tenant_id_uq').on(table.id, table.tenantId),
  unique('dependency_rules_tenant_name_uq').on(table.tenantId, table.name),
  foreignKey({
    name: 'dependency_rules_primary_asset_tenant_fk',
    columns: [table.primaryAssetId, table.tenantId],
    foreignColumns: [primaryAssets.id, primaryAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'dependency_rules_tag_tenant_fk',
    columns: [table.tagId, table.tenantId],
    foreignColumns: [tags.id, tags.tenantId],
  }).onDelete('cascade'),
  index('dependency_rules_primary_asset_idx').on(table.primaryAssetId, table.tenantId),
  index('dependency_rules_tag_idx').on(table.tagId, table.tenantId),
  check('dependency_rules_roles_known_ck', sql`${table.roles} <@ ARRAY[${LINK_ROLE_LITERALS}]::text[]`),
  check('dependency_rules_roles_not_empty_ck', sql`cardinality(${table.roles}) > 0`),
  check('dependency_rules_roles_unknown_alone_ck', sql`NOT (${sql.raw(`'${UNKNOWN_LINK_ROLE}'`)} = ANY(${table.roles})) OR cardinality(${table.roles}) = 1`),
  check('dependency_rules_pattern_pair_ck', sql`(${table.namePattern} IS NULL) = (${table.namePatternKind} IS NULL)`),
  check('dependency_rules_pattern_kind_ck', sql`${table.namePatternKind} IN ('glob', 'regex')`),
  check('dependency_rules_condition_ck', sql`num_nonnulls(${table.categoryId}, ${table.subcategoryId}, ${table.namePattern}, ${table.tagId}, ${table.source}) > 0`),
]);

defineSecurityPolicies(dependencyRules, tenantIsolationPolicy);

/**
 * `ruleId` names the rule that wrote the link, null for a link a person made. A person's edit of a
 * rule link makes it theirs, and a person's removal of one is kept in `dependencyRuleSuppressions`.
 */
export const supportToPrimaryLinks = pgTable('support_to_primary_links', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  primaryAssetId: uuid('primary_asset_id').notNull(),
  roles: text('roles').array().$type<Array<SupportToPrimaryLinkRole>>().notNull().default(sql.raw(`'{${UNKNOWN_LINK_ROLE}}'`)),
  ruleId: uuid('rule_id'),
}, (table) => [
  unique(SUPPORT_TO_PRIMARY_PAIR_UNIQUE).on(table.supportingAssetId, table.primaryAssetId),
  foreignKey({
    name: 'support_to_primary_links_rule_tenant_fk',
    columns: [table.ruleId, table.tenantId],
    foreignColumns: [dependencyRules.id, dependencyRules.tenantId],
  }).onDelete('cascade'),
  index('support_to_primary_links_rule_idx').on(table.ruleId, table.tenantId),
  // Both ends carry the tenant, so a link between two tenants' assets is refused by the database.
  foreignKey({
    name: 'support_to_primary_links_supporting_asset_tenant_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'support_to_primary_links_primary_asset_tenant_fk',
    columns: [table.primaryAssetId, table.tenantId],
    foreignColumns: [primaryAssets.id, primaryAssets.tenantId],
  }).onDelete('cascade'),
  index('support_to_primary_links_primary_asset_idx').on(table.primaryAssetId, table.tenantId),
  check('support_to_primary_links_roles_known_ck', sql`${table.roles} <@ ARRAY[${LINK_ROLE_LITERALS}]::text[]`),
  check('support_to_primary_links_roles_not_empty_ck', sql`cardinality(${table.roles}) > 0`),
  check('support_to_primary_links_roles_unknown_alone_ck', sql`NOT (${sql.raw(`'${UNKNOWN_LINK_ROLE}'`)} = ANY(${table.roles})) OR cardinality(${table.roles}) = 1`),
]);

defineSecurityPolicies(supportToPrimaryLinks, tenantIsolationPolicy);

/** A pair a person unlinked while a rule held it: no rule links it again. */
export const dependencyRuleSuppressions = pgTable('dependency_rule_suppressions', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  primaryAssetId: uuid('primary_asset_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'dependency_rule_suppressions_pk', columns: [table.tenantId, table.supportingAssetId, table.primaryAssetId] }),
  foreignKey({
    name: 'dependency_rule_suppressions_supporting_asset_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'dependency_rule_suppressions_primary_asset_fk',
    columns: [table.primaryAssetId, table.tenantId],
    foreignColumns: [primaryAssets.id, primaryAssets.tenantId],
  }).onDelete('cascade'),
  index('dependency_rule_suppressions_primary_asset_idx').on(table.primaryAssetId, table.tenantId),
]);

defineSecurityPolicies(dependencyRuleSuppressions, tenantIsolationPolicy);

export const supportToSupportLinks = pgTable('support_to_support_links', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  providerAssetId: uuid('provider_asset_id').notNull(),
  dependentAssetId: uuid('dependent_asset_id').notNull(),
}, (table) => [
  unique(SUPPORT_TO_SUPPORT_PAIR_UNIQUE).on(table.providerAssetId, table.dependentAssetId),
  foreignKey({
    name: 'support_to_support_links_provider_asset_tenant_fk',
    columns: [table.providerAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'support_to_support_links_dependent_asset_tenant_fk',
    columns: [table.dependentAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  index('support_to_support_links_dependent_asset_idx').on(table.dependentAssetId, table.tenantId),
]);

defineSecurityPolicies(supportToSupportLinks, tenantIsolationPolicy);

/** What a dependency between primary assets runs through. Read by display and filters only. */
export const dependencyResourceTypes = pgTable('dependency_resource_types', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
}, (table) => [
  unique('dependency_resource_types_id_tenant_id_uq').on(table.id, table.tenantId),
  unique(DEPENDENCY_RESOURCE_TYPE_NAME_UNIQUE).on(table.tenantId, table.nameFolded),
]);

defineSecurityPolicies(dependencyResourceTypes, tenantIsolationPolicy);

/** Both ends belong to one organization, which the service checks and the database does not. */
export const primaryToPrimaryLinks = pgTable('primary_to_primary_links', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  dependentAssetId: uuid('dependent_asset_id').notNull(),
  providerAssetId: uuid('provider_asset_id').notNull(),
  strength: text('strength').$type<PrimaryToPrimaryLinkStrength>().notNull().default(UNKNOWN_LINK_STRENGTH),
  dependencyResourceTypeId: uuid('dependency_resource_type_id'),
}, (table) => [
  unique(PRIMARY_TO_PRIMARY_PAIR_UNIQUE).on(table.dependentAssetId, table.providerAssetId),
  // No `set null`: on this composite key it would null `tenant_id` too, so deleting a type clears it
  // from its links first (`deleteDependencyResourceType`).
  foreignKey({
    name: 'primary_to_primary_links_resource_type_tenant_fk',
    columns: [table.dependencyResourceTypeId, table.tenantId],
    foreignColumns: [dependencyResourceTypes.id, dependencyResourceTypes.tenantId],
  }),
  index('primary_to_primary_links_resource_type_idx').on(table.dependencyResourceTypeId, table.tenantId)
    .where(sql`${table.dependencyResourceTypeId} IS NOT NULL`),
  foreignKey({
    name: 'primary_to_primary_links_dependent_asset_tenant_fk',
    columns: [table.dependentAssetId, table.tenantId],
    foreignColumns: [primaryAssets.id, primaryAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'primary_to_primary_links_provider_asset_tenant_fk',
    columns: [table.providerAssetId, table.tenantId],
    foreignColumns: [primaryAssets.id, primaryAssets.tenantId],
  }).onDelete('cascade'),
  index('primary_to_primary_links_provider_asset_idx').on(table.providerAssetId, table.tenantId),
  check('primary_to_primary_links_not_self_ck', sql`${table.dependentAssetId} <> ${table.providerAssetId}`),
  check('primary_to_primary_links_strength_known_ck', sql`${table.strength} IN (${LINK_STRENGTH_LITERALS})`),
]);

defineSecurityPolicies(primaryToPrimaryLinks, tenantIsolationPolicy);

/**
 * Every supporting asset a primary asset reaches, at the shortest depth, written by the reach job
 * alone. The organization is copied onto each row so a dashboard scopes on this table's own column
 * instead of joining `primary_assets`, a join the planner misestimates on a wide reach.
 */
export const primaryAssetReach = pgTable('primary_asset_reach', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  primaryAssetId: uuid('primary_asset_id').notNull(),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  depth: smallint('depth').notNull(),
}, (table) => [
  // `tenantId` leads, so the job's upsert can name the key as a certified `onConflictDoOverwrite` target.
  primaryKey({ name: 'primary_asset_reach_pk', columns: [table.tenantId, table.primaryAssetId, table.supportingAssetId] }),
  foreignKey({
    name: 'primary_asset_reach_primary_asset_fk',
    columns: [table.primaryAssetId, table.tenantId],
    foreignColumns: [primaryAssets.id, primaryAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'primary_asset_reach_supporting_asset_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'primary_asset_reach_organization_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('primary_asset_reach_organization_idx').on(table.tenantId, table.organizationId, table.supportingAssetId),
  index('primary_asset_reach_supporting_asset_idx').on(table.supportingAssetId, table.tenantId),
  check('primary_asset_reach_depth_ck', sql`${table.depth} BETWEEN 0 AND ${sql.raw(String(MAX_REACH_DEPTH))}`),
]);

defineSecurityPolicies(primaryAssetReach, tenantIsolationPolicy);
