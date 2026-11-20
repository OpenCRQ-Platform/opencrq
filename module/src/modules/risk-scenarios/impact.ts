import type { CriteriaReached } from '../attack-outcomes/data/attack-outcomes-data';
import type { CriterionInheritance, InheritedCriteria, SupportToPrimaryLinkRole } from '../asset-dependencies/link-roles';
import { inheritedCriteriaOfRoles, SECURITY_CRITERIA } from '../asset-dependencies/link-roles';

export const CRITERION_GRADE_VALUES: Record<CriterionInheritance, number> = { none: 0, lower: 0.5, full: 1 };

/** A support-to-support link carries no role, so it passes on everything its dependent inherits, halved. */
export const IMPACT_HOP_FACTOR = 0.5;

export interface AttackShare {
  /** `Σ outcome(c)`, the most a link can transmit. */
  outcomeTotal: number,
  /** `Σ outcome(c) x link(c)`. */
  transmittedTotal: number,
  /** Their ratio, 0 for an outcome that reaches no criterion. */
  share: number,
}

export const shareOfAttackTransmitted = (criteriaReached: CriteriaReached, inherited: InheritedCriteria): AttackShare => {
  let outcomeTotal = 0;
  let transmittedTotal = 0;
  for (const criterion of SECURITY_CRITERIA) {
    const reached = CRITERION_GRADE_VALUES[criteriaReached[criterion]];
    outcomeTotal += reached;
    transmittedTotal += reached * CRITERION_GRADE_VALUES[inherited[criterion]];
  }
  return { outcomeTotal, transmittedTotal, share: outcomeTotal === 0 ? 0 : transmittedTotal / outcomeTotal };
};

/** Truncated as the finding score is, after a rounding: a product of halves lands a hair under an integer (0.7 x 50 is 34.99...). */
export const wholePercent = (fraction: number): number => Math.trunc(Math.round(fraction * 1e8) / 1e6);

export interface ImpactContribution {
  primaryAssetId: string,
  /** Support-to-support hops of the best path, 0 when the asset links to the primary asset itself. */
  hops: number,
  /** The assets the best path runs through, from the one this asset supports down to the one linked to the primary asset. */
  chain: Array<string>,
  /** Of the support-to-primary link that ends the best path, as are the four fields below. */
  roles: Array<SupportToPrimaryLinkRole>,
  criteria: InheritedCriteria,
  outcomeTotal: number,
  transmittedTotal: number,
  share: number,
  /** `share x 0.5^hops / n`, this primary asset's part of the asset's impact. */
  contribution: number,
}

export interface AssetImpact {
  /** A share of the scenario's loss, between 0 and 1. */
  impact: number,
  contributions: Array<ImpactContribution>,
}

interface PathEntry {
  value: number,
  hops: number,
  chain: Array<string>,
  terminal: { roles: Array<SupportToPrimaryLinkRole>, criteria: InheritedCriteria } & AttackShare,
}

const isBetter = (candidate: PathEntry, kept: PathEntry | undefined): boolean =>
  kept === undefined
  || candidate.value > kept.value
  || (candidate.value === kept.value && candidate.hops === kept.hops && candidate.chain.join() < kept.chain.join());

/**
 * The walk follows every path up to `maxHops`, not the first level that reaches an asset, since a
 * longer path can transmit more than a shorter one. Keeping the best path per primary asset rather
 * than summing paths is what bounds the impact to 1. Ties keep the shorter path.
 */
export const computeAssetImpacts = ({
  primaryAssetIds,
  supportToPrimaryLinks,
  supportToSupportLinks,
  criteriaReached,
  maxHops,
}: {
  primaryAssetIds: ReadonlyArray<string>,
  supportToPrimaryLinks: ReadonlyArray<{ supportingAssetId: string, primaryAssetId: string, roles: Array<SupportToPrimaryLinkRole> }>,
  supportToSupportLinks: ReadonlyArray<{ providerAssetId: string, dependentAssetId: string }>,
  criteriaReached: CriteriaReached,
  maxHops: number,
}): Map<string, AssetImpact> => {
  const impacts = new Map<string, AssetImpact>();
  const primaryShare = primaryAssetIds.length === 0 ? 0 : 1 / primaryAssetIds.length;

  for (const primaryAssetId of primaryAssetIds) {
    let layer = new Map<string, PathEntry>();
    for (const link of supportToPrimaryLinks) {
      if (link.primaryAssetId !== primaryAssetId) {
        continue;
      }
      const criteria = inheritedCriteriaOfRoles(link.roles);
      const attackShare = shareOfAttackTransmitted(criteriaReached, criteria);
      const entry: PathEntry = {
        value: attackShare.share,
        hops: 0,
        chain: [],
        terminal: { roles: link.roles, criteria, ...attackShare },
      };
      if (isBetter(entry, layer.get(link.supportingAssetId))) {
        layer.set(link.supportingAssetId, entry);
      }
    }

    const best = new Map(layer);
    for (let hops = 1; hops <= maxHops && layer.size > 0; hops++) {
      const next = new Map<string, PathEntry>();
      for (const link of supportToSupportLinks) {
        const reached = layer.get(link.dependentAssetId);
        if (!reached) {
          continue;
        }
        const entry: PathEntry = {
          value: reached.value * IMPACT_HOP_FACTOR,
          hops,
          chain: [link.dependentAssetId, ...reached.chain],
          terminal: reached.terminal,
        };
        if (isBetter(entry, next.get(link.providerAssetId))) {
          next.set(link.providerAssetId, entry);
        }
      }
      for (const [assetId, entry] of next) {
        const kept = best.get(assetId);
        if (kept === undefined || entry.value > kept.value) {
          best.set(assetId, entry);
        }
      }
      layer = next;
    }

    for (const [assetId, entry] of best) {
      const contribution = entry.value * primaryShare;
      const assetImpact = impacts.get(assetId) ?? { impact: 0, contributions: [] };
      assetImpact.impact += contribution;
      assetImpact.contributions.push({
        primaryAssetId,
        hops: entry.hops,
        chain: entry.chain,
        roles: entry.terminal.roles,
        criteria: entry.terminal.criteria,
        outcomeTotal: entry.terminal.outcomeTotal,
        transmittedTotal: entry.terminal.transmittedTotal,
        share: entry.terminal.share,
        contribution,
      });
      impacts.set(assetId, assetImpact);
    }
  }

  // n shares of 1/n add up a hair above 1 in floating point (nine ninths read 1.0000000000000002).
  for (const assetImpact of impacts.values()) {
    assetImpact.impact = Math.min(1, assetImpact.impact);
  }
  return impacts;
};
