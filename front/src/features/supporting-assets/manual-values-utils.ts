import type { AssetManualAttribute, AssetSubcategory } from '@app/module/client';

/**
 * The hand-set values the asset currently reads. A pinned subcategory the category has since moved
 * away from is dormant: the resolver drops it, so no field may say it was set by hand. It is still
 * a pin — `Resync with connectors` counts and clears it — so only the marker and the caveat read
 * through this.
 */
export const manualValuesInEffect = <T extends { attribute: AssetManualAttribute, value: string | null }>(
  manualValues: ReadonlyArray<T>,
  subcategoryId: AssetSubcategory | null,
): Array<T> => manualValues.filter((v) => v.attribute !== 'subcategory' || v.value === subcategoryId);
