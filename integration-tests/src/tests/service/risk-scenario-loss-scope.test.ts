import type { EventOrigin } from '@app/module';
import {
  AttackOutcome_Ransomware,
  BusinessValueCategory_DataEntrustedByOthers,
  BusinessValueCategory_PersonalData,
  BusinessValueCategory_ServicesUnderCommitments,
  deriveSeedId,
} from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
describe("A risk scenario's own loss scope", () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope Org' }]);
  });

  const createAsset = async (name: string, catalogIds: Array<string>) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id,
      organizationId,
      name,
      description: null,
      ownerId: null,
      businessValueCategoryIds: catalogIds.map((catalogId) => deriveSeedId(tenantId, catalogId)),
    });
    return id;
  };

  it('should take the union of its primary assets resources and recommend the union of their columns', async () => {
    const scoped = services.withOrigin(adminOrigin);
    const portalId = await createAsset('Customer portal', [BusinessValueCategory_ServicesUnderCommitments]);
    const dossiersId = await createAsset('Client dossiers', [BusinessValueCategory_DataEntrustedByOthers, BusinessValueCategory_PersonalData]);

    const riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Ransomware on the estate',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [portalId, dossiersId],
    });

    const scenario = await scoped.riskScenarios.getRiskScenario(riskScenarioId);
    expect(scenario!.businessValueCategories.map((resource) => resource.code)).toEqual([
      'services-under-commitments',
      'personal-data',
      'data-entrusted-by-others',
    ]);

    const { compatibleCellCount } = await scoped.lossDrivers.getScenarioDriverRecommendation(riskScenarioId);
    expect(compatibleCellCount).toBe(3);
  });

  it('should widen the scope when a target is added and narrow it when one is taken away', async () => {
    const scoped = services.withOrigin(adminOrigin);
    const portalId = await createAsset('Customer portal', [BusinessValueCategory_ServicesUnderCommitments]);
    const registryId = await createAsset('Customer registry', [BusinessValueCategory_PersonalData]);

    const riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Ransomware on the portal',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [portalId],
    });

    const codesOf = async () => (await scoped.riskScenarios.getRiskScenario(riskScenarioId))!
      .businessValueCategories.map((resource) => resource.code).toSorted();

    expect(await codesOf()).toEqual(['services-under-commitments']);

    await scoped.riskScenarios.updateRiskScenario(riskScenarioId, { primaryAssetIds: [portalId, registryId] });
    expect(await codesOf()).toEqual(['personal-data', 'services-under-commitments']);
    expect((await scoped.lossDrivers.getScenarioDriverRecommendation(riskScenarioId)).compatibleCellCount).toBe(2);

    await scoped.riskScenarios.updateRiskScenario(riskScenarioId, { primaryAssetIds: [registryId] });
    expect(await codesOf()).toEqual(['personal-data']);
    expect((await scoped.lossDrivers.getScenarioDriverRecommendation(riskScenarioId)).compatibleCellCount).toBe(1);

    // A save that names no target leaves the scope alone: only the targets move it.
    await scoped.riskScenarios.updateRiskScenario(riskScenarioId, { name: 'Ransomware on the registry' });
    expect(await codesOf()).toEqual(['personal-data']);
  });

  it('should let the caller narrow the scope, and follow it in the recommendation', async () => {
    const scoped = services.withOrigin(adminOrigin);
    const assetId = await createAsset('Customer portal', [
      BusinessValueCategory_ServicesUnderCommitments,
      BusinessValueCategory_PersonalData,
    ]);

    const riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Ransomware on the portal alone',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [assetId],
      businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_ServicesUnderCommitments)],
    });

    const narrowed = await scoped.lossDrivers.getScenarioDriverRecommendation(riskScenarioId);
    expect(narrowed.compatibleCellCount).toBe(1);

    await scoped.riskScenarios.updateRiskScenario(riskScenarioId, {
      businessValueCategoryIds: [
        deriveSeedId(tenantId, BusinessValueCategory_ServicesUnderCommitments),
        deriveSeedId(tenantId, BusinessValueCategory_PersonalData),
      ],
    });

    const widened = await scoped.lossDrivers.getScenarioDriverRecommendation(riskScenarioId);
    expect(widened.compatibleCellCount).toBe(2);
    expect(widened.recommendations.length).toBeGreaterThan(narrowed.recommendations.length);
  });

  it('should refuse a resource that belongs to another tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const foreignId = deriveSeedId(otherTenantId, BusinessValueCategory_PersonalData);
    const assetId = await createAsset('Customer portal', [BusinessValueCategory_ServicesUnderCommitments]);

    await expect(services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: uuidv7(),
      organizationId,
      name: 'Ransomware on a foreign resource',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [assetId],
      businessValueCategoryIds: [foreignId],
    })).rejects.toThrow();
  });
});
