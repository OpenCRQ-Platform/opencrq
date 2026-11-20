import { and, eq, inArray, or } from 'drizzle-orm';
import type { SeedFunction } from '../../../seed-registry';
import type { AssetCategory } from '../../supporting-assets/constants';
import { deriveSeedId } from '../../../seed-ids';
import { registerSeed } from '../../../seed-registry';
// Evaluated first so the ATT&CK seed registers, and runs, before this one: a deployment seeds once
// per app version, so a technique the release adds has to exist when this seeder links it.
import '../../mitre-attack/data/mitre-attack-seed';
import { ASSET_CATEGORY_VALUES } from '../../supporting-assets/constants';
import { mitreTechniquesData } from '../../mitre-attack/data/mitre-techniques';
import { tenants } from '../../tenants/schema';
import { attackSurfaceMitreTechniques, attackSurfaces } from '../schema';
import { APPLICABLE_TECHNIQUES } from './applicable-techniques-data';

/**
 * The vendored table, bound to the product's own category vocabulary.
 * A category the generator stopped emitting fails to compile here rather than seeding empty.
 */
const APPLICABLE_TECHNIQUES_BY_CATEGORY: Record<AssetCategory, ReadonlyArray<string>> = APPLICABLE_TECHNIQUES;

/**
 * The row id a newly provisioned attack surface takes, derived from the tenant and the category it
 * stands for. Surfaces provisioned before this derivation existed carry ids of their own, so it
 * never stands in for the id a tenant actually holds: only a read of `attack_surfaces` answers that.
 */
export const deriveAttackSurfaceId = (tenantId: string, categoryId: AssetCategory): string => deriveSeedId(categoryId, tenantId);

/** One attack surface per asset category, the shape every tenant is provisioned with. */
export const buildAttackSurfaceRows = (tenantId: string): Array<typeof attackSurfaces.$inferInsert> => (
  ASSET_CATEGORY_VALUES.map((categoryId) => ({ id: deriveAttackSurfaceId(tenantId, categoryId), tenantId, categoryId }))
);

/** The surface each family's junction rows hang off, keyed by the family. */
export type AttackSurfaceIdByCategory = ReadonlyMap<AssetCategory, string>;

export const toAttackSurfaceIdByCategory = (
  surfaces: ReadonlyArray<{ id: string, categoryId: AssetCategory }>,
): AttackSurfaceIdByCategory => new Map(surfaces.map((surface) => [surface.categoryId, surface.id]));

const TECHNIQUE_ID_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique.id]));

/**
 * The external ids the vendored table cites that the product's MITRE reference data does not carry.
 * Never empty at runtime without the build having failed first: the co-located data test asserts
 * it is empty, because a file citing an unknown technique seeds a silently thinner table.
 */
export const UNRESOLVED_TECHNIQUE_EXTERNAL_IDS: ReadonlyArray<string> = [...new Set(
  ASSET_CATEGORY_VALUES.flatMap((categoryId) => APPLICABLE_TECHNIQUES_BY_CATEGORY[categoryId])
    .filter((externalId) => !TECHNIQUE_ID_BY_EXTERNAL_ID.has(externalId)),
)].sort();

/**
 * The tenant's family x applicable technique rows, derived from the vendored table.
 * The single place the table's external ids are resolved: the tenant bootstrap and the boot seeder
 * both build their rows here, so they can never diverge.
 */
export const buildApplicableTechniqueRows = (
  surfaceIdByCategory: AttackSurfaceIdByCategory,
): Array<typeof attackSurfaceMitreTechniques.$inferInsert> => (
  ASSET_CATEGORY_VALUES.flatMap((categoryId) => {
    const attackSurfaceId = surfaceIdByCategory.get(categoryId);
    if (attackSurfaceId === undefined) {
      return [];
    }
    return APPLICABLE_TECHNIQUES_BY_CATEGORY[categoryId].flatMap((externalId) => {
      const mitreTechniqueId = TECHNIQUE_ID_BY_EXTERNAL_ID.get(externalId);
      return mitreTechniqueId === undefined ? [] : [{ attackSurfaceId, mitreTechniqueId }];
    });
  })
);

const pairKey = (row: { attackSurfaceId: string, mitreTechniqueId: string }): string => `${row.attackSurfaceId}:${row.mitreTechniqueId}`;

/**
 * Reprovisions the family x applicable technique table into every tenant on boot, so that editing
 * the vendored table and rebooting is the whole update procedure. The junction carries no payload
 * beyond its own key, which is why a conflict has nothing to update: what a changed reference
 * produces is an insert and a prune, never an update.
 * This seeder links the MITRE techniques but never writes them, that is the MITRE seed's job.
 */
export const seedApplicableTechniques: SeedFunction = async (db) => {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  if (allTenants.length === 0) {
    return;
  }

  for (const tenant of allTenants) {
    await db.insert(attackSurfaces).values(buildAttackSurfaceRows(tenant.id)).onConflictDoNothing();

    // A tenant provisioned before the surface ids became derived holds ids of its own, and the
    // insert above leaves them untouched, so the junction has to hang off what the read returns.
    const surfaces = await db.select({ id: attackSurfaces.id, categoryId: attackSurfaces.categoryId })
      .from(attackSurfaces)
      .where(eq(attackSurfaces.tenantId, tenant.id));
    const surfaceIds = surfaces.map((surface) => surface.id);

    const curatedRows = buildApplicableTechniqueRows(toAttackSurfaceIdByCategory(surfaces));
    const curatedKeys = new Set(curatedRows.map(pairKey));
    const existingRows = await db.select({
      attackSurfaceId: attackSurfaceMitreTechniques.attackSurfaceId,
      mitreTechniqueId: attackSurfaceMitreTechniques.mitreTechniqueId,
    })
      .from(attackSurfaceMitreTechniques)
      .where(inArray(attackSurfaceMitreTechniques.attackSurfaceId, surfaceIds));
    const existingKeys = new Set(existingRows.map(pairKey));

    const missingRows = curatedRows.filter((row) => !existingKeys.has(pairKey(row)));
    if (missingRows.length > 0) {
      await db.insert(attackSurfaceMitreTechniques).values(missingRows).onConflictDoNothing();
    }

    /*
     * Prune what left the reference. When tenant editing is unlocked, this delete must skip rows
     * the tenant owns, which is why the unlock needs a provenance marker on the row. The stale
     * pairs are grouped by surface so the predicate stays one `in` list per family, and every
     * surface it names came from this tenant's own rows.
     */
    const staleTechniqueIdsBySurface = new Map<string, Array<string>>();
    for (const row of existingRows) {
      if (curatedKeys.has(pairKey(row))) {
        continue;
      }
      staleTechniqueIdsBySurface.set(row.attackSurfaceId, [...(staleTechniqueIdsBySurface.get(row.attackSurfaceId) ?? []), row.mitreTechniqueId]);
    }
    if (staleTechniqueIdsBySurface.size > 0) {
      await db.delete(attackSurfaceMitreTechniques).where(or(
        ...[...staleTechniqueIdsBySurface].map(([attackSurfaceId, techniqueIds]) => and(
          eq(attackSurfaceMitreTechniques.attackSurfaceId, attackSurfaceId),
          inArray(attackSurfaceMitreTechniques.mitreTechniqueId, techniqueIds),
        )),
      ));
    }
  }
};

registerSeed(seedApplicableTechniques);
