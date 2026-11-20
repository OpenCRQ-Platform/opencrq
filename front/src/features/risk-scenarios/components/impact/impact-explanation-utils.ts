import type { InheritedCriteria, SupportToPrimaryLinkRole } from '@app/module/client';
import { IMPACT_HOP_FACTOR } from '@app/module/client';
import type { AssetNameParts } from '../../../../utils/asset-name-utils';

export type ChainAsset = AssetNameParts & { id: string };

export interface ImpactContributionView {
  primaryAssetId: string,
  primaryAssetName: string,
  hops: number,
  chain: Array<ChainAsset>,
  roles: Array<SupportToPrimaryLinkRole>,
  criteria: InheritedCriteria,
  outcomeTotal: number,
  transmittedTotal: number,
  share: number,
  contribution: number,
}

/** `transitive` needs every best path to run through the same chain, anything else not `direct` is `mixed`. */
export type ImpactExplanationShape =
  | { kind: 'direct', contribution: ImpactContributionView }
  | { kind: 'transitive', chain: Array<ChainAsset>, hops: number, contributions: Array<ImpactContributionView> }
  | { kind: 'mixed', contributions: Array<ImpactContributionView> };

const chainKey = (contribution: ImpactContributionView): string => contribution.chain.map((asset) => asset.id).join('>');

export const impactExplanationShape = (contributions: Array<ImpactContributionView>): ImpactExplanationShape => {
  const [first] = contributions;
  if (first === undefined) {
    return { kind: 'mixed', contributions };
  }
  if (contributions.length === 1 && first.hops === 0) {
    return { kind: 'direct', contribution: first };
  }
  if (first.hops > 0 && contributions.every((contribution) => chainKey(contribution) === chainKey(first))) {
    return { kind: 'transitive', chain: first.chain, hops: first.hops, contributions };
  }
  return { kind: 'mixed', contributions };
};

/** Where each hop lands, direct asset side first: `azure` over the chain `[aks, cae]` hops to `aks`, then to `azure`. */
export const hopTargets = <T extends { name: string | null }>(asset: T, chain: Array<T>): Array<T> =>
  [...chain.slice(0, -1).toReversed(), asset];

export const dependentShare = (impact: number): number => impact / IMPACT_HOP_FACTOR;

export const primaryAssetPart = (contribution: ImpactContributionView, primaryAssetCount: number): number =>
  (primaryAssetCount === 0 ? 0 : contribution.share / primaryAssetCount);
