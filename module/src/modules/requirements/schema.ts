import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { businessValueCategories } from '../business-value-categories/schema';
import { lossDrivers } from '../loss-drivers/schema';
import { organizations } from '../organizations/schema';
import { primaryAssets } from '../primary-assets/schema';
import { tenants } from '../tenants';

/** An obligation owed to an interested party. Which scenarios break it is computed when read, never stored. */
export const requirements = pgTable('requirements', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  description: text('description'),
  interestedParty: text('interested_party').notNull(),
  protectsConfidentiality: boolean('protects_confidentiality').notNull().default(false),
  protectsIntegrity: boolean('protects_integrity').notNull().default(false),
  protectsAvailability: boolean('protects_availability').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('requirements_id_tenant_id_uq').on(table.id, table.tenantId),
  foreignKey({
    name: 'requirements_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('requirements_organization_tenant_idx').on(table.organizationId, table.tenantId),
]);

defineSecurityPolicies(requirements, tenantIsolationPolicy);

/** A business resource category stands for every primary asset carrying it. A supporting asset is never a target. */
export const requirementTargets = pgTable('requirement_targets', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requirementId: uuid('requirement_id').notNull(),
  primaryAssetId: uuid('primary_asset_id'),
  businessValueCategoryId: uuid('business_value_category_id'),
}, (table) => [
  foreignKey({
    name: 'requirement_targets_requirement_fk',
    columns: [table.requirementId, table.tenantId],
    foreignColumns: [requirements.id, requirements.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'requirement_targets_primary_asset_fk',
    columns: [table.primaryAssetId, table.tenantId],
    foreignColumns: [primaryAssets.id, primaryAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'requirement_targets_category_fk',
    columns: [table.businessValueCategoryId, table.tenantId],
    foreignColumns: [businessValueCategories.id, businessValueCategories.tenantId],
  }).onDelete('cascade'),
  index('requirement_targets_requirement_idx').on(table.requirementId),
  uniqueIndex('requirement_targets_primary_asset_uq').on(table.primaryAssetId, table.requirementId)
    .where(sql`${table.primaryAssetId} IS NOT NULL`),
  uniqueIndex('requirement_targets_category_uq').on(table.businessValueCategoryId, table.requirementId)
    .where(sql`${table.businessValueCategoryId} IS NOT NULL`),
  check('requirement_targets_one_target_ck', sql`num_nonnulls(${table.primaryAssetId}, ${table.businessValueCategoryId}) = 1`),
]);

defineSecurityPolicies(requirementTargets, tenantIsolationPolicy);

export const requirementLossDriverActivations = pgTable('requirement_loss_driver_activations', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requirementId: uuid('requirement_id').notNull(),
  lossDriverId: uuid('loss_driver_id').notNull(),
}, (table) => [
  primaryKey({ name: 'requirement_loss_driver_activations_pk', columns: [table.requirementId, table.lossDriverId] }),
  foreignKey({
    name: 'requirement_loss_driver_activations_requirement_fk',
    columns: [table.requirementId, table.tenantId],
    foreignColumns: [requirements.id, requirements.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'requirement_loss_driver_activations_loss_driver_fk',
    columns: [table.lossDriverId, table.tenantId],
    foreignColumns: [lossDrivers.id, lossDrivers.tenantId],
  }).onDelete('cascade'),
  index('requirement_loss_driver_activations_loss_driver_idx').on(table.lossDriverId),
]);

defineSecurityPolicies(requirementLossDriverActivations, tenantIsolationPolicy);
