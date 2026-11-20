import type { AssetObservation } from '../types';
import type { IdentityFamily } from '../identity-families';
import { buildAiTargetIdentityIndex } from './ai-target';
import { buildIdentityIdentityIndex } from './identity';
import { buildMachineIdentityIndex } from './machine';

export interface FamilyIdentityIndex {
  resolve: (observation: AssetObservation) => string | undefined,
  register: (assetId: string, observation: AssetObservation) => void,
  /**
   * True when this asset's registered observations carry a strong identifier the incoming one
   * contradicts. The common tier joins on equality alone, with nothing of its own to corroborate
   * it, so it asks the family whether the match it found is one the family would refuse.
   */
  disagreesWith: (assetId: string, observation: AssetObservation) => boolean,
}

export type FamilyMatcherFactory = () => FamilyIdentityIndex;

/**
 * Which family has a matcher at all. A family absent here (`application`, `unclassified`) never
 * fuses two observations, however much they agree — it is an entry waiting for a connector, not a
 * ladder with zero rungs.
 *
 * `application` is the next one to revisit, once a second connector reports web applications: its
 * natural key is the URL, and a single reporter needs no matcher to find its own rows again. It
 * needs that second reporter for another reason too — OpenAEV serves `asset_url` only on the
 * endpoint branch of its asset mapper, so an application it stores as a generic asset reaches us
 * with no URL to match on.
 */
export const MATCHER_BY_FAMILY: Partial<Record<IdentityFamily, FamilyMatcherFactory>> = {
  machine: buildMachineIdentityIndex,
  ai_target: buildAiTargetIdentityIndex,
  identity: buildIdentityIdentityIndex,
};

export const isFamilyMatchable = (family: IdentityFamily): boolean => MATCHER_BY_FAMILY[family] !== undefined;
