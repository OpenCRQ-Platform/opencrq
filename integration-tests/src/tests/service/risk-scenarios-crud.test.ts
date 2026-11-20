import type { EventOrigin } from '@app/module';
import { attackOutcomeMitreTechniques, attackOutcomes as attackOutcomesTable, TECHNIQUE_T1003, users } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Risk Scenarios Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let organizationId: string;
  let attackOutcomeId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: organizationId, name: 'Test Organization' },
    ]);

    // Get seeded attack outcomes (auto-created at tenant creation)
    const attackOutcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
    attackOutcomeId = attackOutcomes[0].id;
  });

  it('should create a risk scenario', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id,
      organizationId,
      name: 'Data Breach on CRM',
      description: 'Test scenario description',
      attackOutcomeId,
      primaryAssetIds: [],
    });

    const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
    expect(scenario).toBeTruthy();
    expect(scenario!.name).toBe('Data Breach on CRM');
    expect(scenario!.description).toBe('Test scenario description');
    expect(scenario!.organizationId).toBe(organizationId);
    expect(scenario!.attackOutcomeId).toBe(attackOutcomeId);
    expect(scenario!.primaryAssets).toHaveLength(0);
  });

  it('should list risk scenarios scoped by organization', async () => {
    const org2Id = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: org2Id, name: 'Other Organization' },
    ]);

    const scenario1Id = uuidv7();
    const scenario2Id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: scenario1Id,
      organizationId,
      name: 'Scenario in Org1',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: scenario2Id,
      organizationId: org2Id,
      name: 'Scenario in Org2',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });

    const scenariosInOrg1 = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(organizationId);
    expect(scenariosInOrg1).toHaveLength(1);
    expect(scenariosInOrg1[0].id).toBe(scenario1Id);

    const scenariosInOrg2 = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(org2Id);
    expect(scenariosInOrg2).toHaveLength(1);
    expect(scenariosInOrg2[0].id).toBe(scenario2Id);
  });

  it('should list all risk scenarios without org filter', async () => {
    const scenario1Id = uuidv7();
    const scenario2Id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: scenario1Id,
      organizationId,
      name: 'Scenario 1',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: scenario2Id,
      organizationId,
      name: 'Scenario 2',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });

    const allScenarios = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();
    expect(allScenarios).toHaveLength(2);
  });

  it('should return undefined for non-existent risk scenario', async () => {
    const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(uuidv7());
    expect(scenario).toBeUndefined();
  });

  it('should include joined relations in results', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id,
      organizationId,
      name: 'Scenario with relations',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });

    const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
    expect(scenario).toBeTruthy();
    expect(scenario!.organization).toBeTruthy();
    expect(scenario!.organization!.id).toBe(organizationId);
    expect(scenario!.organization!.name).toBe('Test Organization');
    expect(scenario!.attackOutcome).toBeTruthy();
    expect(scenario!.attackOutcome.id).toBe(attackOutcomeId);
    expect(scenario!.primaryAssets).toHaveLength(0);
  });

  it('should update a risk scenario', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id,
      organizationId,
      name: 'Original Name',
      description: 'Original description',
      attackOutcomeId,
      primaryAssetIds: [],
    });

    await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(id, {
      name: 'Updated Name',
      description: 'Updated description',
    });

    const updated = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
    expect(updated).toBeTruthy();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.description).toBe('Updated description');
    expect(updated!.attackOutcomeId).toBe(attackOutcomeId);
  });

  it('should delete risk scenarios', async () => {
    const id1 = uuidv7();
    const id2 = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: id1,
      organizationId,
      name: 'Scenario 1',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: id2,
      organizationId,
      name: 'Scenario 2',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });

    await services.withOrigin(adminOrigin).riskScenarios.deleteRiskScenarios([id1]);

    const remaining = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(organizationId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(id2);

    const deleted = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id1);
    expect(deleted).toBeUndefined();
  });

  describe('owner', () => {
    const createOwnedScenario = async (ownerId: string | null) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id,
        organizationId,
        name: 'Owned scenario',
        description: null,
        ownerId,
        attackOutcomeId,
        primaryAssetIds: [],
      });
      return id;
    };

    it('should resolve the owner a scenario names on its detail and in the list', async () => {
      const id = await createOwnedScenario(adminUserId);

      const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(scenario!.owner).toMatchObject({ id: adminUserId });

      const [listed] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(organizationId);
      expect(listed.owner).toMatchObject({ id: adminUserId });
    });

    it('should read no owner on a scenario that names none', async () => {
      const id = await createOwnedScenario(null);

      const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(scenario!.ownerId).toBeNull();
      expect(scenario!.owner).toBeNull();
    });

    it('should change and then clear the owner of a scenario', async () => {
      const other = await createTenantUser(services, db, adminOrigin);
      const id = await createOwnedScenario(adminUserId);

      await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(id, { ownerId: other.userId });
      expect((await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id))!.ownerId).toBe(other.userId);

      await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(id, { ownerId: null });
      expect((await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id))!.ownerId).toBeNull();
    });

    const createOtherTenantUser = async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      return createTenantUser(services, db, tenantBOrigin);
    };

    it('should refuse to create a scenario owned by a user of another tenant', async () => {
      const outsider = await createOtherTenantUser();

      await expect(createOwnedScenario(outsider.userId)).rejects.toThrow();
      expect(await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(organizationId)).toHaveLength(0);
    });

    it('should refuse to hand a scenario to a user of another tenant', async () => {
      const outsider = await createOtherTenantUser();
      const id = await createOwnedScenario(adminUserId);

      await expect(services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(id, { ownerId: outsider.userId })).rejects.toThrow();
      expect((await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id))!.ownerId).toBe(adminUserId);
    });

    it.each([null, '', '  '])('should name an owner whose name is %j by their email', async (name) => {
      const owner = await createTenantUser(services, db, adminOrigin);
      await db.update(users).set({ name }).where(eq(users.id, owner.userId));
      const id = await createOwnedScenario(owner.userId);

      const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      const [{ email }] = await db.select({ email: users.email }).from(users).where(eq(users.id, owner.userId));
      expect(scenario!.owner).toEqual({ id: owner.userId, name: email });
    });

    it('should keep a scenario and clear its owner when that user is deleted', async () => {
      const owner = await createTenantUser(services, db, adminOrigin);
      const id = await createOwnedScenario(owner.userId);

      await services.withOrigin(adminOrigin).tenants.removeTenantUser(adminTenantId, owner.userId);
      await services.withOrigin({ type: 'auth' }).users.deleteUser(owner.userId);

      const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(scenario).toBeTruthy();
      expect(scenario!.ownerId).toBeNull();
    });
  });

  describe('primary asset associations', () => {
    let pa1Id: string;
    let pa2Id: string;

    beforeEach(async () => {
      pa1Id = uuidv7();
      pa2Id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: pa1Id, organizationId, name: 'Primary Asset 1', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: pa2Id, organizationId, name: 'Primary Asset 2', description: null, ownerId: null, businessValueCategoryIds: [],
      });
    });

    it('should create a risk scenario with primary assets', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Scenario with assets', description: null,
        attackOutcomeId,
        primaryAssetIds: [pa1Id, pa2Id],
      });

      const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(scenario!.primaryAssets).toHaveLength(2);
      const assetIds = scenario!.primaryAssets.map((a) => a.id).sort();
      expect(assetIds).toEqual([pa1Id, pa2Id].sort());
    });

    it('should update to add primary assets', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Scenario empty assets', description: null,
        attackOutcomeId,
        primaryAssetIds: [],
      });

      await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(id, {
        primaryAssetIds: [pa1Id],
      });

      const updated = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(updated!.primaryAssets).toHaveLength(1);
      expect(updated!.primaryAssets[0].id).toBe(pa1Id);
    });

    it('should update to replace primary assets', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Scenario replace assets', description: null,
        attackOutcomeId,
        primaryAssetIds: [pa1Id],
      });

      await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(id, {
        primaryAssetIds: [pa2Id],
      });

      const updated = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(updated!.primaryAssets).toHaveLength(1);
      expect(updated!.primaryAssets[0].id).toBe(pa2Id);
    });

    it('should update to remove all primary assets', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Scenario clear assets', description: null,
        attackOutcomeId,
        primaryAssetIds: [pa1Id],
      });

      await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(id, {
        primaryAssetIds: [],
      });

      const updated = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(updated!.primaryAssets).toHaveLength(0);
    });

    it('should cascade delete junction rows when primary asset is deleted', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Scenario cascade test', description: null,
        attackOutcomeId,
        primaryAssetIds: [pa1Id],
      });

      await services.withOrigin(adminOrigin).primaryAssets.deletePrimaryAssets([pa1Id]);

      const scenario = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(scenario).toBeTruthy();
      expect(scenario!.primaryAssets).toHaveLength(0);
    });
  });

  describe('getControlCapabilitiesForRiskScenario mitreTechniqueIds mapping', () => {
    it('should include the queried technique in each matched capability\'s mitreTechniqueIds, and not resolve for another tenant', async () => {
      const outcomeId = uuidv7();
      await db.insert(attackOutcomesTable).values([{
        id: outcomeId, tenantId: adminTenantId, name: 'Outcome with T1003', description: null, referenceDwellDays: 7,
      }]);
      await db.insert(attackOutcomeMitreTechniques).values([{
        attackOutcomeId: outcomeId, mitreTechniqueId: TECHNIQUE_T1003, category: 'signature' as const,
      }]);

      const scenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenarioId, organizationId, name: 'Scenario with T1003', description: null,
        attackOutcomeId: outcomeId, primaryAssetIds: [],
      });
      await recomputeAttackOutcomeMixtures(services, adminTenantId);

      const capabilities = await services.withOrigin(adminOrigin).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.every((c) => c.mitreTechniqueIds.includes(TECHNIQUE_T1003))).toBe(true);

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const capabilitiesForTenantB = await services.withOrigin(tenantBOrigin).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      expect(capabilitiesForTenantB).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;

    beforeEach(async () => {
      const tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should not list risk scenarios from another tenant', async () => {
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: uuidv7(),
        organizationId,
        name: 'Tenant A Scenario',
        description: null,
        attackOutcomeId,
        primaryAssetIds: [],
      });

      const scenarios = await services.withOrigin(tenantBOrigin).riskScenarios.getRiskScenariosOverview();
      expect(scenarios).toHaveLength(0);
    });

    it('should not get a risk scenario from another tenant by ID', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id,
        organizationId,
        name: 'Hidden Scenario',
        description: null,
        attackOutcomeId,
        primaryAssetIds: [],
      });

      const result = await services.withOrigin(tenantBOrigin).riskScenarios.getRiskScenario(id);
      expect(result).toBeUndefined();
    });

    it('should not update a risk scenario from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id,
        organizationId,
        name: 'Original Name',
        description: null,
        attackOutcomeId,
        primaryAssetIds: [],
      });

      await services.withOrigin(tenantBOrigin).riskScenarios.updateRiskScenario(id, {
        name: 'Hacked Name',
      });

      // ProtectedDB filters via WHERE tenant_id: cross-tenant update is a silent no-op (0 rows affected)
      const result = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(result!.name).toBe('Original Name');
    });

    it('should not delete a risk scenario from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id,
        organizationId,
        name: 'Protected Scenario',
        description: null,
        attackOutcomeId,
        primaryAssetIds: [],
      });

      await services.withOrigin(tenantBOrigin).riskScenarios.deleteRiskScenarios([id]);

      // ProtectedDB filters via WHERE tenant_id: cross-tenant delete is a silent no-op (0 rows affected)
      const result = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenario(id);
      expect(result).toBeTruthy();
    });

    it('should not return derived supporting assets for another tenant\'s scenario', async () => {
      const paId = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: paId, organizationId, name: 'Tenant A PA', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      const sa1Id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: sa1Id, name: 'Tenant A SA', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: sa1Id, primaryAssetId: paId,
      }]);

      const scenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenarioId, organizationId, name: 'Tenant A scenario with assets', description: null,
        attackOutcomeId,
        primaryAssetIds: [paId],
      });

      const derived = await services.withOrigin(tenantBOrigin).riskScenarios.getDerivedSupportingAssets(scenarioId);
      expect(derived).toBeUndefined();
    });

    it('should not return the dependency graph of a scenario of another tenant', async () => {
      const paId = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: paId, organizationId, name: 'Tenant A PA', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      const saId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: saId, name: 'Tenant A SA', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId,
      }]);
      const scenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenarioId, organizationId, name: 'Tenant A scenario with assets', description: null,
        attackOutcomeId,
        primaryAssetIds: [paId],
      });

      const graph = await services.withOrigin(tenantBOrigin).riskScenarios.getDependencyGraph(scenarioId, 3);
      expect(graph).toEqual({ primaryAssets: [], attackOutcome: null, assets: [], links: [], truncated: [], hiddenAssetCount: 0 });
    });
  });
});
