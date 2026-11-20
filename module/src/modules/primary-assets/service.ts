import { diffSets, newError } from '@app/utils';
import type { PrimaryAssetOnboardingTemplate, SecurityNeedLevel } from './constants';
import { isUniqueViolationOf } from '../../db/pg-errors';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { businessValueCategoriesService } from '../business-value-categories';
import { DuplicatePrimaryAssetReferenceError, DuplicatePrimaryAssetTemplateError } from './errors';
import { primaryAssetsRepository } from './repository';

export interface PrimaryAssetNativeFields {
  reference: string | null,
  businessFunction: string | null,
  availability: SecurityNeedLevel | null,
  integrity: SecurityNeedLevel | null,
  confidentiality: SecurityNeedLevel | null,
  traceability: SecurityNeedLevel | null,
  rtoMinutes: number | null,
  rpoMinutes: number | null,
  mtpdMinutes: number | null,
}

/** A blank text is no value: a reference of spaces would otherwise collide with every other one. */
const trimmedOrNull = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const REFERENCE_UNIQUE_INDEX = 'primary_assets_organization_reference_uq';
const TEMPLATE_UNIQUE_INDEX = 'primary_assets_organization_onboarding_template_uq';

/** The pre-check answers a plain duplicate, the index a concurrent one: both reach the caller as the same refusal. */
const refusingDuplicateReference = async (reference: string | null | undefined, write: () => Promise<void>): Promise<void> => {
  try {
    await write();
  } catch (error) {
    if (reference != null && isUniqueViolationOf(error, REFERENCE_UNIQUE_INDEX)) {
      throw new DuplicatePrimaryAssetReferenceError(reference);
    }
    throw error;
  }
};

/** Two members, or two tabs, can pick the same template at once: the index answers the second. */
const refusingDuplicateTemplate = async (template: PrimaryAssetOnboardingTemplate | null | undefined, write: () => Promise<void>): Promise<void> => {
  try {
    await write();
  } catch (error) {
    if (template != null && isUniqueViolationOf(error, TEMPLATE_UNIQUE_INDEX)) {
      throw new DuplicatePrimaryAssetTemplateError(template);
    }
    throw error;
  }
};

const normalizeTexts = <T extends Partial<Pick<PrimaryAssetNativeFields, 'reference' | 'businessFunction'>>>(values: T): T => ({
  ...values,
  ...(values.reference !== undefined ? { reference: trimmedOrNull(values.reference) } : {}),
  ...(values.businessFunction !== undefined ? { businessFunction: trimmedOrNull(values.businessFunction) } : {}),
});

export const primaryAssetsService = defineService(
  'primaryAssets',
  primaryAssetsRepository,
).dependsOn(() => [businessValueCategoriesService]).implement({
  createPrimaryAsset: async ({ atomic, eventOrigin }, values: {
    id: string,
    organizationId: string,
    name: string,
    description: string | null,
    ownerId: string | null,
    businessValueCategoryIds: Array<string>,
    onboardingTemplate?: PrimaryAssetOnboardingTemplate | null,
  } & Partial<PrimaryAssetNativeFields>) => {
    const tenantId = requireTenantId(eventOrigin);
    const { businessValueCategoryIds, ...fields } = normalizeTexts(values);
    await refusingDuplicateTemplate(fields.onboardingTemplate, async () => refusingDuplicateReference(fields.reference, async () => atomic(async ({ repo: atomicRepo }) => {
      if (businessValueCategoryIds.length > 0) {
        await atomicRepo.validateBusinessValueCategoryIds(businessValueCategoryIds);
      }
      if (fields.reference != null
        && await atomicRepo.findPrimaryAssetIdByReference(fields.organizationId, fields.reference, null) !== undefined) {
        throw new DuplicatePrimaryAssetReferenceError(fields.reference);
      }
      await atomicRepo.insertPrimaryAsset({ ...fields, tenantId });
      if (businessValueCategoryIds.length > 0) {
        await atomicRepo.insertBusinessValueCategoryAssignments(
          businessValueCategoryIds.map((businessValueCategoryId) => ({ primaryAssetId: values.id, businessValueCategoryId })),
        );
      }
    })));
  },
  updatePrimaryAsset: async ({ atomic }, id: string, values: {
    name?: string,
    description?: string | null,
    ownerId?: string | null,
    businessValueCategoryIds?: Array<string>,
  } & Partial<PrimaryAssetNativeFields>) => {
    const { businessValueCategoryIds, ...fields } = normalizeTexts(values);
    await refusingDuplicateReference(fields.reference, async () => atomic(async ({ repo: atomicRepo }) => {
      if (fields.reference != null) {
        const current = await atomicRepo.findPrimaryAssetById(id);
        if (!current) {
          throw newError('Access Denied');
        }
        if (await atomicRepo.findPrimaryAssetIdByReference(current.organizationId, fields.reference, id) !== undefined) {
          throw new DuplicatePrimaryAssetReferenceError(fields.reference);
        }
      }
      if (Object.keys(fields).length > 0) {
        await atomicRepo.updatePrimaryAsset(id, fields);
      }
      if (businessValueCategoryIds !== undefined) {
        const existingIds = await atomicRepo.findBusinessValueCategoryAssignmentIds(id);
        const { toAdd, toRemove } = diffSets(existingIds, businessValueCategoryIds);
        if (toAdd.length > 0) {
          await atomicRepo.validateBusinessValueCategoryIds(toAdd);
          await atomicRepo.insertBusinessValueCategoryAssignments(
            toAdd.map((businessValueCategoryId) => ({ primaryAssetId: id, businessValueCategoryId })),
          );
        }
        if (toRemove.length > 0) {
          await atomicRepo.deleteBusinessValueCategoryAssignmentsByIds(id, toRemove);
        }
      }
    }));
  },
  deletePrimaryAssets: async ({ repo }, ids: Array<string>) => await repo.deletePrimaryAssets(ids),
  getPrimaryAsset: async ({ repo }, id: string) => await repo.findPrimaryAssetById(id),
  getPrimaryAssets: async ({ repo }, organizationId: string) => await repo.findAllPrimaryAssets(organizationId),
  /** The primary assets of every risk scope the caller sees, each naming its scope. */
  getPrimaryAssetsWithScope: async ({ repo }) => await repo.findPrimaryAssetsWithScope(),
});
