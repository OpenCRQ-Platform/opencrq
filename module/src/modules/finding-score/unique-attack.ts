import type { AssetCategory } from '../supporting-assets/constants';
import type { SupportingAssetExposure } from '../supporting-assets/schema';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { AttackClaim, ClaimJustification } from '../technique-mapping/attack-claims';
import type { AttackGroup, TechniqueClaimLane, TechniqueGrain } from '../technique-mapping/constants';
import type { MappingRole } from '../technique-mapping/data/curated-technique-mappings';
import { countedExposure } from '../attack-surfaces/entry-applicability';
import { ASSET_CATEGORY_VALUES, isLossBearingAssetCategory } from '../supporting-assets/constants';
import { ATTACK_GROUP_VALUES } from '../technique-mapping/constants';

/** In the order a topology row names them. */
export const ASSET_EXPOSURE_VALUES: ReadonlyArray<SupportingAssetExposure> = ['internet_facing', 'internal', 'unknown'];

/** The applicable members of a unique finding that share one exposure and one family. */
export interface UniqueAttackMemberKind {
  exposure: SupportingAssetExposure,
  categoryId: AssetCategory,
  assetCount: number,
}

export interface UniqueAttackRow {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  role: MappingRole,
  lane: TechniqueClaimLane,
  group: AttackGroup,
  justification: ClaimJustification,
  grain: TechniqueGrain,
  /** The members' exposures the claim reads on, which only a topology row narrows. */
  exposures: Array<SupportingAssetExposure>,
  /** Distinct assets the technique holds on. Zero on a way in every member's family sets aside. */
  assetCount: number,
  /** Only a way in is set aside, by the family of the asset it would run on. */
  setAside: Array<{ categoryId: AssetCategory, assetCount: number }>,
}

/** A way in of the CVE, on whichever asset carries it: what the technique filter and a finding's row read. */
export interface UniqueAttackWayIn {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  exposures: Array<SupportingAssetExposure>,
  setAsideOn: Array<AssetCategory>,
}

export interface UniqueAttack {
  /** The group's size: a technique counts every asset it holds on, so row counts may sum above it. */
  assetCount: number,
  rows: Array<UniqueAttackRow>,
  waysIn: Array<UniqueAttackWayIn>,
}

export interface UniqueAttackInput {
  /** The CVE's resolution on an asset of that exposure; the unknown reading only orders the union. */
  claimsFor: (exposure: SupportingAssetExposure) => ReadonlyArray<AttackClaim>,
  /** A member of unknown exposure holds the claims of this exposure, as its finding's own page reads them. */
  unknownExposureCountsAs: UnknownExposureCountsAs,
  /** The techniques a family carries, null for a family carrying every technique. */
  carriedFor: (categoryId: AssetCategory) => ReadonlySet<string> | null,
  members: ReadonlyArray<UniqueAttackMemberKind>,
}

interface ClaimUnion {
  claim: AttackClaim,
  exposures: Array<SupportingAssetExposure>,
}

/** The unknown reading names every alternative in the order the attack runs them, so it orders the union. */
const UNION_ORDER: ReadonlyArray<SupportingAssetExposure> = ['unknown', 'internet_facing', 'internal'];

const isWayIn = (group: AttackGroup): boolean => group === 'exploitation';

/**
 * The union of the techniques a CVE's findings resolve to, each counted on the assets it holds on.
 *
 * The resolution depends on the asset only through its exposure and its family, so it runs once per
 * exposure and the members arrive grouped by both, never one finding at a time.
 */
export const aggregateUniqueAttack = ({ claimsFor, unknownExposureCountsAs, carriedFor, members }: UniqueAttackInput): UniqueAttack => {
  const keyOf = (claim: AttackClaim): string => `${claim.mitreTechniqueId}|${claim.group}`;
  const unions = new Map<string, ClaimUnion>();
  for (const exposure of UNION_ORDER) {
    for (const claim of claimsFor(exposure)) {
      if (!unions.has(keyOf(claim))) {
        unions.set(keyOf(claim), { claim, exposures: [] });
      }
    }
  }
  for (const exposure of ASSET_EXPOSURE_VALUES) {
    for (const claim of claimsFor(countedExposure(exposure, unknownExposureCountsAs))) {
      unions.get(keyOf(claim))?.exposures.push(exposure);
    }
  }

  const carries = (categoryId: AssetCategory, techniqueId: string): boolean => {
    const carried = carriedFor(categoryId);
    return carried === null || carried.has(techniqueId);
  };

  const rows = [...unions.values()].flatMap(({ claim, exposures }): Array<UniqueAttackRow> => {
    const reached = members.filter((member) => exposures.includes(member.exposure));
    if (reached.length === 0) {
      return [];
    }
    const setAsideByCategory = new Map<AssetCategory, number>();
    let assetCount = 0;
    for (const member of reached) {
      if (!isWayIn(claim.group) || carries(member.categoryId, claim.mitreTechniqueId)) {
        assetCount += member.assetCount;
      } else {
        setAsideByCategory.set(member.categoryId, (setAsideByCategory.get(member.categoryId) ?? 0) + member.assetCount);
      }
    }
    return [{
      mitreTechniqueId: claim.mitreTechniqueId,
      externalId: claim.techniqueExternalId,
      name: claim.techniqueName,
      role: claim.role,
      lane: claim.lane,
      group: claim.group,
      justification: claim.justification,
      grain: claim.grain,
      exposures: ASSET_EXPOSURE_VALUES.filter((exposure) => reached.some((member) => member.exposure === exposure)),
      assetCount,
      setAside: [...setAsideByCategory]
        .map(([categoryId, count]) => ({ categoryId, assetCount: count }))
        .sort((left, right) => right.assetCount - left.assetCount || left.categoryId.localeCompare(right.categoryId)),
    }];
  });

  const waysIn = [...unions.values()]
    .filter(({ claim }) => isWayIn(claim.group))
    .map(({ claim, exposures }) => ({
      mitreTechniqueId: claim.mitreTechniqueId,
      externalId: claim.techniqueExternalId,
      name: claim.techniqueName,
      exposures: ASSET_EXPOSURE_VALUES.filter((exposure) => exposures.includes(exposure)),
      setAsideOn: ASSET_CATEGORY_VALUES.filter((categoryId) => isLossBearingAssetCategory(categoryId) && !carries(categoryId, claim.mitreTechniqueId)),
    }));

  return {
    assetCount: members.reduce((total, member) => total + member.assetCount, 0),
    rows: rows.sort((left, right) => ATTACK_GROUP_VALUES.indexOf(left.group) - ATTACK_GROUP_VALUES.indexOf(right.group)),
    waysIn,
  };
};
