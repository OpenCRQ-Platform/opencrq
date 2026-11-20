import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { SupportToPrimaryLinkRole } from './link-roles';
import type { PrimaryToPrimaryLinkStrength } from './link-strengths';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { organizations } from '../organizations/schema';
import { primaryAssets } from '../primary-assets/schema';
import { supportingAssets } from '../supporting-assets/schema';
import { tenants } from '../tenants';
import { SUPPORT_TO_PRIMARY_LINK_ROLES, UNKNOWN_LINK_ROLE } from './link-roles';
import { PRIMARY_TO_PRIMARY_LINK_STRENGTHS, UNKNOWN_LINK_STRENGTH } from './link-strengths';
import { MAX_REACH_DEPTH } from './reach';

const SUPPORT_TO_PRIMARY_PAIR_UNIQUE = 'support_to_primary_links_pair_uq';
const SUPPORT_TO_SUPPORT_PAIR_UNIQUE = 'support_to_support_links_pair_uq';
const PRIMARY_TO_PRIMARY_PAIR_UNIQUE = 'primary_to_primary_links_pair_uq';

const LINK_ROLE_LITERALS = sql.raw(SUPPORT_TO_PRIMARY_LINK_ROLES.map((role) => `'${role}'`).join(', '));
const LINK_STRENGTH_LITERALS = sql.raw(PRIMARY_TO_PRIMARY_LINK_STRENGTHS.map((strength) => `'${strength}'`).join(', '));

export const supportToPrimaryLinks = pgTable('support_to_primary_links', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  primaryAssetId: uuid('primary_asset_id').notNull(),
  roles: text('roles').array().$type<Array<SupportToPrimaryLinkRole>>().notNull().default(sql.raw(`'{${UNKNOWN_LINK_ROLE}}'`)),
}, (table) => [
  unique(SUPPORT_TO_PRIMARY_PAIR_UNIQUE).on(table.supportingAssetId, table.primaryAssetId),
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

/** Both ends belong to one organization, which the service checks and the database does not. */
export const primaryToPrimaryLinks = pgTable('primary_to_primary_links', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  dependentAssetId: uuid('dependent_asset_id').notNull(),
  providerAssetId: uuid('provider_asset_id').notNull(),
  strength: text('strength').$type<PrimaryToPrimaryLinkStrength>().notNull().default(UNKNOWN_LINK_STRENGTH),
}, (table) => [
  unique(PRIMARY_TO_PRIMARY_PAIR_UNIQUE).on(table.dependentAssetId, table.providerAssetId),
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
