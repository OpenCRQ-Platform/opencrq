import type { IdentityFamily } from './identity-families';
import type { CommonIdentityIndex } from './matchers/common';
import type { FamilyIdentityIndex } from './matchers/registry';
import type { AssetObservation } from './types';
import { identityFamilyOf } from './identity-families';
import { buildCommonIdentityIndex } from './matchers/common';
import { MATCHER_BY_FAMILY } from './matchers/registry';

/**
 * Cross-connector identity for the Machine family, in descending strength, with a veto: a match at
 * a weaker tier is rejected when both sides carry a stronger identifier and those disagree. No
 * confidence score, no threshold, no suggestion queue — what no tier joins stays separate.
 *
 * Registration is additive: `register` folds an observation into the index so later ones in the
 * same ingestion batch resolve against it, and `resolve` never mutates it.
 */
export interface AssetIdentityIndex {
  /** The canonical asset id this observation belongs to, or undefined for a new asset. */
  resolve: (observation: AssetObservation) => string | undefined,
  register: (assetId: string, observation: AssetObservation) => void,
}

interface PerFamilyIndex {
  common: CommonIdentityIndex,
  family: FamilyIdentityIndex,
}

/**
 * One index per family, never one index across families: a shared common-tier value between a
 * host and an AI target is a coincidence, not an identity. A family with no matcher in the
 * registry never gets an index at all, which is what keeps it from ever fusing two observations.
 */
export const buildAssetIdentityIndex = (
  records: Array<{ assetId: string, observation: AssetObservation }>,
): AssetIdentityIndex => {
  const indexes = new Map<IdentityFamily, PerFamilyIndex>();

  const indexFor = (family: IdentityFamily): PerFamilyIndex | undefined => {
    const existing = indexes.get(family);
    if (existing) {
      return existing;
    }
    const factory = MATCHER_BY_FAMILY[family];
    if (!factory) {
      return undefined;
    }
    const built: PerFamilyIndex = { common: buildCommonIdentityIndex(), family: factory() };
    indexes.set(family, built);
    return built;
  };

  const register: AssetIdentityIndex['register'] = (assetId, observation) => {
    const index = indexFor(identityFamilyOf(observation.reportedCategoryId));
    if (!index) {
      return;
    }
    index.common.register(assetId, observation);
    index.family.register(assetId, observation);
  };

  const resolve: AssetIdentityIndex['resolve'] = (observation) => {
    const index = indexFor(identityFamilyOf(observation.reportedCategoryId));
    if (!index) {
      return undefined;
    }
    const byFamily = index.family.resolve(observation);
    if (byFamily !== undefined) {
      return byFamily;
    }
    // Last, and vetoed: the common tier joins on a reported id alone, and OpenAEV's uniqueness on
    // that id holds per OpenAEV tenant while one connector here spans every tenant of an instance.
    // Ahead of the family tiers it would outrank a Defender machine id, which is the one join
    // nothing else can make.
    const byCommon = index.common.resolve(observation);
    if (byCommon === undefined || index.family.disagreesWith(byCommon, observation)) {
      return undefined;
    }
    return byCommon;
  };

  for (const record of records) {
    register(record.assetId, record.observation);
  }
  return { resolve, register };
};
