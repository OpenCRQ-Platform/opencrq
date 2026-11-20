/** One control x asset family pair, whichever of the module's two family relations produced it. */
export interface FamilyPair {
  readonly capabilityId: string,
  readonly categoryId: string,
}

/**
 * The share of the touched estate each control protects, over the pairs the caller feeds in.
 *
 * `categoryWeights` is the weighted volume per touched category the asset-relevance engine already
 * computes, or null when the touched categories hold no inventoried asset at all. In that case the
 * share falls back to the count of touched categories the control protects, which is the same
 * spread the engine applies to an unknown estate everywhere else.
 *
 * A scenario that touches no category carries no scoping information, so every control keeps its
 * full weight rather than losing it to a division by nothing.
 */
export const buildFamilyShares = ({ pairs, touchedCategoryIds, categoryWeights }: {
  pairs: ReadonlyArray<FamilyPair>,
  touchedCategoryIds: ReadonlyArray<string>,
  categoryWeights: Readonly<Record<string, number>> | null,
}): Map<string, number> => {
  const touched = new Set(touchedCategoryIds);
  const weightOf = (categoryId: string): number => (categoryWeights === null ? 1 : categoryWeights[categoryId] ?? 0);
  const totalWeight = touchedCategoryIds.reduce((total, categoryId) => total + weightOf(categoryId), 0);

  const weightByCapability = new Map<string, number>();
  for (const pair of pairs) {
    if (!touched.has(pair.categoryId)) {
      continue;
    }
    weightByCapability.set(
      pair.capabilityId,
      (weightByCapability.get(pair.capabilityId) ?? 0) + weightOf(pair.categoryId),
    );
  }

  const shares = new Map<string, number>();
  for (const capabilityId of new Set(pairs.map((pair) => pair.capabilityId))) {
    const covered = weightByCapability.get(capabilityId) ?? 0;
    shares.set(capabilityId, totalWeight === 0 ? 1 : Math.min(covered / totalWeight, 1));
  }
  return shares;
};
