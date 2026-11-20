import type { EventOrigin, LossActivationCell, LossDriverReference } from '@app/module';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_Ransomware,
  BusinessValueCategory_ServicesUnderCommitments,
  deriveSeedId,
  LOSS_ACTIVATION_MATRIX,
  LOSS_DRIVERS,
  LossCategory_LegalRegulatoryContractual,
  LossDriver_CompetitiveAdvantageErosion,
  LossDriver_ExtortionPayment,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_LitigationDefense,
  LossDriver_NotificationCallHandling,
  LossDriver_SystemDataRestoration,
  lossDrivers as lossDriversTable,
  scenarioLossEstimates,
  seedLossDrivers,
} from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * The loss model is a closed catalog: it is provisioned with the tenant and has no write endpoint,
 * so this suite reads it rather than authoring it.
 */
describe('Loss Drivers Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  it('should provision the nineteen catalog drivers with the tenant', async () => {
    const drivers = await services.withOrigin(adminOrigin).lossDrivers.getLossDrivers();

    expect(drivers).toHaveLength(19);
    expect(drivers.map((driver) => driver.id).toSorted()).toEqual(
      LOSS_DRIVERS.map((driver) => deriveSeedId(tenantId, driver.id)).toSorted(),
    );
  });

  it('should carry the modelling metadata of every driver', async () => {
    const drivers = await services.withOrigin(adminOrigin).lossDrivers.getLossDrivers();

    for (const driver of drivers) {
      expect(driver.name).toBeTruthy();
      expect(driver.description).toBeTruthy();
      expect(['strong', 'weak', 'none']).toContain(driver.dwellSensitivity);
      expect(driver.scalingVariable).toBeTruthy();
    }

    // Pinned on the reference model: incident response scales with the dwell, the ransom does not.
    const byCatalogId = (catalogId: string) =>
      drivers.find((driver) => driver.id === deriveSeedId(tenantId, catalogId))!;
    expect(byCatalogId(LossDriver_ForensicsIncidentManagement).dwellSensitivity).toBe('strong');
    expect(byCatalogId(LossDriver_ExtortionPayment).dwellSensitivity).toBe('none');
  });

  it('should join every driver onto the loss category the catalog gives it', async () => {
    const drivers = await services.withOrigin(adminOrigin).lossDrivers.getLossDrivers();

    for (const driver of drivers) {
      const catalogEntry = LOSS_DRIVERS.find((entry) => deriveSeedId(tenantId, entry.id) === driver.id)!;
      expect(driver.lossCategoryId).toBe(deriveSeedId(tenantId, catalogEntry.lossCategoryId));
      expect(driver.lossCategoryName).toBeTruthy();
      expect(driver.lossCategoryDisplayOrder).toBeGreaterThan(0);
    }

    expect(new Set(drivers.map((driver) => driver.lossCategoryId)).size).toBe(8);
  });

  it('should order the catalog by loss category then driver rank', async () => {
    const drivers = await services.withOrigin(adminOrigin).lossDrivers.getLossDrivers();

    const ordering = drivers.map((driver) => [driver.lossCategoryDisplayOrder, driver.displayOrder] as const);
    expect(ordering).toEqual(ordering.toSorted((left, right) => left[0] - right[0] || left[1] - right[1]));
  });

  it('should get a single loss driver by id', async () => {
    const id = deriveSeedId(tenantId, LossDriver_LitigationDefense);

    const driver = await services.withOrigin(adminOrigin).lossDrivers.getLossDriver(id);

    expect(driver).toBeTruthy();
    expect(driver!.id).toBe(id);
    expect(driver!.name).toBe('Litigation & proceedings defense');
    expect(driver!.lossCategoryId).toBe(deriveSeedId(tenantId, LossCategory_LegalRegulatoryContractual));
  });

  it('should return undefined for a non-existent loss driver', async () => {
    const driver = await services.withOrigin(adminOrigin).lossDrivers.getLossDriver('00000000-0000-0000-0000-000000000000');

    expect(driver).toBeUndefined();
  });

  it('should isolate the catalog per tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    const mine = await services.withOrigin(adminOrigin).lossDrivers.getLossDrivers();
    const theirs = await services.withOrigin(otherOrigin).lossDrivers.getLossDrivers();

    expect(theirs).toHaveLength(19);
    // Same catalog, disjoint rows: the identifiers are derived per tenant.
    expect(mine.map((driver) => driver.name).toSorted()).toEqual(theirs.map((driver) => driver.name).toSorted());
    expect(mine.map((driver) => driver.id).some((id) => theirs.map((driver) => driver.id).includes(id))).toBe(false);

    const crossTenant = await services.withOrigin(adminOrigin).lossDrivers.getLossDriver(theirs.at(0)!.id);
    expect(crossTenant).toBeUndefined();
  });
});

const DRIVERS_DATA_PATH = '../../../../module/src/modules/loss-drivers/data/loss-drivers-data';

/**
 * Re-seeds the tenant against a catalog the shipped reference does not contain, which is the only
 * way to observe what a future edit of the reference would do. A plain `vi.mock` factory does not
 * reach the seeder's own static import of the module's data, so the module graph is rebuilt around
 * the override and the seeder is re-imported from it.
 */
const seedWithCatalog = async (drivers: ReadonlyArray<LossDriverReference>): Promise<void> => {
  vi.resetModules();
  vi.doMock(DRIVERS_DATA_PATH, async () => ({
    ...(await vi.importActual<object>(DRIVERS_DATA_PATH)),
    LOSS_DRIVERS: drivers,
  }));
  const overridden = await import('@app/module');
  await overridden.seedLossDrivers(db);
};

/** xmin is the row version: it only moves when Postgres actually rewrites the row. */
const driverVersions = async (tenantId: string): Promise<Map<string, string>> => {
  const result = await db.execute(
    sql`SELECT id::text AS id, xmin::text AS v FROM loss_drivers WHERE tenant_id = ${tenantId}`,
  );
  return new Map(result.rows.map((row) => [String(row.id), String(row.v)]));
};

/** Same row-version reading over the activation rows, keyed by the triple. */
const activationVersions = async (tenantId: string): Promise<Map<string, string>> => {
  const result = await db.execute(sql`
    SELECT lda.attack_outcome_id::text || '/' || lda.business_value_category_id::text || '/' || lda.loss_driver_id::text AS id,
           lda.xmin::text AS v
    FROM loss_driver_activations lda
    JOIN attack_outcomes ao ON ao.id = lda.attack_outcome_id
    WHERE ao.tenant_id = ${tenantId}
  `);
  return new Map(result.rows.map((row) => [String(row.id), String(row.v)]));
};

const ACTIVATION_MATRIX_PATH = '../../../../module/src/modules/loss-drivers/data/loss-activation-matrix';

/** Re-seeds the tenant against an activation matrix the shipped reference does not contain. */
const seedWithActivationMatrix = async (matrix: ReadonlyArray<LossActivationCell>): Promise<void> => {
  vi.resetModules();
  vi.doMock(ACTIVATION_MATRIX_PATH, async () => ({
    ...(await vi.importActual<object>(ACTIVATION_MATRIX_PATH)),
    LOSS_ACTIVATION_MATRIX: matrix,
  }));
  const overridden = await import('@app/module');
  await overridden.seedLossDrivers(db);
};

/** The module owns its catalog end to end: the boot seeder reprovisions it, nothing else does. */
describe('Loss Drivers re-seed', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  afterEach(() => {
    vi.doUnmock(DRIVERS_DATA_PATH);
    vi.doUnmock(ACTIVATION_MATRIX_PATH);
    vi.resetModules();
  });

  it('should rewrite nothing when the catalog has not moved', async () => {
    const before = await driverVersions(tenantId);
    expect(before.size).toBe(19);

    await seedLossDrivers(db);
    await seedLossDrivers(db);

    // Two reboots on an unchanged reference: an upsert that rewrote every row on each boot would
    // churn the whole catalog and, worse, hide a real divergence in the noise.
    expect(await driverVersions(tenantId)).toEqual(before);
  });

  it('should rewrite only the row that diverged in the database', async () => {
    const targetId = deriveSeedId(tenantId, LossDriver_SystemDataRestoration);
    const catalogName = LOSS_DRIVERS.find((driver) => driver.id === LossDriver_SystemDataRestoration)!.name;

    await db.update(lossDriversTable).set({ name: 'Locally edited driver' }).where(eq(lossDriversTable.id, targetId));
    const before = await driverVersions(tenantId);

    await seedLossDrivers(db);

    const after = await driverVersions(tenantId);
    expect(after.get(targetId)).not.toBe(before.get(targetId));
    for (const [id, version] of before) {
      if (id !== targetId) {
        expect(after.get(id)).toBe(version);
      }
    }

    const restored = await db.select().from(lossDriversTable).where(eq(lossDriversTable.id, targetId));
    expect(restored[0].name).toBe(catalogName);
  });

  it('should prune an entry removed from the reference and leave the survivors alone', async () => {
    const removedRowId = deriveSeedId(tenantId, LossDriver_CompetitiveAdvantageErosion);
    const before = await driverVersions(tenantId);

    await seedWithCatalog(LOSS_DRIVERS.filter((driver) => driver.id !== LossDriver_CompetitiveAdvantageErosion));

    const survivors = await db.select().from(lossDriversTable).where(eq(lossDriversTable.tenantId, tenantId));
    expect(survivors).toHaveLength(18);
    expect(survivors.some((row) => row.id === removedRowId)).toBe(false);

    const after = await driverVersions(tenantId);
    for (const [id, version] of before) {
      if (id !== removedRowId) {
        expect(after.get(id)).toBe(version);
      }
    }
  });

  it('should keep the identity of an entry whose name was rewritten', async () => {
    const rowId = deriveSeedId(tenantId, LossDriver_NotificationCallHandling);

    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Re-seed Org' }]);
    const riskScenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Priced against a driver that gets relabelled',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_DataBreachResale),
      primaryAssetIds: [],
    });
    await services.withOrigin(adminOrigin).scenarioLossEstimates.upsertScenarioLossEstimates(riskScenarioId, [
      { lossDriverId: rowId, action: 'set', minValue: 10_000, likelyValue: 20_000, maxValue: 40_000 },
    ], { maxUpdatedAt: null, rowCount: 0 });

    await seedWithCatalog(LOSS_DRIVERS.map((driver) => (driver.id === LossDriver_NotificationCallHandling
      ? { ...driver, name: 'Notification & individual care' }
      : driver)));

    // The name is not identity: the id is derived from the catalog entry's permanent UUID, so a
    // relabelled entry keeps its row and every euro amount saved against it.
    const reseeded = await db.select().from(lossDriversTable).where(eq(lossDriversTable.id, rowId));
    expect(reseeded).toHaveLength(1);
    expect(reseeded[0].name).toBe('Notification & individual care');

    const estimates = await db.select().from(scenarioLossEstimates)
      .where(eq(scenarioLossEstimates.riskScenarioId, riskScenarioId));
    expect(estimates).toHaveLength(1);
    expect(estimates[0].lossDriverId).toBe(rowId);
    expect(estimates[0].likelyValue).toBe(20_000);
  });
});

describe('Loss activation matrix re-seed', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  afterEach(() => {
    vi.doUnmock(ACTIVATION_MATRIX_PATH);
    vi.resetModules();
  });

  it('should rewrite nothing when the matrix has not moved', async () => {
    const before = await activationVersions(tenantId);
    expect(before.size).toBe(255);

    await seedLossDrivers(db);
    await seedLossDrivers(db);

    // An insert that touched every row on each boot would churn the whole matrix and drown a real
    // divergence in the noise.
    expect(await activationVersions(tenantId)).toEqual(before);
  });

  it('should remove only the rows of a cell that left the source', async () => {
    const removed = LOSS_ACTIVATION_MATRIX.find((cell) => cell.attackOutcomeId === AttackOutcome_Ransomware
      && cell.businessValueCategoryId === BusinessValueCategory_ServicesUnderCommitments)!;
    const before = await activationVersions(tenantId);

    await seedWithActivationMatrix(LOSS_ACTIVATION_MATRIX.filter((cell) => cell !== removed));

    const after = await activationVersions(tenantId);
    expect(after.size).toBe(before.size - removed.lossDriverIds.length);

    const removedPrefix = `${deriveSeedId(tenantId, removed.attackOutcomeId)}/${deriveSeedId(tenantId, removed.businessValueCategoryId)}/`;
    for (const [key, version] of before) {
      if (key.startsWith(removedPrefix)) {
        expect(after.has(key)).toBe(false);
      } else {
        expect(after.get(key)).toBe(version);
      }
    }
  });
});
