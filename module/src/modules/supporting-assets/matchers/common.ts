import type { AssetObservation } from '../types';

export interface CommonIdentityIndex {
  resolve: (observation: AssetObservation) => string | undefined,
  register: (assetId: string, observation: AssetObservation) => void,
}

/**
 * The tiers every family shares, run inside a family's own index rather than across families:
 * a shared common-tier value between a host and an AI target is a coincidence, not an identity.
 *
 * Today: `externalReference` equality alone — the only cross-family identifier OpenAEV actually
 * serves (`asset_external_reference`, the id the customer's own system gave the asset). It is the
 * *last* tier consulted and it carries the family's own veto (see `buildAssetIdentityIndex`):
 * OpenAEV's uniqueness on that column is per OpenAEV tenant, while one connector here spans every
 * tenant of an instance, so two assets can legitimately arrive sharing one reference.
 */
export const buildCommonIdentityIndex = (): CommonIdentityIndex => {
  const assetIdByExternalReference = new Map<string, string>();

  // Falsy, not `!== null`: a source serializing an absent reference as `""` would otherwise have
  // every asset sharing that absence collide on it, and this tier joins on equality alone.
  const externalReferenceOf = (observation: AssetObservation): string | null =>
    (observation.externalReference ? observation.externalReference : null);

  const register: CommonIdentityIndex['register'] = (assetId, observation) => {
    const reference = externalReferenceOf(observation);
    if (reference !== null && !assetIdByExternalReference.has(reference)) {
      assetIdByExternalReference.set(reference, assetId);
    }
  };

  const resolve: CommonIdentityIndex['resolve'] = (observation) => {
    const reference = externalReferenceOf(observation);
    return reference === null ? undefined : assetIdByExternalReference.get(reference);
  };

  return { resolve, register };
};
