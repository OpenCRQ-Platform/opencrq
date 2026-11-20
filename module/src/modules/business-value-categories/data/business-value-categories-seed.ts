import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { SeedFunction } from '../../../seed-registry';
import { deriveSeedId } from '../../../seed-ids';
import { registerSeed } from '../../../seed-registry';
import { tenants } from '../../tenants/schema';
import { businessValueCategories } from '../schema';
import { BUSINESS_VALUE_CATEGORIES } from './business-value-categories-data';

/**
 * The tenant's business resource rows, derived from {@link BUSINESS_VALUE_CATEGORIES}.
 * Every row id comes from the catalog UUID through {@link deriveSeedId}, so the same tenant
 * always rebuilds the same rows and no caller ever resolves an entry by name or position.
 */
export const buildBusinessValueCategoryRows = (tenantId: string): Array<typeof businessValueCategories.$inferInsert> => (
  BUSINESS_VALUE_CATEGORIES.map((category) => ({
    id: deriveSeedId(tenantId, category.id),
    tenantId,
    code: category.code,
    name: category.name,
    description: category.description,
    displayOrder: category.displayOrder,
  }))
);

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const categoryUpdate = {
  code: sql`excluded.code`,
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  displayOrder: sql`excluded.display_order`,
};
const categoryDiverged = sql`${businessValueCategories.code} IS DISTINCT FROM excluded.code
  OR ${businessValueCategories.name} IS DISTINCT FROM excluded.name
  OR ${businessValueCategories.description} IS DISTINCT FROM excluded.description
  OR ${businessValueCategories.displayOrder} IS DISTINCT FROM excluded.display_order`;

/**
 * Reprovisions the closed business resource catalog into every tenant on boot.
 * Rows are keyed by the deterministic id derived from the catalog entry, so editing the reference
 * and rebooting is the whole update procedure.
 *
 * Pruning an entry that left the reference cascades to every primary asset already tagged with it,
 * so retiring one once tenants hold real assets needs a migration that moves those links first.
 * When tenant editing is unlocked, this delete must skip rows the tenant owns, which is why the
 * unlock needs a provenance marker on the row.
 */
export const seedBusinessValueCategories: SeedFunction = async (db) => {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);

  for (const tenant of allTenants) {
    const categoryRows = buildBusinessValueCategoryRows(tenant.id);

    await db.insert(businessValueCategories).values(categoryRows)
      .onConflictDoUpdate({ target: businessValueCategories.id, set: categoryUpdate, setWhere: categoryDiverged });
    await db.delete(businessValueCategories)
      .where(and(eq(businessValueCategories.tenantId, tenant.id), notInArray(businessValueCategories.id, categoryRows.map((row) => row.id))));
  }
};

registerSeed(seedBusinessValueCategories);
