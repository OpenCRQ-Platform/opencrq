import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { SeedFunction } from '../../../seed-registry';
import { deriveSeedId } from '../../../seed-ids';
import { registerSeed } from '../../../seed-registry';
import { tenants } from '../../tenants/schema';
import { lossCategories, lossDriverActivations, lossDrivers } from '../schema';
import { LOSS_ACTIVATION_MATRIX } from './loss-activation-matrix';
import { LOSS_CATEGORIES, LOSS_DRIVERS } from './loss-drivers-data';

/**
 * The tenant's loss-category rows, derived from {@link LOSS_CATEGORIES}.
 * Every row id comes from the catalog UUID through {@link deriveSeedId}, so the same tenant
 * always rebuilds the same rows and no caller ever resolves an entry by name or position.
 */
export const buildLossCategoryRows = (tenantId: string): Array<typeof lossCategories.$inferInsert> => (
  LOSS_CATEGORIES.map((category) => ({
    id: deriveSeedId(tenantId, category.id),
    tenantId,
    name: category.name,
    description: category.description,
    displayOrder: category.displayOrder,
  }))
);

/**
 * The tenant's loss-driver rows, derived from {@link LOSS_DRIVERS}.
 * A driver's `lossCategoryId` is itself derived from the catalog UUID, so it always resolves to
 * that same tenant's loss-category row built by {@link buildLossCategoryRows}.
 */
export const buildLossDriverRows = (tenantId: string): Array<typeof lossDrivers.$inferInsert> => (
  LOSS_DRIVERS.map((driver) => ({
    id: deriveSeedId(tenantId, driver.id),
    tenantId,
    lossCategoryId: deriveSeedId(tenantId, driver.lossCategoryId),
    name: driver.name,
    description: driver.description,
    displayOrder: driver.displayOrder,
    dwellSensitivity: driver.dwellSensitivity,
    scalingVariable: driver.scalingVariable,
  }))
);

/**
 * The tenant's activation rows, derived from {@link LOSS_ACTIVATION_MATRIX}, one per (cell, driver).
 * All three ids are derived from the catalog UUIDs, so they always resolve to that same tenant's
 * attack-outcome, business-value-category and loss-driver rows.
 */
export const buildLossActivationRows = (tenantId: string): Array<typeof lossDriverActivations.$inferInsert> => (
  LOSS_ACTIVATION_MATRIX.flatMap((cell) => {
    const attackOutcomeId = deriveSeedId(tenantId, cell.attackOutcomeId);
    const businessValueCategoryId = deriveSeedId(tenantId, cell.businessValueCategoryId);
    return cell.lossDriverIds.map((lossDriverId) => ({
      attackOutcomeId,
      businessValueCategoryId,
      lossDriverId: deriveSeedId(tenantId, lossDriverId),
    }));
  })
);

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const lossCategoryUpdate = {
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  displayOrder: sql`excluded.display_order`,
};
const lossCategoryDiverged = sql`${lossCategories.name} IS DISTINCT FROM excluded.name
  OR ${lossCategories.description} IS DISTINCT FROM excluded.description
  OR ${lossCategories.displayOrder} IS DISTINCT FROM excluded.display_order`;

const driverUpdate = {
  lossCategoryId: sql`excluded.loss_category_id`,
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  displayOrder: sql`excluded.display_order`,
  dwellSensitivity: sql`excluded.dwell_sensitivity`,
  scalingVariable: sql`excluded.scaling_variable`,
};
const driverDiverged = sql`${lossDrivers.lossCategoryId} IS DISTINCT FROM excluded.loss_category_id
  OR ${lossDrivers.name} IS DISTINCT FROM excluded.name
  OR ${lossDrivers.description} IS DISTINCT FROM excluded.description
  OR ${lossDrivers.displayOrder} IS DISTINCT FROM excluded.display_order
  OR ${lossDrivers.dwellSensitivity} IS DISTINCT FROM excluded.dwell_sensitivity
  OR ${lossDrivers.scalingVariable} IS DISTINCT FROM excluded.scaling_variable`;

/**
 * Reprovisions the closed loss-category and loss-driver catalogs into every tenant on boot.
 * Rows are keyed by the deterministic id derived from the catalog entry, so editing the reference
 * and rebooting is the whole update procedure.
 *
 * Pruning a driver that left the reference cascades to every amount already saved against it, so
 * retiring an entry once tenants hold real estimates needs a migration that moves those amounts
 * first. When tenant editing is unlocked, this delete must skip rows the tenant owns, which is why
 * the unlock needs a provenance marker on the row.
 */
export const seedLossDrivers: SeedFunction = async (db) => {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);

  for (const tenant of allTenants) {
    const lossCategoryRows = buildLossCategoryRows(tenant.id);
    const driverRows = buildLossDriverRows(tenant.id);
    const activationRows = buildLossActivationRows(tenant.id);

    // Parents first: drivers reference their loss category.
    await db.insert(lossCategories).values(lossCategoryRows)
      .onConflictDoUpdate({ target: lossCategories.id, set: lossCategoryUpdate, setWhere: lossCategoryDiverged });
    await db.insert(lossDrivers).values(driverRows)
      .onConflictDoUpdate({ target: lossDrivers.id, set: driverUpdate, setWhere: driverDiverged });
    // An activation row is all key and no payload, so there is nothing to update on conflict.
    await db.insert(lossDriverActivations).values(activationRows).onConflictDoNothing();

    /*
     * Prune in reverse dependency order. The activation prune must run before the driver prune:
     * deleting a retired driver first cascades its activation rows away, and the prune below would
     * then find nothing to do and look successful for the wrong reason.
     * The delete is scoped to this tenant's derived driver ids and then to the triples the matrix
     * no longer holds, so no other tenant can ever be reached. Rows on a driver that left the
     * catalog fall outside that scope and are carried away by the driver prune's cascade.
     */
    const matrixTriples = activationRows.map((row) =>
      sql`(${row.attackOutcomeId}::uuid, ${row.businessValueCategoryId}::uuid, ${row.lossDriverId}::uuid)`);
    await db.delete(lossDriverActivations).where(and(
      inArray(lossDriverActivations.lossDriverId, driverRows.map((row) => row.id)),
      matrixTriples.length > 0
        ? sql`(${lossDriverActivations.attackOutcomeId}, ${lossDriverActivations.businessValueCategoryId}, ${lossDriverActivations.lossDriverId}) NOT IN (${sql.join(matrixTriples, sql`, `)})`
        : undefined,
    ));
    await db.delete(lossDrivers)
      .where(and(eq(lossDrivers.tenantId, tenant.id), notInArray(lossDrivers.id, driverRows.map((row) => row.id))));
    await db.delete(lossCategories)
      .where(and(eq(lossCategories.tenantId, tenant.id), notInArray(lossCategories.id, lossCategoryRows.map((row) => row.id))));
  }
};

registerSeed(seedLossDrivers);
