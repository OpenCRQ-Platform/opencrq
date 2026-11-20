import type { AssetCategory, AssetCriticality, AssetObservationProperties, AssetSubcategory, SupportingAssetExposure } from '@app/module/client';
import type { AssetPropertiesDirtyFields, AssetPropertiesFormValues, ManualAssetProperties } from './asset-properties-form-utils';
import type { AssetTagOption } from './asset-tags-form-utils';
import { buildManualAssetProperties } from './asset-properties-form-utils';
import { tagNamesFrom } from './asset-tags-form-utils';

export interface SupportingAssetUpdateFormValues {
  name: string | null,
  ownerId: string | null,
  description: string | null,
  exposure: SupportingAssetExposure,
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
  url: string | null,
  linkedPerson: string | null,
  criticality: AssetCriticality,
  properties: AssetPropertiesFormValues,
  tags: Array<AssetTagOption>,
}

type ScalarKey = Exclude<keyof SupportingAssetUpdateFormValues, 'properties' | 'tags'>;

export type SupportingAssetUpdateDirtyFields = Partial<Record<ScalarKey, boolean>> & {
  properties?: AssetPropertiesDirtyFields,
  tags?: unknown,
};

export type SupportingAssetUpdatePayload = Partial<Pick<SupportingAssetUpdateFormValues, ScalarKey>> & {
  tagNames?: Array<string>,
  properties?: ManualAssetProperties,
};

const SCALAR_KEYS = ['name', 'ownerId', 'description', 'exposure', 'categoryId', 'subcategoryId', 'url', 'linkedPerson', 'criticality'] as const satisfies ReadonlyArray<ScalarKey>;

/**
 * Only the fields the user touched are sent: every attribute the backend receives is pinned as a
 * hand-set value, which would freeze an untouched one against every later connector sync. Tags are
 * sent whole once touched, since `tagNames` replaces the author's set rather than patching it.
 */
export const buildSupportingAssetUpdatePayload = (
  values: SupportingAssetUpdateFormValues,
  dirtyFields: SupportingAssetUpdateDirtyFields,
  previousManualBlocks: ReadonlyArray<AssetObservationProperties>,
): SupportingAssetUpdatePayload => {
  const payload: SupportingAssetUpdatePayload = {};
  for (const key of SCALAR_KEYS) {
    if (dirtyFields[key] === true) {
      Object.assign(payload, { [key]: values[key] });
    }
  }
  if (dirtyFields.tags !== undefined) {
    payload.tagNames = tagNamesFrom(values.tags);
  }
  const properties = buildManualAssetProperties(values.categoryId, values.properties, dirtyFields.properties, previousManualBlocks);
  if (properties) {
    payload.properties = properties;
  }
  return payload;
};
