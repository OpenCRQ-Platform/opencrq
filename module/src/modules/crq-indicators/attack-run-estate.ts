import { compareCodePoints } from '@app/utils';
import type { AssetCategory, AssetCriticality } from '../supporting-assets/constants';
import type { AttackRunCveFloor, AttackRunGroup } from './engine/attack-run-law';
import type { SupportingAssetExposure } from '../supporting-assets/schema';

/**
 * The estate collapse: a million assets into a few hundred groups, keyed by the tuple the maths
 * actually reads and by nothing else.
 *
 * The CVE component is a **derived mask over the actor's repertoire**, one bit per technique saying
 * whether the asset carries an actor-exploited CVE that floors that route, and never the raw set of
 * open CVEs. Keying on the CVE set fragments the estate back into individual assets, because real
 * patch states differ almost everywhere, and the collapse the whole design rests on disappears
 * without anything failing. The mask being bounded by the repertoire is what keeps the group count
 * bounded by the scenario rather than by the vulnerability population.
 *
 * The mask is per attacker, so the collapse is too. An attacker standing for several actors carries,
 * per technique, the share of the technique's holders that exploit a CVE the asset carries: a bit set
 * for one actor's known-exploited CVE would otherwise floor the route for every actor of the class.
 *
 * The what-if of a CVE whose floor some asset loses gets groups of its own: the estate as the CVE's
 * dismissal leaves it, each asset regrouped by the mask it keeps, which is the partition a rerun
 * after the dismissal builds. They are built per CVE and never merged into the reference groups.
 */

export interface EstateCountRow {
  readonly categoryId: AssetCategory,
  readonly exposure: SupportingAssetExposure,
  readonly criticality: AssetCriticality,
  readonly count: number,
  /** The declared kind whose virtual assets these are, when each world draws their count again. */
  readonly declaredKind?: string,
}

export interface EstateRouteRow {
  readonly supportingAssetId: string,
  readonly categoryId: AssetCategory,
  readonly exposure: SupportingAssetExposure,
  readonly criticality: AssetCriticality,
  readonly matchedByScenarioGroup: boolean,
  readonly cveExternalId: string,
  /** The id of the `cve` row, the key of the draw and of the what-if. */
  readonly cveRowId: string,
  readonly techniqueExternalId: string,
}

export interface EstateCollapseInput {
  /** Every asset of the scenario's touched categories, at the group grain. */
  readonly counts: ReadonlyArray<EstateCountRow>,
  /** The same grain, restricted to the assets the scenario's primary resources depend on. */
  readonly scenarioGroupCounts: ReadonlyArray<EstateCountRow>,
  readonly routes: ReadonlyArray<EstateRouteRow>,
  /** The actors the attacker stands for. A CVE no member exploits contributes nothing. */
  readonly members: ReadonlyArray<EstateCollapseMember>,
}

export interface EstateCollapseMember {
  readonly share: number,
  readonly cveExternalIds: ReadonlySet<string>,
  /** The member's repertoire, which bounds the mask. */
  readonly techniqueExternalIds: ReadonlySet<string>,
}

interface EstateKey {
  readonly categoryId: AssetCategory,
  readonly exposure: SupportingAssetExposure,
  readonly criticality: AssetCriticality,
}

const keyOf = (row: EstateKey): string => `${row.categoryId}|${row.exposure}|${row.criticality}`;

const maskIdOf = (mask: ReadonlyArray<AttackRunCveFloor>): string =>
  mask.map((floor) => `${floor.techniqueExternalId}=${floor.share}`).join(',');

const groupIdOf = (key: string, matched: boolean, mask: ReadonlyArray<AttackRunCveFloor>): string =>
  `${key}|${matched ? 'scenario' : 'estate'}|${maskIdOf(mask)}`;

const groupOf = (
  id: string,
  key: EstateKey,
  matched: boolean,
  mask: ReadonlyArray<AttackRunCveFloor>,
  assets: number,
  declaredKinds: ReadonlyArray<string> = [],
): AttackRunGroup => ({
  id,
  family: key.categoryId,
  assets,
  exposure: key.exposure,
  criticality: key.criticality,
  matchedByScenarioGroup: matched,
  cveFloors: mask,
  ...(declaredKinds.length === 0 ? {} : { declaredKinds }),
});

/** The reference groups of an attacker's estate, and the groups the what-if of one CVE reads. */
export interface EstateCollapse {
  readonly groups: Array<AttackRunGroup>,
  /** The groups of the estate once the CVE (a `cve` row id) is dismissed; null when no asset's mask changes. */
  readonly without: (cveRowId: string) => Array<AttackRunGroup> | null,
}

interface FlooredGroup {
  readonly key: EstateKey,
  readonly matched: boolean,
  readonly mask: ReadonlyArray<AttackRunCveFloor>,
  assets: number,
}

/**
 * Reads the routes once for the reference groups and for the regrouped estate of every CVE.
 *
 * `groups` holds every asset of an attacker's estate as the groups the law reads: assets carrying
 * no floored route land in the two mask-free groups of their tuple, one inside the scenario's
 * resources and one outside; the rest split by the mask they carry.
 */
export const prepareCollapse = (input: EstateCollapseInput): EstateCollapse => {
  const membersByCve = new Map<string, Array<number>>();
  const holderShare = new Map<string, number>();
  input.members.forEach((member, index) => {
    for (const cveExternalId of member.cveExternalIds) {
      membersByCve.set(cveExternalId, [...(membersByCve.get(cveExternalId) ?? []), index]);
    }
    for (const techniqueExternalId of member.techniqueExternalIds) {
      holderShare.set(techniqueExternalId, (holderShare.get(techniqueExternalId) ?? 0) + member.share);
    }
  });

  /* Per technique, the members flooring it and, for each, the CVEs that give it the floor. */
  type Flooring = Map<string, Map<number, Set<string>>>;
  const masksByAsset = new Map<string, { key: EstateKey, matched: boolean, flooring: Flooring }>();
  const assetsByCve = new Map<string, Set<string>>();
  for (const route of input.routes) {
    const flooring = (membersByCve.get(route.cveExternalId) ?? [])
      .filter((index) => input.members[index].techniqueExternalIds.has(route.techniqueExternalId));
    if (flooring.length === 0) {
      continue;
    }
    const held = masksByAsset.get(route.supportingAssetId)
      ?? { key: route, matched: route.matchedByScenarioGroup, flooring: new Map() as Flooring };
    const members = held.flooring.get(route.techniqueExternalId) ?? new Map<number, Set<string>>();
    for (const index of flooring) {
      const cves = members.get(index) ?? new Set<string>();
      cves.add(route.cveRowId);
      members.set(index, cves);
    }
    held.flooring.set(route.techniqueExternalId, members);
    // An asset linked to any of the scenario's resources is matched, whichever route row says so.
    held.matched = held.matched || route.matchedByScenarioGroup;
    masksByAsset.set(route.supportingAssetId, held);
    const carriers = assetsByCve.get(route.cveRowId) ?? new Set<string>();
    carriers.add(route.supportingAssetId);
    assetsByCve.set(route.cveRowId, carriers);
  }

  /* The share of a technique's holders flooring it through these members, summed in member order. */
  const maskOf = (flooring: Flooring, without: string | null): Array<AttackRunCveFloor> => {
    const mask: Array<AttackRunCveFloor> = [];
    for (const [techniqueExternalId, members] of [...flooring].sort(([first], [second]) => compareCodePoints(first, second))) {
      let floored = 0;
      let kept = 0;
      for (const index of [...members.keys()].sort((first, second) => first - second)) {
        const cves = members.get(index)!;
        if (without !== null && cves.size === 1 && cves.has(without)) {
          continue;
        }
        kept += 1;
        floored += input.members[index].share;
      }
      if (kept > 0) {
        const holders = holderShare.get(techniqueExternalId) ?? 0;
        mask.push({ techniqueExternalId, share: holders > 0 ? Math.min(1, floored / holders) : 1 });
      }
    }
    return mask;
  };

  const flooredOf = new Map<string, { id: string, mask: Array<AttackRunCveFloor> }>();
  const flooredCounts = new Map<string, FlooredGroup>();
  for (const [assetId, held] of masksByAsset) {
    const mask = maskOf(held.flooring, null);
    const id = groupIdOf(keyOf(held.key), held.matched, mask);
    flooredOf.set(assetId, { id, mask });
    const entry = flooredCounts.get(id) ?? { key: held.key, matched: held.matched, mask, assets: 0 };
    entry.assets += 1;
    flooredCounts.set(id, entry);
  }

  const totals = new Map<string, { key: EstateKey, assets: number, declaredKinds: Set<string> }>();
  for (const row of input.counts) {
    const held = totals.get(keyOf(row)) ?? { key: row, assets: 0, declaredKinds: new Set<string>() };
    held.assets += row.count;
    if (row.declaredKind !== undefined) {
      held.declaredKinds.add(row.declaredKind);
    }
    totals.set(keyOf(row), held);
  }
  const matchedTotals = new Map<string, number>();
  for (const row of input.scenarioGroupCounts) {
    matchedTotals.set(keyOf(row), (matchedTotals.get(keyOf(row)) ?? 0) + row.count);
  }

  /* The law reduces over the groups in array order, so their order is part of the run's output down
   * to the last ulp. Built here from map iteration, it would otherwise follow the order the rows
   * came back from Postgres, which no query fixes. */
  const assemble = (floored: ReadonlyMap<string, FlooredGroup>): Array<AttackRunGroup> => {
    const flooredByKey = new Map<string, { matched: number, unmatched: number }>();
    for (const entry of floored.values()) {
      const held = flooredByKey.get(keyOf(entry.key)) ?? { matched: 0, unmatched: 0 };
      if (entry.matched) {
        held.matched += entry.assets;
      } else {
        held.unmatched += entry.assets;
      }
      flooredByKey.set(keyOf(entry.key), held);
    }
    const groups: Array<AttackRunGroup> = [];
    for (const [id, total] of totals) {
      const matched = matchedTotals.get(id) ?? 0;
      const held = flooredByKey.get(id) ?? { matched: 0, unmatched: 0 };
      const plain: Array<[boolean, number]> = [
        [true, matched - held.matched],
        [false, total.assets - matched - held.unmatched],
      ];
      // Virtual assets carry no route and serve no scenario resource, so a drawn kind only ever lands
      // in the unmatched plain group, kept at no asset for the worlds that draw some.
      for (const [isMatched, assets] of plain) {
        const declaredKinds = isMatched ? [] : [...total.declaredKinds].sort(compareCodePoints);
        if (assets > 0 || declaredKinds.length > 0) {
          groups.push(groupOf(groupIdOf(id, isMatched, []), total.key, isMatched, [], assets, declaredKinds));
        }
      }
    }
    for (const [id, entry] of floored) {
      groups.push(groupOf(id, entry.key, entry.matched, entry.mask, entry.assets));
    }
    return groups.sort((first, second) => compareCodePoints(first.id, second.id));
  };

  return {
    groups: assemble(flooredCounts),
    without: (cveRowId) => {
      const regrouped = new Map<string, FlooredGroup>(
        [...flooredCounts].map(([id, entry]) => [id, { ...entry }]),
      );
      let changed = false;
      for (const assetId of assetsByCve.get(cveRowId) ?? []) {
        const held = masksByAsset.get(assetId)!;
        const reference = flooredOf.get(assetId)!;
        const mask = maskOf(held.flooring, cveRowId);
        if (maskIdOf(mask) === maskIdOf(reference.mask)) {
          continue;
        }
        changed = true;
        regrouped.get(reference.id)!.assets -= 1;
        if (mask.length === 0) {
          continue;
        }
        const id = groupIdOf(keyOf(held.key), held.matched, mask);
        const entry = regrouped.get(id) ?? { key: held.key, matched: held.matched, mask, assets: 0 };
        entry.assets += 1;
        regrouped.set(id, entry);
      }
      if (!changed) {
        return null;
      }
      return assemble(new Map([...regrouped].filter(([, entry]) => entry.assets > 0)));
    },
  };
};
