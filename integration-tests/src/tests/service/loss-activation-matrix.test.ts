import type { EventOrigin } from '@app/module';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  BusinessValueCategory_DataEntrustedByOthers,
  BusinessValueCategory_PaymentCardData,
  BusinessValueCategory_PersonalData,
  BusinessValueCategory_PhysicalAssetsAndFacilities,
  BusinessValueCategory_ServicesUnderCommitments,
  deriveSeedId,
  LOSS_ACTIVATION_MATRIX,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_HardwareReplacement,
  lossDriverActivations,
  seedLossDrivers,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const CELL_COUNT = 35;
const ACTIVATION_COUNT = 255;

/** Counts the tenant's activation rows and the distinct pairs they cover. */
const activationShape = async (tenantId: string) => {
  const result = await db.execute<{ rows: string, pairs: string }>(sql`
    SELECT count(*) AS rows, count(DISTINCT (lda.attack_outcome_id, lda.business_value_category_id)) AS pairs
    FROM loss_driver_activations lda
    JOIN attack_outcomes ao ON ao.id = lda.attack_outcome_id
    WHERE ao.tenant_id = ${tenantId}
  `);
  return { rows: Number(result.rows[0].rows), pairs: Number(result.rows[0].pairs) };
};

describe('Loss activation matrix seeding', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('should provision 255 activation rows over 35 pairs with the tenant', async () => {
    // Tenant creation is the first of the two paths that build these rows. A regression in the
    // module import order would leave this path intact and break the boot re-seed below, so both
    // are asserted.
    expect(await activationShape(tenantId)).toEqual({ rows: ACTIVATION_COUNT, pairs: CELL_COUNT });
  });

  it('should hold the same 255 rows after a boot re-seed', async () => {
    await seedLossDrivers(db);

    expect(await activationShape(tenantId)).toEqual({ rows: ACTIVATION_COUNT, pairs: CELL_COUNT });
  });

  it('should rebuild a row deleted by hand and prune one that never belonged', async () => {
    const outcomeId = deriveSeedId(tenantId, AttackOutcome_Ransomware);
    const categoryId = deriveSeedId(tenantId, BusinessValueCategory_ServicesUnderCommitments);
    const driverId = deriveSeedId(tenantId, LossDriver_ForensicsIncidentManagement);

    await db.execute(sql`DELETE FROM loss_driver_activations
      WHERE attack_outcome_id = ${outcomeId} AND business_value_category_id = ${categoryId} AND loss_driver_id = ${driverId}`);
    // Hardware replacement on a ransomware pairing: not in the matrix, so the prune must take it
    // back out.
    await db.insert(lossDriverActivations).values({
      attackOutcomeId: outcomeId,
      businessValueCategoryId: deriveSeedId(tenantId, BusinessValueCategory_PhysicalAssetsAndFacilities),
      lossDriverId: deriveSeedId(tenantId, LossDriver_HardwareReplacement),
    });

    await seedLossDrivers(db);

    expect(await activationShape(tenantId)).toEqual({ rows: ACTIVATION_COUNT, pairs: CELL_COUNT });
  });
});

describe('Loss activation matrix structural validations', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  it('V1: should answer compatibility from row existence, with no second store', async () => {
    const scoped = services.withOrigin(adminOrigin);

    const ransomwareCategories = await scoped.lossDrivers.getCompatibleBusinessValueCategoryIds(
      deriveSeedId(tenantId, AttackOutcome_Ransomware),
    );
    const fraudCategories = await scoped.lossDrivers.getCompatibleBusinessValueCategoryIds(
      deriveSeedId(tenantId, AttackOutcome_FinancialFraudFundsTheft),
    );

    expect(ransomwareCategories).toHaveLength(7);
    expect(ransomwareCategories).toContain(deriveSeedId(tenantId, BusinessValueCategory_PaymentCardData));
    // Financial fraud only reaches the two custody resources and the regulated add-on. Personal
    // data is not one of them.
    expect(fraudCategories).toHaveLength(3);
    expect(fraudCategories).not.toContain(deriveSeedId(tenantId, BusinessValueCategory_PersonalData));

    // Nothing else in the schema stores compatibility: no column carries the word, and the only
    // table naming it is the activation table itself.
    const columns = await db.execute<{ table_name: string, column_name: string }>(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_name LIKE '%compatib%' OR column_name LIKE '%contingen%')
    `);
    expect(columns.rows).toEqual([]);
  });

  it('V2: should activate at least one driver on every pair present in the table', async () => {
    const emptyPairs = await db.execute<{ count: string }>(sql`
      SELECT count(*) AS count FROM (
        SELECT lda.attack_outcome_id, lda.business_value_category_id
        FROM loss_driver_activations lda
        JOIN attack_outcomes ao ON ao.id = lda.attack_outcome_id
        WHERE ao.tenant_id = ${tenantId}
        GROUP BY 1, 2
        HAVING count(lda.loss_driver_id) = 0
      ) empty_pairs
    `);

    expect(Number(emptyPairs.rows[0].count)).toBe(0);
  });

  it('V3: should return a driver once even when two compatible cells share it', async () => {
    const scoped = services.withOrigin(adminOrigin);
    const organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Union Org' }]);

    // Two assets, two categories, both compatible with ransomware and both activating forensics.
    const firstAssetId = uuidv7();
    const secondAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: firstAssetId,
      organizationId,
      name: 'Customer portal',
      description: null,
      ownerId: null,
      businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_ServicesUnderCommitments)],
    });
    await scoped.primaryAssets.createPrimaryAsset({
      id: secondAssetId,
      organizationId,
      name: 'Client dossiers',
      description: null,
      ownerId: null,
      businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_DataEntrustedByOthers)],
    });

    const riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Ransomware on two targets',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [firstAssetId, secondAssetId],
    });

    const { compatibleCellCount, recommendations } = await scoped.lossDrivers.getScenarioDriverRecommendation(riskScenarioId);

    expect(compatibleCellCount).toBe(2);
    expect(new Set(recommendations.map((entry) => entry.lossDriverId)).size).toBe(recommendations.length);

    const forensics = recommendations.find((entry) => entry.lossDriverId === deriveSeedId(tenantId, LossDriver_ForensicsIncidentManagement))!;
    expect(forensics).toBeTruthy();
    // Once in the list, but carrying both cells that justify it, names joined.
    expect(forensics.viaCells).toHaveLength(2);
    // The stable `code` behind each tenant row, which is what callers key on: a display name can be
    // renamed, and a consumer matching on one would go quietly dead the day it is.
    expect(forensics.viaCells.map((cell) => cell.businessValueCategoryCode).toSorted())
      .toEqual(['data-entrusted-by-others', 'services-under-commitments']);
    for (const cell of forensics.viaCells) {
      expect(cell.attackOutcomeName).toBe('Ransomware');
    }

    // The union of the commitments and entrusted columns under ransomware is twelve distinct drivers.
    expect(recommendations).toHaveLength(12);
  });
});

describe('Scenario driver recommendation edge cases', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Edge Org' }]);
  });

  const createScenario = async (attackOutcomeCatalogId: string, primaryAssetIds: Array<string>) => {
    const riskScenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: `Scenario ${riskScenarioId.substring(0, 8)}`,
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, attackOutcomeCatalogId),
      primaryAssetIds,
    });
    return riskScenarioId;
  };

  const createAsset = async (name: string, categoryCatalogIds: Array<string>) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id,
      organizationId,
      name,
      description: null,
      ownerId: null,
      businessValueCategoryIds: categoryCatalogIds.map((catalogId) => deriveSeedId(tenantId, catalogId)),
    });
    return id;
  };

  it('should recommend nothing, and say so through the cell count, for an incompatible combination', async () => {
    const assetId = await createAsset('Industrial line', [BusinessValueCategory_PhysicalAssetsAndFacilities]);
    // Data breach & resale reaches the data resources, never physical assets and facilities.
    const riskScenarioId = await createScenario(AttackOutcome_DataBreachResale, [assetId]);

    const result = await services.withOrigin(adminOrigin).lossDrivers.getScenarioDriverRecommendation(riskScenarioId);

    expect(result).toEqual({ compatibleCellCount: 0, recommendations: [] });
  });

  it('should not crash on a scenario with no primary asset', async () => {
    const riskScenarioId = await createScenario(AttackOutcome_Ransomware, []);

    const result = await services.withOrigin(adminOrigin).lossDrivers.getScenarioDriverRecommendation(riskScenarioId);

    // Same shape as the incompatible case: only the count tells the two apart on the surface.
    expect(result).toEqual({ compatibleCellCount: 0, recommendations: [] });
  });

  it('should cover a multi-asset multi-category scenario across all its cells', async () => {
    const cardsAssetId = await createAsset('Card vault', [BusinessValueCategory_PaymentCardData, BusinessValueCategory_PersonalData]);
    const portalAssetId = await createAsset('Customer portal', [BusinessValueCategory_ServicesUnderCommitments]);
    const riskScenarioId = await createScenario(AttackOutcome_Ransomware, [cardsAssetId, portalAssetId]);

    const { compatibleCellCount, recommendations } = await services.withOrigin(adminOrigin)
      .lossDrivers.getScenarioDriverRecommendation(riskScenarioId);

    expect(compatibleCellCount).toBe(3);

    const expected = new Set(LOSS_ACTIVATION_MATRIX
      .filter((cell) => cell.attackOutcomeId === AttackOutcome_Ransomware
        && [
          BusinessValueCategory_PaymentCardData,
          BusinessValueCategory_PersonalData,
          BusinessValueCategory_ServicesUnderCommitments,
        ].includes(cell.businessValueCategoryId))
      .flatMap((cell) => cell.lossDriverIds)
      .map((catalogId) => deriveSeedId(tenantId, catalogId)));

    expect(recommendations.map((entry) => entry.lossDriverId).toSorted()).toEqual([...expected].toSorted());
  });
});

describe('Loss driver activation grid read', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  it('should flag the destructive-attack pairings that replace equipment against all 35 compatible cells', async () => {
    const cells = await services.withOrigin(adminOrigin)
      .lossDrivers.getLossDriverActivations(deriveSeedId(tenantId, LossDriver_HardwareReplacement));

    expect(cells).toHaveLength(CELL_COUNT);
    const applying = cells.filter((cell) => cell.applies);
    expect(applying.map((cell) => cell.businessValueCategoryCode).toSorted())
      .toEqual(['physical-assets-and-facilities', 'services-under-commitments']);
    for (const cell of applying) {
      expect(cell.attackOutcomeName).toBe('Destructive Attack');
    }
  });

  it('should flag every priced cell for a driver the model calls everywhere', async () => {
    const cells = await services.withOrigin(adminOrigin)
      .lossDrivers.getLossDriverActivations(deriveSeedId(tenantId, LossDriver_ForensicsIncidentManagement));

    expect(cells).toHaveLength(CELL_COUNT);
    // The regulated resource adds a fine to whatever else is ticked and prices nothing on its own,
    // so it is the one column incident response never reaches.
    const missing = cells.filter((cell) => !cell.applies);
    expect(new Set(missing.map((cell) => cell.businessValueCategoryCode))).toEqual(new Set(['regulated-function-or-data']));
    expect(missing).toHaveLength(7);
  });
});
