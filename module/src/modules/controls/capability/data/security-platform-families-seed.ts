import { sql } from 'drizzle-orm';
import { registerSeed } from '../../../../seed-registry';
import { securityPlatformFamilies, securityPlatformFamilyControls } from '../schema';
import { controlCapabilitiesData } from './capabilities.generated';
import { SECURITY_PLATFORM_FAMILIES, SECURITY_PLATFORM_FAMILY_CONTROLS } from './security-platform-families';

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const familyUpdate = {
  id: sql`excluded.id`,
  name: sql`excluded.name`,
};
const capabilityIdByExternalId = new Map(controlCapabilitiesData.map((cap) => [cap.externalId, cap.id]));
const familyIdByKey = new Map(SECURITY_PLATFORM_FAMILIES.map((family) => [family.platformTypeKey, family.id]));

/**
 * The (family, control) rows the authored mapping resolves to. A control external id the
 * catalogue no longer carries is skipped rather than failing the boot: the catalogue is
 * regenerated upstream and may retire an entry before this mapping is revisited.
 */
export const buildSecurityPlatformFamilyControlRows = (): Array<typeof securityPlatformFamilyControls.$inferInsert> =>
  Object.entries(SECURITY_PLATFORM_FAMILY_CONTROLS).flatMap(([platformTypeKey, controlExternalIds]) => {
    const familyId = familyIdByKey.get(platformTypeKey);
    if (!familyId) {
      return [];
    }
    return controlExternalIds.flatMap((externalId) => {
      const capabilityId = capabilityIdByExternalId.get(externalId);
      return capabilityId ? [{ familyId, capabilityId }] : [];
    });
  });

// Platform reference seed for the security-platform families and their control links.
// Global, never tenant-editable: an ingested platform instance resolves to a family on
// `platform_type_key`, and the family carries the controls it implements.
// The divergence predicate reads schema columns, so it is built here rather than at module scope:
// `../schema` reaches this file back through the security policies, and a table read at import
// time would then be undefined depending on which module the process loaded first.
registerSeed(async (db) => {
  const familyDiverged = sql`${securityPlatformFamilies.id} IS DISTINCT FROM excluded.id
    OR ${securityPlatformFamilies.name} IS DISTINCT FROM excluded.name`;

  await db
    .insert(securityPlatformFamilies)
    .values(SECURITY_PLATFORM_FAMILIES)
    .onConflictDoUpdate({ target: securityPlatformFamilies.platformTypeKey, set: familyUpdate, setWhere: familyDiverged });

  const links = buildSecurityPlatformFamilyControlRows();
  if (links.length > 0) {
    // A link row is all key and no payload, so there is nothing to update on conflict.
    await db.insert(securityPlatformFamilyControls).values(links).onConflictDoNothing();
  }

  // Drop the pairs the authored mapping no longer carries, so a boot converges on it instead
  // of accumulating every mapping the platform has ever shipped. Deleting only the stale rows
  // keeps the change-notification trigger quiet on an unchanged mapping.
  const desiredPairs = links.map((link) => sql`(${link.familyId}::uuid, ${link.capabilityId}::uuid)`);
  await db
    .delete(securityPlatformFamilyControls)
    .where(desiredPairs.length > 0
      ? sql`(${securityPlatformFamilyControls.familyId}, ${securityPlatformFamilyControls.capabilityId}) NOT IN (${sql.join(desiredPairs, sql`, `)})`
      : sql`true`);
});
