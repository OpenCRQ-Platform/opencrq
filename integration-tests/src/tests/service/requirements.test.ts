import type { EventOrigin, RequirementWriteValues } from '@app/module';
import {
  AttackOutcome_Espionage,
  AttackOutcome_ServiceDisruption,
  BusinessValueCategory_OperationsAndServices,
  BusinessValueCategory_ServicesUnderCommitments,
  deriveSeedId,
  LossDriver_ContractualPenalties,
  LossDriver_LitigationDefense,
  requirementLossDriverActivations,
  requirementTargets,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Requirements', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;

  const seeded = (catalogId: string) => deriveSeedId(tenantId, catalogId);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
  });

  const createAsset = async (name: string, categoryCatalogIds: Array<string>, scopeId = organizationId) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id,
      organizationId: scopeId,
      name,
      description: null,
      ownerId: null,
      businessValueCategoryIds: categoryCatalogIds.map(seeded),
    });
    return id;
  };

  const createRequirement = async (values: Partial<RequirementWriteValues>, scopeId = organizationId) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).requirements.createRequirement({
      id,
      organizationId: scopeId,
      name: 'Hosting availability commitment',
      description: null,
      interestedParty: 'Acme Corp',
      protectsConfidentiality: false,
      protectsIntegrity: false,
      protectsAvailability: true,
      primaryAssetIds: [],
      businessValueCategoryIds: [],
      lossDriverIds: [seeded(LossDriver_ContractualPenalties)],
      ...values,
    });
    return id;
  };

  const createScenario = async (attackOutcomeCatalogId: string, primaryAssetIds: Array<string>) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id,
      organizationId,
      name: `Scenario ${id.substring(0, 8)}`,
      description: null,
      attackOutcomeId: seeded(attackOutcomeCatalogId),
      primaryAssetIds,
    });
    return id;
  };

  const brokenNames = async (riskScenarioId: string) =>
    (await services.withOrigin(adminOrigin).requirements.getBrokenRequirements(riskScenarioId)).map((requirement) => requirement.name);

  describe('CRUD', () => {
    it('should create a requirement with its targets and loss drivers, and read it back', async () => {
      const assetId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      const id = await createRequirement({
        description: '99.9% availability',
        primaryAssetIds: [assetId],
        businessValueCategoryIds: [seeded(BusinessValueCategory_ServicesUnderCommitments)],
        lossDriverIds: [seeded(LossDriver_ContractualPenalties), seeded(LossDriver_LitigationDefense)],
      });

      const requirement = await services.withOrigin(adminOrigin).requirements.getRequirement(id);
      expect(requirement).toMatchObject({
        name: 'Hosting availability commitment',
        description: '99.9% availability',
        interestedParty: 'Acme Corp',
        protectsAvailability: true,
        protectsConfidentiality: false,
      });
      expect(requirement!.primaryAssets).toEqual([{ id: assetId, name: 'Hosting platform' }]);
      expect(requirement!.businessValueCategories.map((category) => category.code)).toEqual(['services-under-commitments']);
      expect(requirement!.lossDrivers.map((driver) => driver.id).toSorted())
        .toEqual([seeded(LossDriver_ContractualPenalties), seeded(LossDriver_LitigationDefense)].toSorted());

      const listed = await services.withOrigin(adminOrigin).requirements.getRequirements(organizationId);
      expect(listed.map((row) => row.id)).toEqual([id]);
    });

    it('should edit its fields, targets and loss drivers as a difference', async () => {
      const firstId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      const secondId = await createAsset('Billing', [BusinessValueCategory_OperationsAndServices]);
      const id = await createRequirement({ primaryAssetIds: [firstId] });
      const [keptTarget] = await db.select({ id: requirementTargets.id }).from(requirementTargets).where(eq(requirementTargets.primaryAssetId, firstId));

      await services.withOrigin(adminOrigin).requirements.updateRequirement(id, {
        name: 'Renamed',
        protectsIntegrity: true,
        primaryAssetIds: [firstId, secondId],
        businessValueCategoryIds: [seeded(BusinessValueCategory_ServicesUnderCommitments)],
        lossDriverIds: [seeded(LossDriver_LitigationDefense)],
      });

      const requirement = await services.withOrigin(adminOrigin).requirements.getRequirement(id);
      expect(requirement).toMatchObject({ name: 'Renamed', protectsIntegrity: true, protectsAvailability: true });
      expect(requirement!.primaryAssets.map((asset) => asset.id).toSorted()).toEqual([firstId, secondId].toSorted());
      expect(requirement!.businessValueCategories).toHaveLength(1);
      expect(requirement!.lossDrivers.map((driver) => driver.id)).toEqual([seeded(LossDriver_LitigationDefense)]);
      const stillThere = await db.select({ id: requirementTargets.id }).from(requirementTargets).where(eq(requirementTargets.id, keptTarget.id));
      expect(stillThere).toHaveLength(1);
    });

    it('should delete a requirement with its targets and loss driver rows', async () => {
      const assetId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      const id = await createRequirement({ primaryAssetIds: [assetId] });

      await services.withOrigin(adminOrigin).requirements.deleteRequirements([id]);

      expect(await services.withOrigin(adminOrigin).requirements.getRequirement(id)).toBeUndefined();
      expect(await db.select().from(requirementTargets).where(eq(requirementTargets.requirementId, id))).toEqual([]);
      expect(await db.select().from(requirementLossDriverActivations).where(eq(requirementLossDriverActivations.requirementId, id))).toEqual([]);
    });

    it('should refuse a primary asset of another risk scope as a target', async () => {
      const otherScopeId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherScopeId, name: 'Other scope' }]);
      const foreignAssetId = await createAsset('Elsewhere', [BusinessValueCategory_OperationsAndServices], otherScopeId);

      await expect(createRequirement({ primaryAssetIds: [foreignAssetId] })).rejects.toThrow('Access Denied');
    });
  });

  describe('target check', () => {
    it('should refuse a target row naming both a primary asset and a category, or neither', async () => {
      const assetId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      const requirementId = await createRequirement({ primaryAssetIds: [assetId] });
      const row = { tenantId, requirementId };

      await expect(db.insert(requirementTargets).values({
        ...row, id: uuidv7(), primaryAssetId: assetId, businessValueCategoryId: seeded(BusinessValueCategory_ServicesUnderCommitments),
      })).rejects.toMatchObject({ cause: { constraint: 'requirement_targets_one_target_ck' } });
      await expect(db.insert(requirementTargets).values({ ...row, id: uuidv7() }))
        .rejects.toMatchObject({ cause: { constraint: 'requirement_targets_one_target_ck' } });
    });
  });

  describe('cascades', () => {
    it('should drop the target row of a deleted primary asset and keep the requirement', async () => {
      const assetId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      const id = await createRequirement({
        primaryAssetIds: [assetId],
        businessValueCategoryIds: [seeded(BusinessValueCategory_ServicesUnderCommitments)],
      });

      await services.withOrigin(adminOrigin).primaryAssets.deletePrimaryAssets([assetId]);

      const requirement = await services.withOrigin(adminOrigin).requirements.getRequirement(id);
      expect(requirement!.primaryAssets).toEqual([]);
      expect(requirement!.businessValueCategories).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('should keep a requirement invisible and untouchable from another tenant', async () => {
      const assetId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      const id = await createRequirement({ primaryAssetIds: [assetId] });
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(otherOrigin).requirements.getRequirement(id)).toBeUndefined();
      expect(await services.withOrigin(otherOrigin).requirements.getRequirements(organizationId)).toEqual([]);
      await expect(services.withOrigin(otherOrigin).requirements.updateRequirement(id, { name: 'Taken' })).rejects.toThrow('Access Denied');
      await services.withOrigin(otherOrigin).requirements.deleteRequirements([id]);

      expect((await services.withOrigin(adminOrigin).requirements.getRequirement(id))?.name).toBe('Hosting availability commitment');
    });

    it('should refuse a business resource category of another tenant', async () => {
      const otherTenantId = await createTenant(services, adminUserId);

      await expect(createRequirement({
        businessValueCategoryIds: [deriveSeedId(otherTenantId, BusinessValueCategory_ServicesUnderCommitments)],
      })).rejects.toThrow('Access Denied');
    });
  });

  describe('broken requirements', () => {
    it('should be broken by a scenario on a targeted primary asset whose outcome reaches a protected criterion', async () => {
      const assetId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      await createRequirement({ primaryAssetIds: [assetId] });

      const disruption = await createScenario(AttackOutcome_ServiceDisruption, [assetId]);
      const espionage = await createScenario(AttackOutcome_Espionage, [assetId]);

      expect(await brokenNames(disruption)).toEqual(['Hosting availability commitment']);
      expect(await brokenNames(espionage)).toEqual([]);
    });

    it('should be broken through a category by a scenario on any primary asset carrying it', async () => {
      const assetId = await createAsset('Customer portal', [BusinessValueCategory_ServicesUnderCommitments]);
      await createRequirement({ businessValueCategoryIds: [seeded(BusinessValueCategory_ServicesUnderCommitments)] });

      expect(await brokenNames(await createScenario(AttackOutcome_ServiceDisruption, [assetId]))).toEqual(['Hosting availability commitment']);
    });

    it('should follow a new requirement and a change of targets without editing the scenario', async () => {
      const hostingId = await createAsset('Hosting platform', [BusinessValueCategory_OperationsAndServices]);
      const billingId = await createAsset('Billing', [BusinessValueCategory_OperationsAndServices]);
      const scenarioId = await createScenario(AttackOutcome_ServiceDisruption, [hostingId]);
      expect(await brokenNames(scenarioId)).toEqual([]);

      const requirementId = await createRequirement({ primaryAssetIds: [billingId] });
      expect(await brokenNames(scenarioId)).toEqual([]);

      await services.withOrigin(adminOrigin).requirements.updateRequirement(requirementId, { primaryAssetIds: [billingId, hostingId] });
      expect(await brokenNames(scenarioId)).toEqual(['Hosting availability commitment']);
    });

    it('should leave a requirement of another risk scope unbroken through a shared category', async () => {
      const otherScopeId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherScopeId, name: 'Other scope' }]);
      const assetId = await createAsset('Customer portal', [BusinessValueCategory_ServicesUnderCommitments]);
      await createRequirement({ businessValueCategoryIds: [seeded(BusinessValueCategory_ServicesUnderCommitments)] }, otherScopeId);

      expect(await brokenNames(await createScenario(AttackOutcome_ServiceDisruption, [assetId]))).toEqual([]);
    });

    it('should propose the union of the matrix drivers and the broken requirements drivers, each once with its origin', async () => {
      const assetId = await createAsset('Customer portal', [BusinessValueCategory_ServicesUnderCommitments]);
      const scenarioId = await createScenario(AttackOutcome_ServiceDisruption, [assetId]);
      const before = await services.withOrigin(adminOrigin).lossDrivers.getScenarioDriverRecommendation(scenarioId);
      const matrixIds = before.recommendations.map((entry) => entry.lossDriverId);
      expect(matrixIds).toContain(seeded(LossDriver_ContractualPenalties));
      expect(matrixIds).not.toContain(seeded(LossDriver_LitigationDefense));

      const requirementId = await createRequirement({
        primaryAssetIds: [assetId],
        lossDriverIds: [seeded(LossDriver_ContractualPenalties), seeded(LossDriver_LitigationDefense)],
      });

      const after = await services.withOrigin(adminOrigin).lossDrivers.getScenarioDriverRecommendation(scenarioId);
      const ids = after.recommendations.map((entry) => entry.lossDriverId);
      expect(ids.toSorted()).toEqual([...matrixIds, seeded(LossDriver_LitigationDefense)].toSorted());
      expect(after.compatibleCellCount).toBe(before.compatibleCellCount);

      const origin = { requirementId, requirementName: 'Hosting availability commitment' };
      const penalties = after.recommendations.find((entry) => entry.lossDriverId === seeded(LossDriver_ContractualPenalties));
      expect(penalties!.viaCells.length).toBeGreaterThan(0);
      expect(penalties!.viaRequirements).toEqual([origin]);
      const litigation = after.recommendations.find((entry) => entry.lossDriverId === seeded(LossDriver_LitigationDefense));
      expect(litigation).toEqual({ lossDriverId: seeded(LossDriver_LitigationDefense), viaCells: [], viaRequirements: [origin] });
    });
  });
});
