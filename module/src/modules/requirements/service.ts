import { diffSets, newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { InferRepository } from '../../registry';
import type { RequirementUpdate } from './repository';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { requirementsRepository } from './repository';

export interface RequirementWriteValues {
  name: string,
  description: string | null,
  interestedParty: string,
  protectsConfidentiality: boolean,
  protectsIntegrity: boolean,
  protectsAvailability: boolean,
  primaryAssetIds: Array<string>,
  businessValueCategoryIds: Array<string>,
  lossDriverIds: Array<string>,
}

type RequirementsRepo = InferRepository<typeof requirementsRepository>;

const withTargetsAndDrivers = async <T extends { id: string }>(repo: RequirementsRepo, rows: Array<T>) => {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const [targets, drivers] = await Promise.all([repo.findTargets(ids), repo.findLossDrivers(ids)]);
  return rows.map((row) => ({
    ...row,
    primaryAssets: targets.flatMap((target) => (target.requirementId === row.id && target.primaryAsset ? [target.primaryAsset] : [])),
    businessValueCategories: targets.flatMap((target) => (target.requirementId === row.id && target.businessValueCategory ? [target.businessValueCategory] : [])),
    lossDrivers: drivers.filter((driver) => driver.requirementId === row.id).map(({ id, name }) => ({ id, name })),
  }));
};

export const requirementsService = defineService(
  'requirements',
  requirementsRepository,
).implement({
  createRequirement: async ({ atomic, eventOrigin }, values: RequirementWriteValues & { id: string, organizationId: string }) => {
    const tenantId = requireTenantId(eventOrigin);
    const { primaryAssetIds, businessValueCategoryIds, lossDriverIds, ...fields } = values;
    const requirementId = fields.id;
    await atomic(async ({ repo }) => {
      await repo.validateOrganization(fields.organizationId);
      await repo.validatePrimaryAssetIds(fields.organizationId, primaryAssetIds);
      await repo.validateBusinessValueCategoryIds(businessValueCategoryIds);
      await repo.validateLossDriverIds(lossDriverIds);
      await repo.insertRequirement({ ...fields, tenantId });
      const targets = [
        ...[...new Set(primaryAssetIds)].map((primaryAssetId) => ({ id: uuidv7(), tenantId, requirementId, primaryAssetId })),
        ...[...new Set(businessValueCategoryIds)].map((businessValueCategoryId) => ({ id: uuidv7(), tenantId, requirementId, businessValueCategoryId })),
      ];
      if (targets.length > 0) {
        await repo.insertTargets(targets);
      }
      if (lossDriverIds.length > 0) {
        await repo.insertLossDriverActivations([...new Set(lossDriverIds)].map((lossDriverId) => ({ tenantId, requirementId, lossDriverId })));
      }
    });
  },

  /** Targets and loss drivers are written as a difference, so an unchanged set rings nothing. */
  updateRequirement: async ({ atomic, eventOrigin }, id: string, values: Partial<RequirementWriteValues>) => {
    const tenantId = requireTenantId(eventOrigin);
    const { primaryAssetIds, businessValueCategoryIds, lossDriverIds, ...fields } = values;
    await atomic(async ({ repo }) => {
      const current = await repo.findRequirementById(id);
      if (!current) {
        throw newError('Access Denied');
      }
      const changes: RequirementUpdate = fields;
      if (Object.keys(changes).length > 0) {
        await repo.updateRequirement(id, changes);
      }
      if (primaryAssetIds !== undefined || businessValueCategoryIds !== undefined) {
        const existing = await repo.findTargets([id]);
        const removed: Array<string> = [];
        if (primaryAssetIds !== undefined) {
          const byAsset = new Map(existing.flatMap((row) => (row.primaryAsset ? [[row.primaryAsset.id, row.id] as const] : [])));
          const { toAdd, toRemove } = diffSets([...byAsset.keys()], primaryAssetIds);
          await repo.validatePrimaryAssetIds(current.organizationId, toAdd);
          removed.push(...toRemove.flatMap((assetId) => byAsset.get(assetId) ?? []));
          if (toAdd.length > 0) {
            await repo.insertTargets(toAdd.map((primaryAssetId) => ({ id: uuidv7(), tenantId, requirementId: id, primaryAssetId })));
          }
        }
        if (businessValueCategoryIds !== undefined) {
          const byCategory = new Map(existing.flatMap((row) => (row.businessValueCategory ? [[row.businessValueCategory.id, row.id] as const] : [])));
          const { toAdd, toRemove } = diffSets([...byCategory.keys()], businessValueCategoryIds);
          await repo.validateBusinessValueCategoryIds(toAdd);
          removed.push(...toRemove.flatMap((categoryId) => byCategory.get(categoryId) ?? []));
          if (toAdd.length > 0) {
            await repo.insertTargets(toAdd.map((businessValueCategoryId) => ({ id: uuidv7(), tenantId, requirementId: id, businessValueCategoryId })));
          }
        }
        if (removed.length > 0) {
          await repo.deleteTargets(removed);
        }
      }
      if (lossDriverIds !== undefined) {
        const existing = (await repo.findLossDrivers([id])).map((row) => row.id);
        const { toAdd, toRemove } = diffSets(existing, lossDriverIds);
        await repo.validateLossDriverIds(toAdd);
        if (toRemove.length > 0) {
          await repo.deleteLossDriverActivations(id, toRemove);
        }
        if (toAdd.length > 0) {
          await repo.insertLossDriverActivations(toAdd.map((lossDriverId) => ({ tenantId, requirementId: id, lossDriverId })));
        }
      }
    });
  },

  deleteRequirements: async ({ repo }, ids: Array<string>) => await repo.deleteRequirements(ids),

  getRequirements: async ({ repo }, organizationId: string) =>
    await withTargetsAndDrivers(repo, await repo.findRequirements(organizationId)),

  getRequirement: async ({ repo }, id: string) => {
    const row = await repo.findRequirementById(id);
    return row ? (await withTargetsAndDrivers(repo, [row])).at(0) : undefined;
  },

  getBrokenRequirements: async ({ repo }, riskScenarioId: string) => {
    const broken = await repo.findBrokenRequirementsForScenario(riskScenarioId);
    if (broken.length === 0) {
      return [];
    }
    const drivers = await repo.findLossDrivers(broken.map((row) => row.id));
    return broken.map((row) => ({
      ...row,
      lossDrivers: drivers.filter((driver) => driver.requirementId === row.id).map(({ id, name }) => ({ id, name })),
    }));
  },
});
