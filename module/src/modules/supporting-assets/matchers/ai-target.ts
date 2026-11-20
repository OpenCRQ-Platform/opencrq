import type { AiTargetAssetProperties, AssetObservation } from '../types';

export interface AiTargetIdentityIndex {
  resolve: (observation: AssetObservation) => string | undefined,
  register: (assetId: string, observation: AssetObservation) => void,
  /** The family's veto, offered to the common tier — see `FamilyIdentityIndex`. */
  disagreesWith: (assetId: string, observation: AssetObservation) => boolean,
}

const aiTargetProperties = (observation: AssetObservation): AiTargetAssetProperties | null =>
  (observation.properties?.family === 'ai_target' ? observation.properties : null);

/**
 * One tier, exact match only: `normalizedEndpointUrl` and `model` both present and equal. Only
 * one connector reports AI targets today, so this is validated by nothing — a name alone must
 * never fuse two AI targets, and nothing weaker than this pair is added on a hunch.
 */
const identityKey = (props: AiTargetAssetProperties): string | null =>
  (props.normalizedEndpointUrl !== null && props.model !== null ? `${props.normalizedEndpointUrl}::${props.model}` : null);

const observationKey = (observation: AssetObservation): string | null => {
  const props = aiTargetProperties(observation);
  return props === null ? null : identityKey(props);
};

export const buildAiTargetIdentityIndex = (): AiTargetIdentityIndex => {
  const assetIdByKey = new Map<string, string>();
  // What the veto is checked against: an asset's own keys, so a common-tier match onto an AI target
  // that announces a different endpoint-and-model pair is refused.
  const keysByAssetId = new Map<string, Array<string>>();

  const register: AiTargetIdentityIndex['register'] = (assetId, observation) => {
    const key = observationKey(observation);
    if (key === null) {
      return;
    }
    if (!assetIdByKey.has(key)) {
      assetIdByKey.set(key, assetId);
    }
    const keys = keysByAssetId.get(assetId) ?? [];
    if (!keys.includes(key)) {
      keys.push(key);
    }
    keysByAssetId.set(assetId, keys);
  };

  const resolve: AiTargetIdentityIndex['resolve'] = (observation) => {
    const key = observationKey(observation);
    return key === null ? undefined : assetIdByKey.get(key);
  };

  const disagreesWith: AiTargetIdentityIndex['disagreesWith'] = (assetId, observation) => {
    const key = observationKey(observation);
    if (key === null) {
      return false;
    }
    const keys = keysByAssetId.get(assetId) ?? [];
    return keys.length > 0 && !keys.includes(key);
  };

  return { resolve, register, disagreesWith };
};
