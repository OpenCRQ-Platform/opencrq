import type { SupportingAssetExposure } from '../../supporting-assets/schema';
import type { PertRange } from '../types';

export type ExposureCounts = Partial<Record<SupportingAssetExposure, number>>;

export interface ExposureWeights {
  internet_facing: number,
  internal: number,
  unknown: number,
}

export interface AssetRelevanceResult {
  total: PertRange,
  perTechnique: Record<string, PertRange>,
  /** The same weighted volumes the ranges are built from, per touched category. */
  perCategory: Record<string, number>,
}

/**
 * On this scale, one means the technique reaches the whole estate, not a neutral value.
 */
export const resolveUnknownEstateWeight = (touchedCategoryCount: number): number =>
  (touchedCategoryCount === 0 ? 1 : 1 / touchedCategoryCount);

const toPertRange = (value: number): PertRange => ({ min: value, likely: value, max: value });

const computeWeightedVolume = (counts: ExposureCounts, weights: ExposureWeights): number =>
  (counts.internet_facing ?? 0) * weights.internet_facing
  + (counts.internal ?? 0) * weights.internal
  + (counts.unknown ?? 0) * weights.unknown;

const buildCategoryWeightedVolumes = (
  categoryIds: Array<string>,
  supportingAssetCounts: Record<string, ExposureCounts>,
  weights: ExposureWeights,
): Map<string, number> => {
  const volumes = new Map<string, number>();
  for (const categoryId of categoryIds) {
    volumes.set(categoryId, computeWeightedVolume(supportingAssetCounts[categoryId] ?? {}, weights));
  }
  return volumes;
};

const buildPerTechniqueRanges = (
  techniqueCategoryMapping: Record<string, Array<string>>,
  categoryVolumes: Map<string, number>,
): Record<string, PertRange> => {
  const perTechnique: Record<string, PertRange> = {};
  for (const [techniqueId, categoryIds] of Object.entries(techniqueCategoryMapping)) {
    let volume = 0;
    for (const categoryId of categoryIds) {
      volume += categoryVolumes.get(categoryId) ?? 0;
    }
    perTechnique[techniqueId] = toPertRange(volume);
  }
  return perTechnique;
};

/**
 * A category's perimeter is what has been inventoried in it, weighted by each asset's own exposure.
 *
 * Returns null when the touched categories hold no inventoried asset at all, which the caller reads
 * as "asset weighting unknown", never as "asset weighting zero".
 */
export const computeAssetRelevance = ({ categoryIds, techniqueCategoryMapping, supportingAssetCounts, exposureWeights }: {
  categoryIds: Array<string>,
  techniqueCategoryMapping: Record<string, Array<string>>,
  supportingAssetCounts: Record<string, ExposureCounts>,
  exposureWeights: ExposureWeights,
}): AssetRelevanceResult | null => {
  if (categoryIds.length === 0) {
    return null;
  }

  const categoryVolumes = buildCategoryWeightedVolumes(categoryIds, supportingAssetCounts, exposureWeights);
  const total = Array.from(categoryVolumes.values()).reduce((acc, volume) => acc + volume, 0);
  if (total === 0) {
    return null;
  }

  return {
    total: toPertRange(total),
    perTechnique: buildPerTechniqueRanges(techniqueCategoryMapping, categoryVolumes),
    perCategory: Object.fromEntries(categoryVolumes),
  };
};

/**
 * The share of the estate a technique reaches, as a point estimate.
 */
export const resolveAssetRelevanceWeight = (
  assetRelevance: AssetRelevanceResult | null,
  mitreTechniqueId: string,
  touchedCategoryCount: number,
): number => {
  if (assetRelevance === null) {
    return resolveUnknownEstateWeight(touchedCategoryCount);
  }
  const perTechnique = assetRelevance.perTechnique[mitreTechniqueId];
  if (!perTechnique || assetRelevance.total.likely <= 0) {
    return 0;
  }
  return Math.min(perTechnique.likely / assetRelevance.total.likely, 1);
};
