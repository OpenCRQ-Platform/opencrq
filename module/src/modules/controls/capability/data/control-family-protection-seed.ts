import { and, eq, inArray } from 'drizzle-orm';
import type { SeedFunction } from '../../../../seed-registry';
import type { AssetCategory } from '../../../supporting-assets/constants';
import { registerSeed } from '../../../../seed-registry';
import { chunk } from '../../../../seed-batch';
import { controlCapabilityProtectedFamilies } from '../schema';
import { controlCapabilitiesData } from './capabilities.generated';
import { CONTROL_FAMILY_PROTECTION } from './control-family-protection';

/**
 * The vendored table, bound to the product's own category vocabulary.
 * A family outside that vocabulary fails to compile here rather than seeding a category no asset
 * can ever be counted under; the unclassified bucket is excluded by the generator's own invariant.
 */
export const PROTECTION_BY_EXTERNAL_ID: Readonly<Record<string, ReadonlyArray<AssetCategory>>> = CONTROL_FAMILY_PROTECTION;

const CAPABILITY_ID_BY_EXTERNAL_ID = new Map(controlCapabilitiesData.map((capability) => [capability.externalId, capability.id]));

/**
 * The capability external ids the vendored table cites that the catalogue does not carry.
 * Never non-empty at runtime without the build having failed first: the co-located data test
 * asserts it is empty, because a table citing an unknown capability seeds a silently thinner table,
 * and every control it names is then credited on no finding at all.
 */
export const UNRESOLVED_PROTECTION_CAPABILITY_EXTERNAL_IDS: ReadonlyArray<string> = Object.keys(PROTECTION_BY_EXTERNAL_ID)
  .filter((externalId) => !CAPABILITY_ID_BY_EXTERNAL_ID.has(externalId))
  .sort();

/** The table's rows, with the vendored external ids resolved against the catalogue. */
export const buildControlFamilyProtectionRows = (): Array<typeof controlCapabilityProtectedFamilies.$inferInsert> => (
  Object.entries(PROTECTION_BY_EXTERNAL_ID).flatMap(([externalId, families]) => {
    const capabilityId = CAPABILITY_ID_BY_EXTERNAL_ID.get(externalId);
    return capabilityId === undefined ? [] : families.map((categoryId) => ({ capabilityId, categoryId }));
  })
);

const rowKey = (row: { capabilityId: string, categoryId: AssetCategory }): string => `${row.capabilityId}:${row.categoryId}`;

/**
 * Reprovisions the control x protected asset family table on boot, so that vendoring a new release
 * of the table and rebooting is the whole update procedure. A row is its key and nothing else, so a
 * conflict has nothing worth rewriting: what a changed reference produces is an insert and a prune.
 */
export const seedControlFamilyProtection: SeedFunction = async (db) => {
  const curatedRows = buildControlFamilyProtectionRows();
  const curatedKeys = new Set(curatedRows.map(rowKey));

  for (const rows of chunk(curatedRows)) {
    await db.insert(controlCapabilityProtectedFamilies).values(rows).onConflictDoNothing();
  }

  const existingRows = await db.select({
    capabilityId: controlCapabilityProtectedFamilies.capabilityId,
    categoryId: controlCapabilityProtectedFamilies.categoryId,
  }).from(controlCapabilityProtectedFamilies);

  const staleByCapability = new Map<string, Array<AssetCategory>>();
  for (const row of existingRows) {
    if (curatedKeys.has(rowKey(row))) {
      continue;
    }
    staleByCapability.set(row.capabilityId, [...(staleByCapability.get(row.capabilityId) ?? []), row.categoryId]);
  }
  for (const [capabilityId, categoryIds] of staleByCapability) {
    await db.delete(controlCapabilityProtectedFamilies).where(and(
      eq(controlCapabilityProtectedFamilies.capabilityId, capabilityId),
      inArray(controlCapabilityProtectedFamilies.categoryId, categoryIds),
    ));
  }
};

registerSeed(seedControlFamilyProtection);
