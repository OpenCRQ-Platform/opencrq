import type { AssetObservation, IdentityAssetProperties } from '../types';

/**
 * Cross-connector identity for the Identity family. Unlike the Machine ladder there is no weak
 * tier and no corroboration to weigh: an Entra object id and a Windows SID each name exactly one
 * security principal, so a match is either exact or absent.
 *
 * The **UPN is deliberately not a tier.** It is unique at a point in time and nothing more: a
 * mailbox handed to a joiner after a leaver left carries the same one, and a rename moves it to
 * another account entirely. It is stored and shown, never joined on.
 */
export interface IdentityIdentityIndex {
  resolve: (observation: AssetObservation) => string | undefined,
  register: (assetId: string, observation: AssetObservation) => void,
  /** The family's veto, offered to the common tier — see `FamilyIdentityIndex`. */
  disagreesWith: (assetId: string, observation: AssetObservation) => boolean,
}

const EMPTY_IDENTITY_PROPERTIES: IdentityAssetProperties = {
  family: 'identity',
  directoryObjectId: null,
  cloudSid: null,
  onPremSid: null,
  userPrincipalName: null,
  accountDomain: null,
  accountName: null,
  directoryType: null,
  identityProvider: null,
  department: null,
  jobTitle: null,
  isEnabled: null,
  assignedRoles: [],
  privilegedPimRoles: [],
};

/** An identity-family observation carrying no properties block reads as one with nothing set — never as a match on shared absence. */
const identityProperties = (observation: AssetObservation): IdentityAssetProperties =>
  (observation.properties?.family === 'identity' ? observation.properties : EMPTY_IDENTITY_PROPERTIES);

/**
 * The object id is its own key space; the two SIDs share one. An account reaches us under
 * whichever SID the source knew — a directory record carries both, a logon event only the one the
 * token presented — and they never collide, since a SID names one principal whatever column it
 * lands in. Keeping them apart would leave those two observations unmatched.
 */
type IdentityKeySpace = 'objectId' | 'sid';

const keysOf = (observation: AssetObservation): ReadonlyArray<[IdentityKeySpace, string]> => {
  const props = identityProperties(observation);
  const keys: Array<[IdentityKeySpace, string]> = [];
  if (props.directoryObjectId !== null) {
    keys.push(['objectId', props.directoryObjectId]);
  }
  for (const sid of [props.cloudSid, props.onPremSid]) {
    if (sid !== null) {
      keys.push(['sid', sid]);
    }
  }
  return keys;
};

/**
 * True when both sides name the same key space and disagree within it. Two accounts may
 * legitimately share neither, and an account known only from a logon event carries no object id at
 * all, so an absence never vetoes.
 */
const identifiersDisagree = (a: AssetObservation, b: AssetObservation): boolean => {
  const aProps = identityProperties(a);
  const bProps = identityProperties(b);
  if (aProps.directoryObjectId !== null && bProps.directoryObjectId !== null
    && aProps.directoryObjectId !== bProps.directoryObjectId) {
    return true;
  }
  // Compared column by column: a directory record carries a cloud SID and an on-prem SID for one
  // account, and those two differing is the normal case, not a contradiction.
  return (['cloudSid', 'onPremSid'] as const).some((column) => {
    const aSid = aProps[column];
    const bSid = bProps[column];
    return aSid !== null && bSid !== null && aSid !== bSid;
  });
};

export const buildIdentityIdentityIndex = (): IdentityIdentityIndex => {
  const assetIdByKey = new Map<string, string>();
  const observationsByAssetId = new Map<string, Array<AssetObservation>>();
  const keyOf = (space: IdentityKeySpace, value: string): string => `${space}::${value}`;

  const register: IdentityIdentityIndex['register'] = (assetId, observation) => {
    for (const [space, value] of keysOf(observation)) {
      const key = keyOf(space, value);
      if (!assetIdByKey.has(key)) {
        assetIdByKey.set(key, assetId);
      }
    }
    const observations = observationsByAssetId.get(assetId) ?? [];
    observations.push(observation);
    observationsByAssetId.set(assetId, observations);
  };

  const disagreesWith: IdentityIdentityIndex['disagreesWith'] = (assetId, observation) =>
    (observationsByAssetId.get(assetId) ?? []).some((candidate) => identifiersDisagree(observation, candidate));

  const resolve: IdentityIdentityIndex['resolve'] = (observation) => {
    for (const [space, value] of keysOf(observation)) {
      const assetId = assetIdByKey.get(keyOf(space, value));
      if (assetId !== undefined && !disagreesWith(assetId, observation)) {
        return assetId;
      }
    }
    return undefined;
  };

  return { resolve, register, disagreesWith };
};
