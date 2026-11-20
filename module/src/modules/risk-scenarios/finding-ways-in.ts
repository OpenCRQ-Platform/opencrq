export interface FindingPath {
  viaAssetId: string,
  viaAssetName: string | null,
  /** `null` when the way in is a primary asset, which always carries a name. */
  viaAssetDerivedName: string | null,
  depth: number,
}

export type AssetNamesById = ReadonlyMap<string, { name: string | null, derivedName: string | null }>;

/**
 * What the reach holds about the assets a page of findings sits on, over the scenario's primary
 * assets: the asset's shortest depth, its links to those primary assets and, for a provider, how
 * many of its dependents are first reached one level above it and the smallest of them.
 */
export interface ReachWaysIn {
  depths: ReadonlyArray<{ supportingAssetId: string, depth: number }>,
  directLinks: ReadonlyArray<{ supportingAssetId: string, primaryAssetId: string }>,
  dependentWays: ReadonlyArray<{ providerAssetId: string, count: number, firstDependentAssetId: string }>,
}

interface WayIn {
  firstPath: FindingPath | null,
  pathCount: number,
}

const NO_WAY_IN: WayIn = { firstPath: null, pathCount: 0 };

/**
 * Each row's names and its way in: an asset is reached at its shortest depth, by one way per link
 * to a scenario primary asset at depth 0 and, deeper, one per dependent first reached a level above.
 * A row carries the way of the smallest id and how many there are, not the list: a provider every
 * asset of a level shares has one per dependent, which each of its findings would repeat.
 *
 * An asset the reach does not hold, which a job still to catch up leaves, has no way in.
 */
export const placeFindingRows = <T extends { supportingAssetId: string }>(
  rows: ReadonlyArray<T>,
  waysIn: ReachWaysIn,
  names: AssetNamesById,
  primaryAssetNames: ReadonlyMap<string, string>,
) => {
  const depthById = new Map(waysIn.depths.map((entry) => [entry.supportingAssetId, entry.depth]));
  const directLinksById = Map.groupBy(waysIn.directLinks, (link) => link.supportingAssetId);
  const dependentWaysById = new Map(waysIn.dependentWays.map((ways) => [ways.providerAssetId, ways]));

  const wayInOf = (assetId: string): WayIn => {
    const depth = depthById.get(assetId);
    if (depth === undefined) {
      return NO_WAY_IN;
    }
    if (depth === 0) {
      const [first, ...others] = (directLinksById.get(assetId) ?? []).map((link) => link.primaryAssetId).toSorted();
      return first === undefined ? NO_WAY_IN : {
        firstPath: { viaAssetId: first, viaAssetName: primaryAssetNames.get(first) ?? null, viaAssetDerivedName: null, depth },
        pathCount: others.length + 1,
      };
    }
    const ways = dependentWaysById.get(assetId);
    if (ways === undefined) {
      return NO_WAY_IN;
    }
    const via = names.get(ways.firstDependentAssetId);
    return {
      firstPath: { viaAssetId: ways.firstDependentAssetId, viaAssetName: via?.name ?? null, viaAssetDerivedName: via?.derivedName ?? null, depth },
      pathCount: ways.count,
    };
  };

  return rows.map((row) => ({
    ...row,
    supportingAssetName: names.get(row.supportingAssetId)?.name ?? null,
    supportingAssetDerivedName: names.get(row.supportingAssetId)?.derivedName ?? null,
    ...wayInOf(row.supportingAssetId),
  }));
};
