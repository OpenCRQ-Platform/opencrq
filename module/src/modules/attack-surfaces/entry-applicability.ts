import type { AssetCategory, AssetSubcategory } from '../supporting-assets/constants';
import type { DeclaredExposure, SupportingAssetExposure } from '../supporting-assets/schema';

/** What an asset of unknown exposure is treated as when an entry technique asks where it can be launched. */
export type UnknownExposureCountsAs = DeclaredExposure;
export const UNKNOWN_EXPOSURE_COUNTS_AS_VALUES: ReadonlyArray<UnknownExposureCountsAs> = ['internal', 'internet_facing'];

const EXPOSED_SERVICE_TECHNIQUES: ReadonlySet<string> = new Set(['T1190', 'T1133']);
/** Denial-of-service floods of the path around the door: launched at an exposed service, with no foothold. */
const OUTSIDE_PERIMETER_EXPOSED_TECHNIQUES: ReadonlySet<string> = new Set(['T1498', 'T1499']);
const USER_REACHING_TECHNIQUES: ReadonlySet<string> = new Set(['T1566', 'T1189']);
const VALID_ACCOUNTS = 'T1078';

/** Initial access techniques with no asset the campaign can land on: physical, supply chain, trusted relationship. */
const NEVER_PLAYED_TECHNIQUES: ReadonlySet<string> = new Set(['T1091', 'T1200', 'T1669', 'T1195', 'T1199', 'T1659']);

const USER_REACHED_HOST_SUBCATEGORIES: ReadonlySet<AssetSubcategory> = new Set(['workstation', 'laptop']);
const ACCOUNT_IDENTITY_SUBCATEGORIES: ReadonlySet<AssetSubcategory> = new Set(['user_account', 'service_account', 'non_human_identity']);

const parentOf = (techniqueExternalId: string): string => techniqueExternalId.split('.')[0];

/** The techniques of the Initial Access tactic (TA0001), on the parent technique. */
const INITIAL_ACCESS_TECHNIQUES: ReadonlySet<string> = new Set([
  ...EXPOSED_SERVICE_TECHNIQUES,
  ...USER_REACHING_TECHNIQUES,
  VALID_ACCOUNTS,
  ...NEVER_PLAYED_TECHNIQUES,
]);

export const isInitialAccessTechnique = (techniqueExternalId: string): boolean =>
  INITIAL_ACCESS_TECHNIQUES.has(parentOf(techniqueExternalId));

/** Compared on the parent technique: `T1566.002` is `T1566`. */
export const isPlayedAtInitialAccess = (techniqueExternalId: string): boolean =>
  !NEVER_PLAYED_TECHNIQUES.has(parentOf(techniqueExternalId));

/** The exposure an asset counts as, an unknown one being what the tenant setting says. */
export const countedExposure = (
  exposure: SupportingAssetExposure,
  unknownExposureCountsAs: UnknownExposureCountsAs,
): DeclaredExposure => (exposure === 'unknown' ? unknownExposureCountsAs : exposure);

/** Whether an asset sits on the internet, an unknown exposure counting as the tenant setting says. */
export const isEffectivelyExposed = (
  exposure: SupportingAssetExposure,
  unknownExposureCountsAs: UnknownExposureCountsAs,
): boolean => countedExposure(exposure, unknownExposureCountsAs) === 'internet_facing';

/** Compared on the parent technique. These techniques play on an asset only where {@link isEffectivelyExposed} holds. */
export const needsExposureOutsidePerimeter = (techniqueExternalId: string): boolean =>
  OUTSIDE_PERIMETER_EXPOSED_TECHNIQUES.has(parentOf(techniqueExternalId));

export interface EntryAsset {
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
  exposure: SupportingAssetExposure,
  /** False only when every observation that fills `is_enabled` says false. */
  identityEnabled: boolean,
}

const reachesUser = ({ categoryId, subcategoryId, identityEnabled }: EntryAsset): boolean => {
  if (categoryId === 'host') {
    return subcategoryId === null || USER_REACHED_HOST_SUBCATEGORIES.has(subcategoryId);
  }
  if (categoryId === 'identity') {
    return subcategoryId === 'user_account' && identityEnabled;
  }
  return categoryId === 'mobile_device';
};

const signsIn = ({ categoryId, subcategoryId, identityEnabled }: EntryAsset): boolean => {
  if (categoryId === 'identity') {
    return subcategoryId !== null && ACCOUNT_IDENTITY_SUBCATEGORIES.has(subcategoryId) && identityEnabled;
  }
  return categoryId === 'cloud_resource' && subcategoryId === 'iam_principal';
};

/**
 * Whether an entry technique can be launched against the asset. Only a technique of the door
 * answers true; the technique families table is the caller's to cross.
 */
export const entryTechniqueApplies = (
  techniqueExternalId: string,
  asset: EntryAsset,
  unknownExposureCountsAs: UnknownExposureCountsAs,
): boolean => {
  const technique = parentOf(techniqueExternalId);
  if (EXPOSED_SERVICE_TECHNIQUES.has(technique)) {
    return isEffectivelyExposed(asset.exposure, unknownExposureCountsAs);
  }
  if (USER_REACHING_TECHNIQUES.has(technique)) {
    return reachesUser(asset);
  }
  if (technique === VALID_ACCOUNTS) {
    return signsIn(asset);
  }
  return false;
};
