import { sql } from 'drizzle-orm';
import { check, doublePrecision, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { AssetMappingChange, EstateMode, OrganizationIdentityField, RevenueBand } from './constants';
import { journalCreatedAt } from '../../db/journal-value';
import {
  defineSecurityPolicies,
  organizationAssetPairingPolicy,
  organizationTenantIsolationPolicy,
  tenantIsolationPolicy,
  userOwnedRowsPolicy,
} from '../../security';
import { countries } from '../countries/schema';
import { sectors } from '../sectors/schema';
import { supportingAssets } from '../supporting-assets/schema';
import { tenants } from '../tenants';
import { users } from '../users/schema';

/** Postgres's default name for the primary key, which a duplicate id hits whichever tenant holds it. */
export const ORGANIZATIONS_PKEY = 'organizations_pkey';
export const ORGANIZATIONS_ID_TENANT_UNIQUE = 'organizations_id_tenant_id_uq';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  legalEntityName: text('legal_entity_name'),
  sectorId: uuid('sector_id'),
  countryId: uuid('country_id'),
  revenueBand: text('revenue_band').$type<RevenueBand>(),
  employeeCount: integer('employee_count'),
  domain: text('domain'),
  reactionTimeMin: doublePrecision('reaction_time_min'),
  reactionTimeLikely: doublePrecision('reaction_time_likely'),
  reactionTimeMax: doublePrecision('reaction_time_max'),
  estateMode: text('estate_mode').$type<EstateMode>().notNull().default('open'),
  estateChangedAt: timestamp('estate_changed_at', { withTimezone: true }),
}, (table) => [
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique(ORGANIZATIONS_ID_TENANT_UNIQUE).on(table.id, table.tenantId),
  // A sector or a country goes only with its tenant, whose cascade takes the scope too. The seed's
  // realignment of their ids reaches the scope through the update cascade.
  foreignKey({
    name: 'organizations_sector_tenant_fk',
    columns: [table.sectorId, table.tenantId],
    foreignColumns: [sectors.id, sectors.tenantId],
  }).onUpdate('cascade'),
  foreignKey({
    name: 'organizations_country_tenant_fk',
    columns: [table.countryId, table.tenantId],
    foreignColumns: [countries.id, countries.tenantId],
  }).onUpdate('cascade'),
]);

defineSecurityPolicies(organizations, tenantIsolationPolicy);

/**
 * The assets a closed scope is measured over. Every reader joins it rather than resolving it to a
 * list of ids: one scope may map hundreds of thousands of rows. Rows survive a return to the whole
 * estate, so reopening then closing a scope again does not lose its mapping.
 */
export const organizationAssets = pgTable('organization_assets', {
  organizationId: uuid('organization_id').notNull(),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.supportingAssetId] }),
  // Both ends carry the tenant into their foreign key, so a row pairing a scope and an asset of
  // two different tenants is refused by the database rather than by the policy alone.
  foreignKey({
    name: 'organization_assets_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'organization_assets_supporting_asset_tenant_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  // The cascade from `supporting_assets` scans this table once per deleted asset, and a connector
  // sweep deletes them by the thousand in one transaction.
  index('organization_assets_supporting_asset_idx').on(table.supportingAssetId),
]);

defineSecurityPolicies(organizationAssets, tenantIsolationPolicy, organizationAssetPairingPolicy);

/** The scopes a user keeps out of their navigation bar: a scope with no row is pinned, so a new scope shows for everyone. */
export const organizationUnpins = pgTable('organization_unpins', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.organizationId] }),
  foreignKey({
    name: 'organization_unpins_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('organization_unpins_organization_idx').on(table.organizationId),
]);

defineSecurityPolicies(organizationUnpins, tenantIsolationPolicy, userOwnedRowsPolicy);

/** Kept off `organizations`, which the loss estimates recompute reads: saving a tolerance must wake no recompute. */
export const organizationRiskTolerances = pgTable('organization_risk_tolerances', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  annualLoss: doublePrecision('annual_loss').notNull(),
  maxExceedanceProbability: doublePrecision('max_exceedance_probability').notNull(),
}, (table) => [
  unique('organization_risk_tolerances_organization_unique').on(table.organizationId),
  foreignKey({ name: 'organization_risk_tolerances_organization_fk', columns: [table.organizationId], foreignColumns: [organizations.id] }).onDelete('cascade'),
  check('organization_risk_tolerances_annual_loss_ck', sql`${table.annualLoss} > 0`),
  check('organization_risk_tolerances_probability_ck', sql`${table.maxExceedanceProbability} BETWEEN 0.001 AND 1`),
]);

defineSecurityPolicies(organizationRiskTolerances, organizationTenantIsolationPolicy);

/** One identity field changed by one save, its value before and after as `encodeJournalValue` writes it. */
export const organizationIdentityEvents = pgTable('organization_identity_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  field: text('field').notNull().$type<OrganizationIdentityField>(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: journalCreatedAt(),
}, (table) => [
  foreignKey({
    name: 'organization_identity_events_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('organization_identity_events_organization_date_idx').on(table.organizationId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
]);

defineSecurityPolicies(organizationIdentityEvents, tenantIsolationPolicy);

/**
 * One save that changed what a scope maps: the counts are kept here because an asset deleted since
 * leaves the event's asset rows, and the estate modes are set only when the save switched it.
 */
export const organizationAssetMappingEvents = pgTable('organization_asset_mapping_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  addedCount: integer('added_count').notNull(),
  removedCount: integer('removed_count').notNull(),
  oldEstateMode: text('old_estate_mode').$type<EstateMode>(),
  newEstateMode: text('new_estate_mode').$type<EstateMode>(),
  createdAt: journalCreatedAt(),
}, (table) => [
  unique('organization_asset_mapping_events_id_tenant_id_uq').on(table.id, table.tenantId),
  foreignKey({
    name: 'organization_asset_mapping_events_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('organization_asset_mapping_events_organization_date_idx').on(table.organizationId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
]);

defineSecurityPolicies(organizationAssetMappingEvents, tenantIsolationPolicy);

export const organizationAssetMappingEventAssets = pgTable('organization_asset_mapping_event_assets', {
  eventId: uuid('event_id').notNull(),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  change: text('change').notNull().$type<AssetMappingChange>(),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.supportingAssetId] }),
  foreignKey({
    name: 'organization_asset_mapping_event_assets_event_tenant_fk',
    columns: [table.eventId, table.tenantId],
    foreignColumns: [organizationAssetMappingEvents.id, organizationAssetMappingEvents.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'organization_asset_mapping_event_assets_asset_tenant_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  index('organization_asset_mapping_event_assets_asset_idx').on(table.supportingAssetId),
]);

defineSecurityPolicies(organizationAssetMappingEventAssets, tenantIsolationPolicy);
