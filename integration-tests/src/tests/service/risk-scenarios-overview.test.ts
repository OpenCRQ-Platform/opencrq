import type { EventOrigin, ScenarioReadiness } from '@app/module';
import { crqIndicatorRuns, deriveSeedId, LIFELINE_SAMPLES, LossDriver_ForensicsIncidentManagement, SCENARIO_READINESS_STATUSES, scenarioLossEstimates, tefEstimates } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
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

  describe('getRiskScenariosOverview primary assets aggregation', () => {
    it('should attach the correct primary assets per scenario, with and without organizationId, without leaking another organization\'s assets', async () => {
      const org2Id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: org2Id, name: 'Other Organization' },
      ]);

      const pa1Id = uuidv7();
      const pa2Id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: pa1Id, organizationId, name: 'Org1 Asset', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: pa2Id, organizationId: org2Id, name: 'Org2 Asset', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      const scenario1Id = uuidv7();
      const scenario2Id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenario1Id, organizationId, name: 'Scenario Org1', description: null,
        attackOutcomeId, primaryAssetIds: [pa1Id],
      });
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenario2Id, organizationId: org2Id, name: 'Scenario Org2', description: null,
        attackOutcomeId, primaryAssetIds: [pa2Id],
      });

      const scoped = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(organizationId);
      expect(scoped).toHaveLength(1);
      expect(scoped[0].primaryAssets.map((a) => a.id)).toEqual([pa1Id]);

      const all = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();
      expect(all).toHaveLength(2);
      const byId = new Map(all.map((s) => [s.id, s]));
      expect(byId.get(scenario1Id)!.primaryAssets.map((a) => a.id)).toEqual([pa1Id]);
      expect(byId.get(scenario2Id)!.primaryAssets.map((a) => a.id)).toEqual([pa2Id]);
    });
  });

  describe('getRiskScenariosOverview', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

    const insertRun = async (riskScenarioId: string, createdAt: Date, ale: number | null, id: string = uuidv7()): Promise<string> => {
      await db.insert(crqIndicatorRuns).values({
        id,
        riskScenarioId,
        createdAt,
        iterations: 1000,
        vulnerabilityP5: 0.1,
        vulnerabilityP50: 0.2,
        vulnerabilityP95: 0.3,
        lefMean: 2,
        aleP10: ale === null ? null : ale * 0.5,
        aleMean: ale,
        aleP90: ale === null ? null : ale * 2,
        techniqueCount: 10,
        coveredTechniqueCount: 4,
      });
      return id;
    };

    const createScenarioNamed = async (name: string, orgId: string = organizationId): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id,
        organizationId: orgId,
        name,
        description: null,
        attackOutcomeId,
        primaryAssetIds: [],
      });
      return id;
    };

    const fillLossDrivers = async (riskScenarioId: string) => {
      await services.withOrigin(adminOrigin).scenarioLossEstimates.upsertScenarioLossEstimates(riskScenarioId, [{
        lossDriverId: deriveSeedId(adminTenantId, LossDriver_ForensicsIncidentManagement),
        action: 'set',
        minValue: 100_000,
        likelyValue: 400_000,
        maxValue: 900_000,
      }], { maxUpdatedAt: null, rowCount: 0 });
    };

    // A scenario starts in auto mode, where the frequency is read from the estimate: the manual
    // triplet only counts once the analyst has taken the mode back.
    const fillManualInputs = async (riskScenarioId: string) => {
      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'manual', adminTenantId);
      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({
        riskScenarioId, min: 1, likely: 2, max: 4,
      });
      await fillLossDrivers(riskScenarioId);
    };

    it('should report the latest run and the change across its lifeline', async () => {
      const scenarioId = await createScenarioNamed('Quantified scenario');
      await insertRun(scenarioId, daysAgo(30), 100_000);
      await insertRun(scenarioId, daysAgo(1), 150_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.latestRun).toMatchObject({
        aleP10: 75_000,
        aleMean: 150_000,
        aleP90: 300_000,
        techniqueCount: 10,
        coveredTechniqueCount: 4,
      });
      expect(row.changeOverLifeline).toEqual({ delta: 50_000, deltaPct: 0.5, spanDays: 29 });
    });

    it('should measure the change across the whole lifeline, not against the previous run', async () => {
      const scenarioId = await createScenarioNamed('Scenario with three runs');
      await insertRun(scenarioId, daysAgo(60), 900_000);
      await insertRun(scenarioId, daysAgo(30), 100_000);
      await insertRun(scenarioId, daysAgo(1), 150_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.changeOverLifeline).toMatchObject({ delta: -750_000, spanDays: 59 });
    });

    it('should report no change for a scenario with a single run', async () => {
      const scenarioId = await createScenarioNamed('Scenario simulated once');
      await insertRun(scenarioId, daysAgo(1), 150_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.changeOverLifeline).toBeNull();
    });

    it('should carry the exposure lifeline oldest first, with its p10 to p90 band', async () => {
      const scenarioId = await createScenarioNamed('Scenario with history');
      const oldest = daysAgo(30);
      await insertRun(scenarioId, oldest, 100_000);
      await insertRun(scenarioId, daysAgo(2), 150_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.lifeline.map((point) => point.aleMean)).toEqual([100_000, 150_000]);
      expect(row.lifeline[0]).toMatchObject({ at: oldest, aleP10: 50_000, aleP90: 200_000 });
    });

    it('should leave out lifeline runs beyond the window or with no mean', async () => {
      const scenarioId = await createScenarioNamed('Scenario with a long past');
      await insertRun(scenarioId, daysAgo(100), 999_000);
      await insertRun(scenarioId, daysAgo(20), null);
      await insertRun(scenarioId, daysAgo(2), 150_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.lifeline.map((point) => point.aleMean)).toEqual([150_000]);
    });

    it('should draw a scenario last quantified before the window as its run in force', async () => {
      const scenarioId = await createScenarioNamed('Scenario left alone');
      const at = daysAgo(120);
      await insertRun(scenarioId, daysAgo(150), 999_000);
      await insertRun(scenarioId, at, 300_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.lifeline).toEqual([expect.objectContaining({ at, aleMean: 300_000 })]);
      expect(row.changeOverLifeline).toBeNull();
    });

    it('should draw a burst of identical runs as the last point only', async () => {
      const scenarioId = await createScenarioNamed('Scenario re-priced in a burst');
      for (const age of [80, 60, 40, 20]) {
        await insertRun(scenarioId, daysAgo(age), age * 1_000);
      }
      for (let minutes = 50; minutes >= 1; minutes--) {
        await insertRun(scenarioId, new Date(Date.now() - minutes * 60_000), 10_000);
      }

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.lifeline.map((point) => point.aleMean)).toEqual([80_000, 60_000, 40_000, 20_000, 10_000]);
      expect(row.changeOverLifeline).toMatchObject({ delta: -70_000, spanDays: 80 });
    });

    it('should read at most one run per instant, from the first run of the window to the latest', async () => {
      const scenarioId = await createScenarioNamed('Scenario simulated every day');
      for (let age = 120; age >= 1; age--) {
        await insertRun(scenarioId, daysAgo(age), age * 1_000);
      }

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.lifeline).toHaveLength(LIFELINE_SAMPLES);
      expect(row.lifeline[0].aleMean).toBe(89_000);
      expect(row.lifeline.at(-1)?.aleMean).toBe(1_000);
      expect(row.changeOverLifeline).toMatchObject({ delta: -88_000, spanDays: 88 });
    });

    it('should read the run with the greater id as the latest when two share a timestamp', async () => {
      const scenarioId = await createScenarioNamed('Runs written together');
      const at = daysAgo(1);
      const [lowerId, greaterId] = [uuidv7(), uuidv7()].toSorted();
      // The greater id goes in first, so insertion order points the other way.
      await insertRun(scenarioId, at, 200_000, greaterId);
      await insertRun(scenarioId, at, 100_000, lowerId);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.latestRun?.runId).toBe(greaterId);
    });

    it('should draw runs sharing a timestamp as the one with the greater id', async () => {
      const scenarioId = await createScenarioNamed('Lifeline written together');
      const at = daysAgo(1);
      const [lowerId, greaterId] = [uuidv7(), uuidv7()].toSorted();
      await insertRun(scenarioId, at, 200_000, greaterId);
      await insertRun(scenarioId, at, 100_000, lowerId);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.lifeline.map((point) => point.aleMean)).toEqual([200_000]);
      expect(row.latestRun?.aleMean).toBe(200_000);
    });

    it('should carry a latest run but no lifeline when no run produced a mean', async () => {
      const scenarioId = await createScenarioNamed('Never quantified');
      await insertRun(scenarioId, daysAgo(10), null);
      await insertRun(scenarioId, daysAgo(2), null);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.latestRun).toMatchObject({ aleMean: null });
      expect(row.lifeline).toEqual([]);
      expect(row.changeOverLifeline).toBeNull();
    });

    it('should not count a loss estimate with an out-of-order triple as pricing', async () => {
      const scenarioId = await createScenarioNamed('Inverted estimate');
      await db.insert(scenarioLossEstimates).values({
        id: uuidv7(),
        riskScenarioId: scenarioId,
        lossDriverId: deriveSeedId(adminTenantId, LossDriver_ForensicsIncidentManagement),
        minValue: 500_000,
        likelyValue: 100_000,
        maxValue: 900_000,
      });

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness.missing).toContain('loss-drivers');
    });

    it('should carry an empty lifeline for a scenario that was never simulated', async () => {
      await createScenarioNamed('No history at all');

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.lifeline).toEqual([]);
    });

    it('should report no run and no trend for a scenario that was never simulated', async () => {
      await createScenarioNamed('Untouched scenario');

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.latestRun).toBeNull();
      expect(row.changeOverLifeline).toBeNull();
    });

    it('should report incomplete while an input has never been filled in', async () => {
      const scenarioId = await createScenarioNamed('Missing both inputs');
      await insertRun(scenarioId, daysAgo(1), 100_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness.status).toBe('incomplete');
      expect(row.readiness.missing).toEqual(expect.arrayContaining(['tef', 'loss-drivers']));

      await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(scenarioId, adminTenantId);

      const [afterTef] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();
      expect(afterTef.readiness.status).toBe('incomplete');
      expect(afterTef.readiness.missing).toEqual(['loss-drivers']);
    });

    it('should read an auto-mode frequency from the estimate rather than the manual triplet', async () => {
      const scenarioId = await createScenarioNamed('Auto frequency');
      await fillLossDrivers(scenarioId);

      const [beforeEstimate] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();
      expect(beforeEstimate.readiness.missing).toEqual(['tef']);

      await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(scenarioId, adminTenantId);

      const [afterEstimate] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();
      expect(afterEstimate.readiness).toEqual({ status: 'not-simulated', missing: [], outdated: [] });
    });

    it('should report an auto-mode scenario stale when a fresh estimate postdates its run', async () => {
      const scenarioId = await createScenarioNamed('Recomputed frequency');
      await fillLossDrivers(scenarioId);
      await insertRun(scenarioId, daysAgo(1), 100_000);
      await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(scenarioId, adminTenantId);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness.status).toBe('stale');
      expect(row.readiness.outdated).toContain('tef');
    });

    it('should not read an auto-mode scenario as stale when only its manual mirror was rewritten', async () => {
      const scenarioId = await createScenarioNamed('Auto with a mirror');
      await fillLossDrivers(scenarioId);
      await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(scenarioId, adminTenantId);
      await insertRun(scenarioId, new Date(Date.now() + 60_000), 100_000);
      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({
        riskScenarioId: scenarioId, min: 1, likely: 2, max: 4,
      });

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness).toEqual({ status: 'ready', missing: [], outdated: [] });
    });

    // The run in the middle sits between the estimate the scenario left behind and the one the
    // return to auto computes, so a reused estimate would read as reflected by it.
    it('should report stale when a scenario returns to auto after a run made on its manual triplet', async () => {
      const scenarioId = await createScenarioNamed('Back to auto');
      await fillLossDrivers(scenarioId);
      const abandoned = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(scenarioId, adminTenantId);
      await db.update(tefEstimates).set({ createdAt: daysAgo(3) }).where(eq(tefEstimates.id, abandoned.id));
      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(scenarioId, 'manual', adminTenantId);
      await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({
        riskScenarioId: scenarioId, min: 1, likely: 2, max: 4,
      });
      await insertRun(scenarioId, daysAgo(2), 100_000);

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(scenarioId, 'auto', adminTenantId);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness.status).toBe('stale');
      expect(row.readiness.outdated).toContain('tef');
    });

    it('should not read the mirror handed over on the way to manual as an edit after the run', async () => {
      const scenarioId = await createScenarioNamed('Handed to manual');
      await fillLossDrivers(scenarioId);
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(scenarioId, adminTenantId);
      await db.update(tefEstimates).set({ createdAt: daysAgo(3) }).where(eq(tefEstimates.id, estimate.id));
      await insertRun(scenarioId, daysAgo(2), 100_000);

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(scenarioId, 'manual', adminTenantId);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness.outdated).not.toContain('tef');
    });

    it('should report not-simulated once the inputs are complete but no run exists', async () => {
      const scenarioId = await createScenarioNamed('Ready to run');
      await fillManualInputs(scenarioId);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness).toEqual({ status: 'not-simulated', missing: [], outdated: [] });
    });

    it('should report stale when an input was edited after the last run', async () => {
      const scenarioId = await createScenarioNamed('Drifted scenario');
      await insertRun(scenarioId, daysAgo(1), 100_000);
      await fillManualInputs(scenarioId);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness.status).toBe('stale');
      expect(row.readiness.outdated).toEqual(expect.arrayContaining(['tef', 'loss-drivers']));
    });

    it('should report ready when the last run postdates every input', async () => {
      const scenarioId = await createScenarioNamed('Trustworthy scenario');
      await fillManualInputs(scenarioId);
      // A minute ahead: the inputs carry server-side microsecond timestamps, so a run stamped from
      // the client clock in the same second can land before them and read as stale.
      await insertRun(scenarioId, new Date(Date.now() + 60_000), 100_000);

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness).toEqual({ status: 'ready', missing: [], outdated: [] });
    });

    it('should not count loss estimates that are all zero as pricing', async () => {
      const scenarioId = await createScenarioNamed('Zeroed estimates');
      await services.withOrigin(adminOrigin).scenarioLossEstimates.upsertScenarioLossEstimates(scenarioId, [{
        lossDriverId: deriveSeedId(adminTenantId, LossDriver_ForensicsIncidentManagement),
        action: 'set',
        minValue: 0,
        likelyValue: 0,
        maxValue: 0,
      }], { maxUpdatedAt: null, rowCount: 0 });

      const [row] = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview();

      expect(row.readiness.missing).toContain('loss-drivers');
    });

    it('should scope the overview to one organization', async () => {
      const otherOrgId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: otherOrgId, name: 'Other Organization' },
      ]);
      const scenarioId = await createScenarioNamed('In scope');
      await createScenarioNamed('Out of scope', otherOrgId);

      const rows = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(organizationId);

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(scenarioId);
    });

    it('should not expose another tenant scenario or its runs', async () => {
      const scenarioId = await createScenarioNamed('Tenant A only');
      await insertRun(scenarioId, daysAgo(1), 100_000);

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const rows = await services.withOrigin(tenantBOrigin).riskScenarios.getRiskScenariosOverview();
      expect(rows).toHaveLength(0);
    });

    describe('getRiskScenariosReadiness', () => {
      const readinessById = (rows: ReadonlyArray<{ id: string, readiness: ScenarioReadiness }>) =>
        new Map(rows.map((row) => [row.id, row.readiness]));

      it('should give every scenario the readiness the overview gives it, tenant-wide and per organization', async () => {
        const emptyScopeId = uuidv7();
        await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: emptyScopeId, name: 'Empty closed scope' }]);
        await services.withOrigin(adminOrigin).organizations.updateOrganization(emptyScopeId, { estateMode: 'closed' });
        await createScenarioNamed('Nothing to price', emptyScopeId);

        await createScenarioNamed('Untouched');

        await fillManualInputs(await createScenarioNamed('Never run'));

        const drifted = await createScenarioNamed('Drifted');
        await insertRun(drifted, daysAgo(1), 100_000);
        await fillManualInputs(drifted);

        const trustworthy = await createScenarioNamed('Trustworthy');
        await fillManualInputs(trustworthy);
        await insertRun(trustworthy, new Date(Date.now() + 60_000), 100_000);

        const rerun = await createScenarioNamed('Run again since');
        await insertRun(rerun, daysAgo(2), 100_000);
        await fillManualInputs(rerun);
        await insertRun(rerun, new Date(Date.now() + 60_000), 100_000);

        const recomputed = await createScenarioNamed('Recomputed frequency');
        await fillLossDrivers(recomputed);
        await insertRun(recomputed, daysAgo(1), 100_000);
        await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(recomputed, adminTenantId);

        const mirrored = await createScenarioNamed('Auto with a mirror');
        await fillLossDrivers(mirrored);
        await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(mirrored, adminTenantId);
        await insertRun(mirrored, new Date(Date.now() + 60_000), 100_000);
        await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({ riskScenarioId: mirrored, min: 1, likely: 2, max: 4 });

        for (const scope of [undefined, organizationId, emptyScopeId]) {
          const overview = readinessById(await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosOverview(scope));
          const light = readinessById(await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosReadiness(scope));
          expect(light).toEqual(overview);
        }
        const all = await services.withOrigin(adminOrigin).riskScenarios.getRiskScenariosReadiness();
        expect(new Set(all.map((row) => row.readiness.status))).toEqual(new Set(SCENARIO_READINESS_STATUSES));
        expect(readinessById(all).get(rerun)?.status).toBe('ready');
      });

      it('should not expose another tenant scenario', async () => {
        await insertRun(await createScenarioNamed('Tenant A only'), daysAgo(1), 100_000);

        const tenantBId = await createTenant(services, adminUserId);
        const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

        expect(await services.withOrigin(tenantBOrigin).riskScenarios.getRiskScenariosReadiness()).toHaveLength(0);
      });
    });
  });
});
