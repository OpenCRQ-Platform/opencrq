import { integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { DwellSensitivity, ScalingVariable } from './data/loss-drivers-constants';
import { attackOutcomeTenantIsolationPolicy, defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { attackOutcomes } from '../attack-outcomes/schema';
import { businessValueCategories } from '../business-value-categories/schema';
import { tenants } from '../tenants';

/** Reporting level above the drivers. */
export const lossCategories = pgTable('loss_categories', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  displayOrder: integer('display_order').notNull(),
});

defineSecurityPolicies(lossCategories, tenantIsolationPolicy);

export const lossDrivers = pgTable('loss_drivers', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  lossCategoryId: uuid('loss_category_id').notNull().references(() => lossCategories.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** Rank of the driver inside its loss category. */
  displayOrder: integer('display_order').notNull(),
  /** How much attacker dwell time changes the size of the driver. */
  dwellSensitivity: text('dwell_sensitivity').notNull().$type<DwellSensitivity>(),
  /** The business quantity the driver scales with. */
  scalingVariable: text('scaling_variable').notNull().$type<ScalingVariable>(),
});

defineSecurityPolicies(lossDrivers, tenantIsolationPolicy);

/**
 * The activation matrix: which loss drivers a pairing of an attack outcome with a business-value
 * category calls for. Reference data, seeded per tenant and never written from the product.
 *
 * The row is all key and no payload: membership is the whole content. Compatibility of a pairing is
 * the existence of at least one row for it, never a stored flag.
 */
export const lossDriverActivations = pgTable('loss_driver_activations', {
  attackOutcomeId: uuid('attack_outcome_id').notNull().references(() => attackOutcomes.id, { onDelete: 'cascade' }),
  businessValueCategoryId: uuid('business_value_category_id').notNull().references(() => businessValueCategories.id, { onDelete: 'cascade' }),
  lossDriverId: uuid('loss_driver_id').notNull().references(() => lossDrivers.id, { onDelete: 'cascade' }),
}, (table) => [
  // Named explicitly: the generated name would concatenate the table and all three columns, far
  // past Postgres' 63-character identifier limit.
  primaryKey({ name: 'loss_driver_activations_pk', columns: [table.attackOutcomeId, table.businessValueCategoryId, table.lossDriverId] }),
]);

defineSecurityPolicies(lossDriverActivations, attackOutcomeTenantIsolationPolicy);
