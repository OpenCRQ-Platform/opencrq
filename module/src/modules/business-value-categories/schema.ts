import { integer, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, primaryAssetTenantIsolationPolicy, tenantIsolationPolicy } from '../../security';
import { primaryAssets } from '../primary-assets/schema';
import { tenants } from '../tenants';

/** The ten flat business resources, still `business-value category` in code. */
export const businessValueCategories = pgTable('business_value_categories', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // The key the frontend translates the name and the picker line on: the backend never translates.
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  displayOrder: integer('display_order').notNull(),
}, (table) => [
  unique('business_value_categories_tenant_code_uq').on(table.tenantId, table.code),
]);

defineSecurityPolicies(businessValueCategories, tenantIsolationPolicy);

export const primaryAssetBusinessValueCategories = pgTable('primary_asset_business_value_categories', {
  primaryAssetId: uuid('primary_asset_id').notNull().references(() => primaryAssets.id, { onDelete: 'cascade' }),
  businessValueCategoryId: uuid('business_value_category_id').notNull().references(() => businessValueCategories.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ name: 'pa_business_value_categories_pk', columns: [table.primaryAssetId, table.businessValueCategoryId] }),
]);

defineSecurityPolicies(primaryAssetBusinessValueCategories, primaryAssetTenantIsolationPolicy);
