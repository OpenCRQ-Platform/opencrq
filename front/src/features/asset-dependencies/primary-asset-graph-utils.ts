import type { PrimaryToPrimaryLinkStrength, SecurityNeedCriterion, SecurityNeedLevel } from '@app/module/client';
import { PRIMARY_TO_PRIMARY_LINK_STRENGTHS } from '@app/module/client';
import type { ResourceTypedLink } from './primary-to-primary-links-utils';
import { overallSecurityNeed } from '../primary-assets/primary-asset-fields-utils';
import { layoutColumns } from './dependency-graph-utils';
import { filterLinksByResourceType } from './primary-to-primary-links-utils';

export type PrimaryGraphAsset = Record<SecurityNeedCriterion, SecurityNeedLevel | null> & {
  id: string,
  name: string,
  businessFunction: string | null,
};

export interface PrimaryGraphLink extends ResourceTypedLink {
  id: string,
  dependentAssetId: string,
  providerAssetId: string,
  strength: PrimaryToPrimaryLinkStrength,
}

export interface PrimaryGraphNode {
  id: string,
  /** The column, dependents on the left of what they depend on. */
  level: number,
  asset: PrimaryGraphAsset,
  overallLevel: SecurityNeedLevel | null,
  /** Drawn only as the direct neighbour of an asset the filters keep. */
  outsideFilters: boolean,
}

/**
 * One drawn line: a link, or the two opposite links of a mutual dependency, which `edgeCurve` would
 * draw on top of each other. `source` is the dependent, where the head points.
 */
export interface PrimaryGraphEdge {
  /** The smaller of its links' ids, so a refetch returning them in another order keeps a selection. */
  id: string,
  source: string,
  target: string,
  /** The one running from `source` to `target` first. */
  links: Array<PrimaryGraphLink>,
}

export interface PrimaryGraphModel {
  nodes: Array<PrimaryGraphNode>,
  edges: Array<PrimaryGraphEdge>,
  /** The kept assets with no link at all to another primary asset, which are never drawn. */
  unlinkedCount: number,
}

export interface PrimaryGraphFilters {
  /** The assets the list's own filters keep. */
  keptIds: ReadonlySet<string>,
  hiddenStrengths: ReadonlySet<PrimaryToPrimaryLinkStrength>,
  resourceType: string,
}

export const linksOfKeptAssets = <Link extends PrimaryGraphLink>(links: ReadonlyArray<Link>, keptIds: ReadonlySet<string>): Array<Link> =>
  links.filter((link) => keptIds.has(link.dependentAssetId) || keptIds.has(link.providerAssetId));

/** Taken before the strength filter, so a chip that hides its links still says how many it hides. */
export const strengthCounts = (links: ReadonlyArray<PrimaryGraphLink>): Record<PrimaryToPrimaryLinkStrength, number> => {
  const counts: Record<PrimaryToPrimaryLinkStrength, number> = { critical: 0, important: 0, minor: 0, unknown: 0 };
  for (const link of links) {
    counts[link.strength] += 1;
  }
  return counts;
};

/** The strongest of a mutual dependency's two strengths, `unknown` only when both are. */
export const edgeStrength = (edge: PrimaryGraphEdge): PrimaryToPrimaryLinkStrength =>
  PRIMARY_TO_PRIMARY_LINK_STRENGTHS.find((strength) => edge.links.some((link) => link.strength === strength)) ?? 'unknown';

const mergeMutualLinks = (links: ReadonlyArray<PrimaryGraphLink>): Array<PrimaryGraphEdge> => {
  const byEnds = new Map(links.map((link) => [`${link.dependentAssetId}\u0000${link.providerAssetId}`, link]));
  const merged = new Set<string>();
  const edges: Array<PrimaryGraphEdge> = [];
  for (const link of links) {
    if (merged.has(link.id)) {
      continue;
    }
    const reverse = byEnds.get(`${link.providerAssetId}\u0000${link.dependentAssetId}`);
    const [first, second] = reverse !== undefined && reverse.id < link.id ? [reverse, link] : [link, reverse];
    if (second !== undefined) {
      merged.add(first.id);
      merged.add(second.id);
    }
    edges.push({
      id: first.id,
      source: first.dependentAssetId,
      target: first.providerAssetId,
      links: second === undefined ? [first] : [first, second],
    });
  }
  return edges;
};

/**
 * Every link touching a kept asset and passing the strength and resource type filters, and both of
 * its ends: an end the list's filters leave out is drawn as context, one step away and no further.
 */
export const buildPrimaryAssetGraph = (
  assets: ReadonlyArray<PrimaryGraphAsset>,
  links: ReadonlyArray<PrimaryGraphLink>,
  filters: PrimaryGraphFilters,
): PrimaryGraphModel => {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const linkedIds = new Set(links.flatMap((link) => [link.dependentAssetId, link.providerAssetId]));
  const unlinkedCount = assets.filter((asset) => filters.keptIds.has(asset.id) && !linkedIds.has(asset.id)).length;

  // The two lists come from two queries, which a refresh can briefly leave out of step.
  const drawn = filterLinksByResourceType(linksOfKeptAssets(links, filters.keptIds), filters.resourceType)
    .filter((link) => !filters.hiddenStrengths.has(link.strength)
      && assetIds.has(link.dependentAssetId) && assetIds.has(link.providerAssetId));

  const drawnIds = new Set(drawn.flatMap((link) => [link.dependentAssetId, link.providerAssetId]));
  const drawnAssets = assets.filter((asset) => drawnIds.has(asset.id));
  const providerIds = new Set(drawn.map((link) => link.providerAssetId));
  const columns = layoutColumns(
    drawnAssets.filter((asset) => !providerIds.has(asset.id)).map((asset) => asset.id),
    drawnAssets.map((asset) => asset.id),
    drawn.map((link) => ({ source: link.dependentAssetId, target: link.providerAssetId })),
  );

  return {
    nodes: drawnAssets.map((asset) => ({
      id: asset.id,
      level: columns.get(asset.id) ?? 0,
      asset,
      overallLevel: overallSecurityNeed(asset),
      outsideFilters: !filters.keptIds.has(asset.id),
    })),
    edges: mergeMutualLinks(drawn),
    unlinkedCount,
  };
};
