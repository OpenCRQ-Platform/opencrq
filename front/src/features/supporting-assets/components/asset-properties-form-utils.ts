import { ASSET_SUBCATEGORY_VALUES, identityFamilyOf, SUBCATEGORY_TO_CATEGORY } from '@app/module/client';
import type {
  AiTargetModality,
  AiTargetProvider,
  AssetCategory,
  AssetIdentityProvider,
  AssetObservationProperties,
  AssetSubcategory,
  CloudProvider,
  EndpointArch,
} from '@app/module/client';

/**
 * Splits a comma-separated address field into trimmed, non-empty entries. Multiple commas, stray
 * whitespace and a blank field all collapse to the same shape, so `'a,, b ,c'` and `'a, b, c'`
 * parse identically.
 */
export const parseAddressList = (raw: string): Array<string> =>
  raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);

/** Inverse of {@link parseAddressList}: joins addresses back into one comma-separated field. */
export const formatAddressList = (values: ReadonlyArray<string> | null | undefined): string =>
  (values ?? []).join(', ');

/** Every subcategory belonging to `categoryId`, in `ASSET_SUBCATEGORY_VALUES`'s own order. */
export const subcategoriesFor = (categoryId: AssetCategory): Array<AssetSubcategory> =>
  ASSET_SUBCATEGORY_VALUES.filter((subcategory) => SUBCATEGORY_TO_CATEGORY[subcategory] === categoryId);

/** Whether `subcategoryId` still belongs to `categoryId` — `null` always does, an unrelated pair never does. */
export const isSubcategoryValidFor = (categoryId: AssetCategory, subcategoryId: AssetSubcategory | null): boolean =>
  subcategoryId === null || SUBCATEGORY_TO_CATEGORY[subcategoryId] === categoryId;

/**
 * URL is offered on a category that calls for it, or on any category the asset already carries
 * one on — a connector can fill it regardless of category, and a value the detail page shows must
 * stay correctable. `existingUrl` is the asset's own value, not the form's live one: it
 * must not flip off while the user is mid-edit clearing the field.
 */
export const showsUrlField = (categoryId: AssetCategory, existingUrl: string | null): boolean =>
  categoryId === 'web_application' || categoryId === 'saas_application' || existingUrl !== null;

/** Same rule as {@link showsUrlField}, for Person on the `identity` category. */
export const showsPersonField = (categoryId: AssetCategory, existingLinkedPerson: string | null): boolean =>
  categoryId === 'identity' || existingLinkedPerson !== null;

/**
 * The manually-editable subset of a family's property block — calqued on the router's
 * `MANUAL_MACHINE_PROPERTIES_SCHEMA` / `MANUAL_AI_TARGET_PROPERTIES_SCHEMA` / `MANUAL_IDENTITY_PROPERTIES_SCHEMA`
 * (`back/src/features/app-router/supporting-assets/supporting-assets-router.ts`), which excludes
 * every connector identifier.
 */
export interface ManualMachineAssetProperties {
  family: 'machine',
  hostname: string | null,
  ipAddresses: Array<string>,
  macAddresses: Array<string>,
  seenIp: string | null,
  platform: string | null,
  arch: EndpointArch | null,
  vendor: string | null,
  model: string | null,
  operatingSystem: string | null,
  osVersion: string | null,
  isEol: boolean | null,
  cloudProvider: CloudProvider | null,
  cloudNativeType: string | null,
  cloudRegion: string | null,
}

export interface ManualAiTargetAssetProperties {
  family: 'ai_target',
  provider: AiTargetProvider | null,
  modality: AiTargetModality | null,
  model: string | null,
  endpointUrl: string | null,
  systemPrompt: string | null,
}

/** Minus the directory's own identifiers — the object id and both SIDs — as the router's `MANUAL_IDENTITY_PROPERTIES_SCHEMA` has it. */
export interface ManualIdentityAssetProperties {
  family: 'identity',
  userPrincipalName: string | null,
  accountName: string | null,
  accountDomain: string | null,
  identityProvider: AssetIdentityProvider | null,
  department: string | null,
  jobTitle: string | null,
  isEnabled: boolean | null,
  assignedRoles: Array<string>,
  privilegedPimRoles: Array<string>,
}

export type ManualAssetProperties = ManualMachineAssetProperties | ManualAiTargetAssetProperties | ManualIdentityAssetProperties;

/** The form's own shape for a family's property block — address and role lists are held as comma-separated text, see {@link parseAddressList}. */
export interface AssetPropertiesFormValues {
  hostname: string | null,
  seenIp: string | null,
  ipAddressesText: string,
  macAddressesText: string,
  platform: string | null,
  arch: EndpointArch | null,
  /** The machine's own, apart from the AI target's `model`: both live in one flat form. */
  machineVendor: string | null,
  machineModel: string | null,
  operatingSystem: string | null,
  osVersion: string | null,
  isEol: boolean | null,
  cloudProvider: CloudProvider | null,
  cloudNativeType: string | null,
  cloudRegion: string | null,
  provider: AiTargetProvider | null,
  modality: AiTargetModality | null,
  model: string | null,
  endpointUrl: string | null,
  systemPrompt: string | null,
  userPrincipalName: string | null,
  accountName: string | null,
  accountDomain: string | null,
  identityProvider: AssetIdentityProvider | null,
  department: string | null,
  jobTitle: string | null,
  isEnabled: boolean | null,
  assignedRolesText: string,
  privilegedPimRolesText: string,
}

export const emptyAssetPropertiesFormValues: AssetPropertiesFormValues = {
  hostname: null,
  seenIp: null,
  ipAddressesText: '',
  macAddressesText: '',
  platform: null,
  arch: null,
  machineVendor: null,
  machineModel: null,
  operatingSystem: null,
  osVersion: null,
  isEol: null,
  cloudProvider: null,
  cloudNativeType: null,
  cloudRegion: null,
  provider: null,
  modality: null,
  model: null,
  endpointUrl: null,
  systemPrompt: null,
  userPrincipalName: null,
  accountName: null,
  accountDomain: null,
  identityProvider: null,
  department: null,
  jobTitle: null,
  isEnabled: null,
  assignedRolesText: '',
  privilegedPimRolesText: '',
};

/**
 * Prefills the form from the asset's resolved (merged) property blocks — never the manual-only
 * ones, so editing starts from what the asset currently shows, connector-derived values included.
 * One block per family: the ones the asset left are kept on file, and prefilling their
 * fields too is what shows them again the moment the reader switches the category back.
 */
export const assetPropertiesFormValuesFrom = (blocks: ReadonlyArray<AssetObservationProperties>): AssetPropertiesFormValues =>
  blocks.reduce<AssetPropertiesFormValues>((values, properties) => {
    if (properties.family === 'identity') {
      return {
        ...values,
        userPrincipalName: properties.userPrincipalName,
        accountName: properties.accountName,
        accountDomain: properties.accountDomain,
        identityProvider: properties.identityProvider,
        department: properties.department,
        jobTitle: properties.jobTitle,
        isEnabled: properties.isEnabled,
        assignedRolesText: formatAddressList(properties.assignedRoles),
        privilegedPimRolesText: formatAddressList(properties.privilegedPimRoles),
      };
    }
    return properties.family === 'machine'
      ? {
        ...values,
        hostname: properties.hostname,
        seenIp: properties.seenIp,
        ipAddressesText: formatAddressList(properties.ipAddresses),
        macAddressesText: formatAddressList(properties.macAddresses),
        platform: properties.platform,
        arch: properties.arch,
        machineVendor: properties.vendor,
        machineModel: properties.model,
        operatingSystem: properties.operatingSystem,
        osVersion: properties.osVersion,
        isEol: properties.isEol,
        cloudProvider: properties.cloudProvider,
        cloudNativeType: properties.cloudNativeType,
        cloudRegion: properties.cloudRegion,
      }
      : {
        ...values,
        provider: properties.provider,
        modality: properties.modality,
        model: properties.model,
        endpointUrl: properties.endpointUrl,
        systemPrompt: properties.systemPrompt,
      };
  }, emptyAssetPropertiesFormValues);

export type AssetPropertiesDirtyFields = Partial<Record<keyof AssetPropertiesFormValues, boolean>>;

const MACHINE_FIELD_KEYS = ['hostname', 'seenIp', 'ipAddressesText', 'macAddressesText', 'platform', 'arch', 'machineVendor', 'machineModel', 'operatingSystem', 'osVersion', 'isEol', 'cloudProvider', 'cloudNativeType', 'cloudRegion'] as const;
const AI_TARGET_FIELD_KEYS = ['provider', 'modality', 'model', 'endpointUrl', 'systemPrompt'] as const;
const IDENTITY_FIELD_KEYS = [
  'userPrincipalName', 'accountName', 'accountDomain', 'identityProvider', 'department', 'jobTitle', 'isEnabled', 'assignedRolesText', 'privilegedPimRolesText',
] as const;

/**
 * Builds the family's property payload from what changed this session alone. A field the reader
 * left untouched falls back to its previous manual pin, never to the resolved value the form
 * displays: that resolved value can come straight from a connector, and re-sending it here would
 * pin it against every later sync.
 *
 * Returns `undefined` when no field of the category's family was touched: a bare category change
 * sends no block at all, so the manual block of the family the asset leaves is kept, not
 * overwritten, and comes back if the category is switched back. `previousManualBlocks` holds one
 * block per family; only the category's own family is read.
 */
export const buildManualAssetProperties = (
  categoryId: AssetCategory,
  values: AssetPropertiesFormValues,
  dirtyFields: AssetPropertiesDirtyFields | undefined,
  previousManualBlocks: ReadonlyArray<AssetObservationProperties>,
): ManualAssetProperties | undefined => {
  const isDirty = (key: keyof AssetPropertiesFormValues): boolean => dirtyFields?.[key] === true;
  const family = identityFamilyOf(categoryId);

  if (family === 'machine') {
    if (!MACHINE_FIELD_KEYS.some(isDirty)) {
      return undefined;
    }
    const previous = previousManualBlocks.find((block) => block.family === 'machine');
    return {
      family: 'machine',
      hostname: isDirty('hostname') ? values.hostname : (previous?.hostname ?? null),
      ipAddresses: isDirty('ipAddressesText') ? parseAddressList(values.ipAddressesText) : [...(previous?.ipAddresses ?? [])],
      macAddresses: isDirty('macAddressesText') ? parseAddressList(values.macAddressesText) : [...(previous?.macAddresses ?? [])],
      seenIp: isDirty('seenIp') ? values.seenIp : (previous?.seenIp ?? null),
      platform: isDirty('platform') ? values.platform : (previous?.platform ?? null),
      arch: isDirty('arch') ? values.arch : (previous?.arch ?? null),
      vendor: isDirty('machineVendor') ? values.machineVendor : (previous?.vendor ?? null),
      model: isDirty('machineModel') ? values.machineModel : (previous?.model ?? null),
      operatingSystem: isDirty('operatingSystem') ? values.operatingSystem : (previous?.operatingSystem ?? null),
      osVersion: isDirty('osVersion') ? values.osVersion : (previous?.osVersion ?? null),
      isEol: isDirty('isEol') ? values.isEol : (previous?.isEol ?? null),
      cloudProvider: isDirty('cloudProvider') ? values.cloudProvider : (previous?.cloudProvider ?? null),
      cloudNativeType: isDirty('cloudNativeType') ? values.cloudNativeType : (previous?.cloudNativeType ?? null),
      cloudRegion: isDirty('cloudRegion') ? values.cloudRegion : (previous?.cloudRegion ?? null),
    };
  }

  if (family === 'ai_target') {
    if (!AI_TARGET_FIELD_KEYS.some(isDirty)) {
      return undefined;
    }
    const previous = previousManualBlocks.find((block) => block.family === 'ai_target');
    return {
      family: 'ai_target',
      provider: isDirty('provider') ? values.provider : (previous?.provider ?? null),
      modality: isDirty('modality') ? values.modality : (previous?.modality ?? null),
      model: isDirty('model') ? values.model : (previous?.model ?? null),
      endpointUrl: isDirty('endpointUrl') ? values.endpointUrl : (previous?.endpointUrl ?? null),
      systemPrompt: isDirty('systemPrompt') ? values.systemPrompt : (previous?.systemPrompt ?? null),
    };
  }

  if (family === 'identity') {
    if (!IDENTITY_FIELD_KEYS.some(isDirty)) {
      return undefined;
    }
    const previous = previousManualBlocks.find((block) => block.family === 'identity');
    return {
      family: 'identity',
      userPrincipalName: isDirty('userPrincipalName') ? values.userPrincipalName : (previous?.userPrincipalName ?? null),
      accountName: isDirty('accountName') ? values.accountName : (previous?.accountName ?? null),
      accountDomain: isDirty('accountDomain') ? values.accountDomain : (previous?.accountDomain ?? null),
      identityProvider: isDirty('identityProvider') ? values.identityProvider : (previous?.identityProvider ?? null),
      department: isDirty('department') ? values.department : (previous?.department ?? null),
      jobTitle: isDirty('jobTitle') ? values.jobTitle : (previous?.jobTitle ?? null),
      isEnabled: isDirty('isEnabled') ? values.isEnabled : (previous?.isEnabled ?? null),
      assignedRoles: isDirty('assignedRolesText') ? parseAddressList(values.assignedRolesText) : [...(previous?.assignedRoles ?? [])],
      privilegedPimRoles: isDirty('privilegedPimRolesText') ? parseAddressList(values.privilegedPimRolesText) : [...(previous?.privilegedPimRoles ?? [])],
    };
  }

  return undefined;
};
