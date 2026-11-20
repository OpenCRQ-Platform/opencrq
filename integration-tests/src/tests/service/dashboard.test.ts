import type { EventOrigin } from '@app/module';
import { controlCapabilities, crqControlWhatIfResults, crqIndicatorRuns, dashboardRepository, lossCategories, lossDrivers, scenarioLossEstimates } from '@app/module';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const insertRun = async (
  riskScenarioId: string,
  createdAt: Date,
  metrics: { ale?: number | null, lef?: number | null },
): Promise<string> => {
  const id = uuidv7();
  await db.insert(crqIndicatorRuns).values({
    id,
    riskScenarioId,
    createdAt,
    iterations: 1000,
    vulnerabilityP5: 0.1,
    vulnerabilityP50: 0.2,
    vulnerabilityP95: 0.3,
    lefMean: metrics.lef ?? null,
    aleMean: metrics.ale ?? null,
    aleP10: metrics.ale != null ? metrics.ale * 0.5 : null,
    aleP90: metrics.ale != null ? metrics.ale * 2 : null,
    techniqueCount: 10,
    coveredTechniqueCount: 5,
  });
  return id;
};

const insertWhatIf = async (
  runId: string,
  controlId: string,
  dimension: 'strength' | 'coverage' | 'deploy',
  aleReduction: number,
  rungs: { currentStrength: 'L0' | 'L1' | 'L2' | 'L3', upgradedStrength: 'L0' | 'L1' | 'L2' | 'L3' } = { currentStrength: 'L0', upgradedStrength: 'L1' },
) => {
  await db.insert(crqControlWhatIfResults).values({
    id: uuidv7(),
    runId,
    controlId,
    controlKind: 'capability',
    dimension,
    ...rungs,
    currentCoverage: 'L0',
    upgradedCoverage: 'L1',
    aleReductionMean: aleReduction,
  });
};

describe('Dashboard Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let orgAId: string;
  let orgBId: string;
  let scenarioA1Id: string;
  let scenarioA2Id: string;
  let scenarioB1Id: string;
  let attackOutcomeName: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;

    orgAId = uuidv7();
    orgBId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgAId, name: 'Org A' },
      { id: orgBId, name: 'Org B' },
    ]);

    const attackOutcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
    const outcome = attackOutcomes.at(0);
    if (!outcome) {
      throw new Error('No attack outcomes found in seeded data — ensure platform seed ran before this test');
    }
    attackOutcomeName = outcome.name;

    scenarioA1Id = uuidv7();
    scenarioA2Id = uuidv7();
    scenarioB1Id = uuidv7();
    for (const [id, organizationId, name] of [
      [scenarioA1Id, orgAId, 'Scenario A1'],
      [scenarioA2Id, orgAId, 'Scenario A2'],
      [scenarioB1Id, orgBId, 'Scenario B1'],
    ] as const) {
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id,
        organizationId,
        name,
        description: null,
        attackOutcomeId: outcome.id,
        primaryAssetIds: [],
      });
    }
  });

  describe('getScenarioSummaries', () => {
    it('returns latest run, relations and 90-day trend per scenario', async () => {
      await insertRun(scenarioA1Id, daysAgo(100), { ale: 100_000, lef: 1 });
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000, lef: 2 });
      await insertRun(scenarioA2Id, daysAgo(5), { ale: 80_000, lef: 0.5 });

      const summaries = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries();
      expect(summaries).toHaveLength(3);

      const a1 = summaries.find((s) => s.id === scenarioA1Id)!;
      expect(a1.name).toBe('Scenario A1');
      expect(a1.organizationName).toBe('Org A');
      expect(a1.attackOutcomeName).toBe(attackOutcomeName);
      expect(a1.latestRun).toMatchObject({ aleMean: 150_000, aleP10: 75_000, aleP90: 300_000, lefMean: 2 });
      expect(a1.trend).toMatchObject({
        baselineAleMean: 100_000,
        currentAleMean: 150_000,
        delta: 50_000,
        deltaPct: 0.5,
      });
      expect(a1.likelihoodChange).toBeCloseTo(Math.exp(-1) - Math.exp(-2), 12);

      const a2 = summaries.find((s) => s.id === scenarioA2Id)!;
      expect(a2.latestRun?.aleMean).toBe(80_000);
      expect(a2.trend).toBeNull();

      const b1 = summaries.find((s) => s.id === scenarioB1Id)!;
      expect(b1.latestRun).toBeNull();
      expect(b1.trend).toBeNull();
    });

    it('should measure the change over the window asked for', async () => {
      await insertRun(scenarioA1Id, daysAgo(40), { ale: 100_000, lef: 0.2 });
      await insertRun(scenarioA1Id, daysAgo(5), { ale: 120_000, lef: 0.6 });

      const lastMonth = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries(undefined, 30);
      const lastQuarter = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries();

      expect(lastMonth.find((s) => s.id === scenarioA1Id)?.likelihoodChange).toBeCloseTo(Math.exp(-0.2) - Math.exp(-0.6), 12);
      expect(lastQuarter.find((s) => s.id === scenarioA1Id)).toMatchObject({ trend: { delta: 20_000 }, likelihoodChange: null });
    });

    it('should give no likelihood change to a scenario without a run before the window', async () => {
      await insertRun(scenarioA2Id, daysAgo(20), { ale: 80_000, lef: 0.5 });
      await insertRun(scenarioA2Id, daysAgo(2), { ale: 90_000, lef: 0.9 });

      const summaries = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries(undefined, 30);

      expect(summaries.find((s) => s.id === scenarioA2Id)).toMatchObject({ trend: { delta: 10_000 }, likelihoodChange: null });
    });

    it('should measure the likelihood change of a scenario whose runs carry no ALE', async () => {
      await insertRun(scenarioA1Id, daysAgo(40), { lef: 0.2 });
      await insertRun(scenarioA1Id, daysAgo(5), { lef: 0.6 });

      const summaries = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries(undefined, 30);
      const a1 = summaries.find((s) => s.id === scenarioA1Id);

      expect(a1?.trend).toBeNull();
      expect(a1?.likelihoodChange).toBeCloseTo(Math.exp(-0.2) - Math.exp(-0.6), 12);
    });

    it('filters by organization', async () => {
      const summaries = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries(orgAId);
      expect(summaries.map((s) => s.id).sort()).toEqual([scenarioA1Id, scenarioA2Id].sort());
    });

    it('should answer that a closed scope holding nothing has no estate to price', async () => {
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000, lef: 2 });
      await services.withOrigin(adminOrigin).organizations.updateOrganization(orgAId, { estateMode: 'closed' });

      const summaries = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries();

      // The run stays on the row: what the flag retires is the figure, and the surfaces are what
      // stop reading it.
      expect(summaries.find((s) => s.id === scenarioA1Id)).toMatchObject({ noMappedAsset: true });
      expect(summaries.find((s) => s.id === scenarioA1Id)?.latestRun?.aleMean).toBe(150_000);
      expect(summaries.find((s) => s.id === scenarioB1Id)).toMatchObject({ noMappedAsset: false });
    });

    it('should answer that an open scope has one whatever it maps', async () => {
      const summaries = await services.withOrigin(adminOrigin).dashboard.getScenarioSummaries();

      expect(summaries.every((summary) => summary.noMappedAsset === false)).toBe(true);
    });
  });

  describe('getExposureTrend', () => {
    it('sums metrics per day with carry-forward across scenarios', async () => {
      await insertRun(scenarioA1Id, daysAgo(100), { ale: 100_000, lef: 1 });
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000, lef: 2 });
      await insertRun(scenarioA2Id, daysAgo(5), { ale: 80_000, lef: 0.5 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureTrend();

      expect(points).toHaveLength(90);
      const first = points.at(0)!;
      expect(first).toMatchObject({ ale: 100_000, lef: 1 });

      const midWindow = points.at(50)!;
      expect(midWindow).toMatchObject({ ale: 100_000, lef: 1 });

      const last = points.at(-1)!;
      expect(last.ale).toBe(230_000);
      expect(last.lef).toBe(2.5);
    });

    it('reaches back over the window asked for and derives the likelihood and the magnitude', async () => {
      await insertRun(scenarioA1Id, daysAgo(300), { ale: 100_000, lef: 0.5 });
      await insertRun(scenarioA2Id, daysAgo(5), { ale: 60_000, lef: 0.5 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureTrend(undefined, 365);

      expect(points.at(0)).toMatchObject({ ale: 100_000, lef: 0.5, magnitude: 200_000 });
      const last = points.at(-1)!;
      expect(last.likelihood).toBeCloseTo(1 - Math.exp(-1), 12);
      expect(last.magnitude).toBe(160_000);
    });

    it('should seed the window with the later-written of two runs sharing a timestamp', async () => {
      const createdAt = daysAgo(100);
      await insertRun(scenarioA1Id, createdAt, { ale: 100_000, lef: 1 });
      await insertRun(scenarioA1Id, createdAt, { ale: 120_000, lef: 1 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureTrend();

      expect(points.at(0)).toMatchObject({ ale: 120_000 });
    });

    it('should seed a scope\'s trend from its own scenarios only', async () => {
      await insertRun(scenarioA1Id, daysAgo(100), { ale: 100_000, lef: 1 });
      await insertRun(scenarioB1Id, daysAgo(100), { ale: 500_000, lef: 1 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureTrend(orgAId);

      expect(points.at(0)).toMatchObject({ ale: 100_000 });
    });

    it('returns an empty series for an organization without any run', async () => {
      const points = await services.withOrigin(adminOrigin).dashboard.getExposureTrend(orgBId);
      expect(points).toEqual([]);
    });
  });

  describe('getRiskScopeFigures', () => {
    it('should read each scope as its own exposure trend reads it, ranked by annual loss exposure', async () => {
      await insertRun(scenarioA1Id, daysAgo(400), { ale: 100_000, lef: 0.5 });
      await insertRun(scenarioA1Id, daysAgo(20), { ale: 120_000, lef: 0.6 });
      await insertRun(scenarioA2Id, daysAgo(5), { ale: 30_000, lef: 0.2 });
      await insertRun(scenarioB1Id, daysAgo(3), { ale: 500_000, lef: 1 });

      const figures = await services.withOrigin(adminOrigin).dashboard.getRiskScopeFigures(365);

      expect(figures.map((row) => [row.name, row.scenarioCount])).toEqual([['Org B', 1], ['Org A', 2]]);
      const orgA = figures[1];
      const trend = await services.withOrigin(adminOrigin).dashboard.getExposureTrend(orgAId, 365);
      const today = trend.at(-1)!;
      expect(orgA).toMatchObject({ ale: today.ale, lef: today.lef, likelihood: today.likelihood, magnitude: today.magnitude });
      expect(orgA.aleChange).toBe(today.ale! - trend[0].ale!);
      expect(orgA.aleChange).toBe(50_000);
      expect(orgA.aleBaseline).toEqual({ date: trend[0].date, ale: trend[0].ale });
      expect(orgA.windowStart).toBe(trend[0].date);
    });

    it('should leave out a scope with no simulated scenario and one that maps no asset', async () => {
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000, lef: 2 });
      const orgCId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: orgCId, name: 'Org C' }]);
      await services.withOrigin(adminOrigin).organizations.updateOrganization(orgAId, { estateMode: 'closed' });

      const figures = await services.withOrigin(adminOrigin).dashboard.getRiskScopeFigures(365);

      expect(figures).toEqual([]);
    });

    it('should not read another tenant\'s scopes', async () => {
      await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000 });
      const tenant2Id = await createTenant(services, adminUserId);
      const admin2Origin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenant2Id };

      const figures = await services.withOrigin(admin2Origin).dashboard.getRiskScopeFigures(365);

      expect(figures).toEqual([]);
    });
  });

  describe('getExposureBand', () => {
    const ales = (points: Array<{ aleMean: number | null }>) => points.map((point) => point.aleMean);

    it('should open a windowed band on the last run before the window', async () => {
      await insertRun(scenarioA1Id, daysAgo(40), { ale: 100_000 });
      await insertRun(scenarioA1Id, daysAgo(35), { ale: 110_000 });
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: 30 });

      expect(points).toHaveLength(30);
      expect(ales(points.slice(0, 19))).toEqual(Array.from({ length: 19 }, () => 110_000));
      expect(ales(points.slice(-10))).toEqual(Array.from({ length: 10 }, () => 150_000));
    });

    it('should seed a scope\'s band from its own scenarios only', async () => {
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000 });
      await insertRun(scenarioB1Id, daysAgo(40), { ale: 500_000 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ organizationId: orgAId, windowDays: 30 });

      expect(points.at(-1)?.aleMean).toBe(150_000);
    });

    const atHour = (days: number, hour: number): Date => {
      const day = daysAgo(days);
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour));
    };

    it('should read the last run of a day, and keep a mean the last run has none of', async () => {
      await insertRun(scenarioA1Id, atHour(5, 9), { ale: 100_000 });
      await insertRun(scenarioA1Id, atHour(5, 10), { ale: 120_000 });
      await insertRun(scenarioA1Id, atHour(5, 11), { ale: null });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: 30 });

      expect(points.at(-1)?.aleMean).toBe(120_000);
    });

    it('should read the run written last when runs of one scenario share their timestamp', async () => {
      const at = atHour(5, 9);
      await insertRun(scenarioA1Id, at, { ale: 100_000 });
      await insertRun(scenarioA1Id, at, { ale: 120_000 });
      await insertRun(scenarioA1Id, at, { ale: null });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: 30 });

      expect(points.at(-1)?.aleMean).toBe(120_000);
    });

    it('should read the last ALE and the last LEF of a day from the runs that last held each', async () => {
      await insertRun(scenarioA1Id, atHour(5, 9), { ale: 100_000, lef: 1 });
      await insertRun(scenarioA1Id, atHour(5, 10), { ale: 120_000, lef: 2 });
      await insertRun(scenarioA1Id, atHour(5, 11), { ale: null, lef: 3 });
      await insertRun(scenarioA1Id, atHour(5, 12), { ale: null, lef: null });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: 30 });

      expect(points.at(-1)).toMatchObject({ aleMean: 120_000, lefMean: 3 });
    });

    it('should not read the runs before the window into the buckets', async () => {
      await insertRun(scenarioA1Id, daysAgo(40), { ale: 100_000 });
      const axisDays = [2, 1, 0].map((days) => daysAgo(days).toISOString().slice(0, 10));

      const rows = await dashboardRepository.findRunBandBuckets(repositoryContextOf(db, adminOrigin), axisDays, daysAgo(30));

      expect(rows).toEqual([]);
    });

    it('should sum the scenarios and carry each over the days it has no run', async () => {
      await insertRun(scenarioA1Id, daysAgo(3), { ale: 100_000 });
      await insertRun(scenarioB1Id, daysAgo(1), { ale: 40_000 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: 30 });

      expect(ales(points.slice(-4))).toEqual([100_000, 100_000, 140_000, 140_000]);
    });

    it('should open the whole history on its first run, however old it is', async () => {
      await insertRun(scenarioA1Id, daysAgo(365 * 30), { ale: 10_000 });
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000 });

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: null });

      expect(points.at(0)?.aleMean).toBe(10_000);
      expect(points.at(-1)?.aleMean).toBe(150_000);
    });

    it('should read a window older than any run as the whole history', async () => {
      await insertRun(scenarioA1Id, daysAgo(40), { ale: 10_000 });
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000 });
      const dashboard = services.withOrigin(adminOrigin).dashboard;

      const huge = await dashboard.getExposureBand({ windowDays: 1_000_000_000 });

      expect(huge).toEqual(await dashboard.getExposureBand({ windowDays: null }));
      expect(huge.at(0)?.aleMean).toBe(10_000);
    });

    it('should be empty when no scenario has run', async () => {
      await expect(services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: 30 })).resolves.toEqual([]);
    });
  });

  describe('getExposureFlow', () => {
    const lossDriversWithCategory = () => db
      .select({ id: lossDrivers.id, categoryId: lossCategories.id, categoryName: lossCategories.name })
      .from(lossDrivers)
      .innerJoin(lossCategories, eq(lossDrivers.lossCategoryId, lossCategories.id))
      .where(eq(lossDrivers.tenantId, tenantId))
      .orderBy(asc(lossDrivers.id));

    it('should carry the primary assets, the loss category of each estimate and the band and LEF of the latest run', async () => {
      const ledgerId = uuidv7();
      const paymentsId = uuidv7();
      for (const [id, name] of [[ledgerId, 'Ledger'], [paymentsId, 'Payments']] as const) {
        await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
          id,
          organizationId: orgAId,
          name,
          description: null,
          ownerId: null,
          businessValueCategoryIds: [],
        });
      }
      await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(scenarioA1Id, { primaryAssetIds: [paymentsId, ledgerId] });
      const [driver] = await lossDriversWithCategory();
      await db.insert(scenarioLossEstimates).values({
        id: uuidv7(),
        riskScenarioId: scenarioA1Id,
        lossDriverId: driver.id,
        minValue: 1_000,
        likelyValue: 2_000,
        maxValue: 4_000,
      });
      await insertRun(scenarioA1Id, daysAgo(3), { ale: 100_000, lef: 0.4 });

      const flow = await services.withOrigin(adminOrigin).dashboard.getExposureFlow();

      const a1 = flow.scenarios.find((scenario) => scenario.scenarioId === scenarioA1Id)!;
      expect(a1).toMatchObject({ ale: 100_000, aleP10: 50_000, aleP90: 200_000, lefMean: 0.4 });
      expect(a1.primaryAssets).toEqual([{ id: ledgerId, name: 'Ledger' }, { id: paymentsId, name: 'Payments' }]);
      expect(a1.driverExpectations).toEqual([expect.objectContaining({
        driverId: driver.id,
        lossCategoryId: driver.categoryId,
        lossCategoryName: driver.categoryName,
      })]);
    });

    it('should read only the scenarios of the scope asked for', async () => {
      await insertRun(scenarioA1Id, daysAgo(3), { ale: 100_000 });
      await insertRun(scenarioB1Id, daysAgo(3), { ale: 40_000 });

      const flow = await services.withOrigin(adminOrigin).dashboard.getExposureFlow(orgBId);

      expect(flow.scenarios.map((scenario) => scenario.scenarioId)).toEqual([scenarioB1Id]);
      expect(flow.totals).toEqual({ aleMean: 40_000 });
    });
  });

  describe('getTopControls', () => {
    it('keeps the best axis per scenario, sums across scenarios and ignores stale runs', async () => {
      const capabilities = await db.select().from(controlCapabilities).limit(2);
      expect(capabilities.length).toBe(2);
      const [capability1, capability2] = capabilities;

      const staleRunId = await insertRun(scenarioA1Id, daysAgo(30), { ale: 90_000 });
      const a1LatestRunId = await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000 });
      const a2LatestRunId = await insertRun(scenarioA2Id, daysAgo(5), { ale: 80_000 });

      await insertWhatIf(staleRunId, capability1.id, 'deploy', 999_000);
      await insertWhatIf(a1LatestRunId, capability1.id, 'strength', 40_000);
      await insertWhatIf(a1LatestRunId, capability1.id, 'coverage', 25_000);
      await insertWhatIf(a1LatestRunId, capability2.id, 'deploy', 10_000);
      await insertWhatIf(a2LatestRunId, capability1.id, 'deploy', 30_000);

      const topControls = await services.withOrigin(adminOrigin).dashboard.getTopControls();

      expect(topControls).toHaveLength(2);
      expect(topControls[0]).toMatchObject({
        controlId: capability1.id,
        name: capability1.name,
        externalId: capability1.externalId,
        suggestedDimension: 'strength',
        scenarioCount: 2,
        totalAleReduction: 70_000,
      });
      expect(topControls[1]).toMatchObject({
        controlId: capability2.id,
        scenarioCount: 1,
        totalAleReduction: 10_000,
      });
    });

    it('scopes what-if aggregation to the requested organization', async () => {
      const capabilities = await db.select().from(controlCapabilities).limit(1);
      const capability = capabilities[0];

      const a1RunId = await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000 });
      const b1RunId = await insertRun(scenarioB1Id, daysAgo(2), { ale: 100_000 });
      await insertWhatIf(a1RunId, capability.id, 'deploy', 40_000);
      await insertWhatIf(b1RunId, capability.id, 'deploy', 15_000);

      const topControls = await services.withOrigin(adminOrigin).dashboard.getTopControls(orgBId);
      expect(topControls).toHaveLength(1);
      expect(topControls[0]).toMatchObject({ scenarioCount: 1, totalAleReduction: 15_000 });
    });
  });

  describe('getTopControlMoves', () => {
    it('keeps the move with the largest summed reduction, with its own rungs and scenario count', async () => {
      const [capability] = await db.select().from(controlCapabilities).limit(1);
      const a1RunId = await insertRun(scenarioA1Id, daysAgo(3), { ale: 150_000 });
      const a2RunId = await insertRun(scenarioA2Id, daysAgo(3), { ale: 80_000 });
      await insertWhatIf(a1RunId, capability.id, 'strength', 40_000, { currentStrength: 'L1', upgradedStrength: 'L2' });
      await insertWhatIf(a2RunId, capability.id, 'strength', 30_000, { currentStrength: 'L1', upgradedStrength: 'L2' });
      await insertWhatIf(a1RunId, capability.id, 'coverage', 50_000, { currentStrength: 'L1', upgradedStrength: 'L1' });

      const moves = await services.withOrigin(adminOrigin).dashboard.getTopControlMoves();

      expect(moves).toEqual([expect.objectContaining({
        controlId: capability.id,
        externalId: capability.externalId,
        dimension: 'strength',
        currentStrength: 'L1',
        upgradedStrength: 'L2',
        scenarioCount: 2,
        totalAleReduction: 70_000,
      })]);
    });
  });

  /*
   * The counters already read a closed scope holding nothing as unpriced. Every other widget of the
   * page has to count the same scenarios, or the timeline and the ribbons add up a figure the
   * counters beside them refuse.
   */
  describe('a scope that maps no asset', () => {
    const retireOrgA = () => services.withOrigin(adminOrigin).organizations.updateOrganization(orgAId, { estateMode: 'closed' });

    it('should leave its runs out of the exposure trend', async () => {
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000, lef: 2 });
      await insertRun(scenarioB1Id, daysAgo(10), { ale: 40_000, lef: 1 });
      await retireOrgA();

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureTrend();

      expect(points.at(-1)).toMatchObject({ ale: 40_000, lef: 1 });
    });

    it('should leave its runs out of the timeline', async () => {
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000 });
      await insertRun(scenarioB1Id, daysAgo(10), { ale: 40_000 });
      await retireOrgA();

      const points = await services.withOrigin(adminOrigin).dashboard.getExposureBand({ windowDays: 30 });

      expect(points.at(-1)?.aleMean).toBe(40_000);
    });

    it('should list it apart in the exposure flow and leave it out of the total', async () => {
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 150_000 });
      await insertRun(scenarioB1Id, daysAgo(10), { ale: 40_000 });
      await retireOrgA();

      const flow = await services.withOrigin(adminOrigin).dashboard.getExposureFlow();

      expect(flow.unmappedScenarios.map((scenario) => scenario.id)).toEqual(expect.arrayContaining([scenarioA1Id, scenarioA2Id]));
      expect(flow.unpricedScenarios.map((scenario) => scenario.id)).not.toContain(scenarioA1Id);
      expect(flow.unsimulatedScenarios.map((scenario) => scenario.id)).not.toContain(scenarioA2Id);
      expect(flow.totals).toEqual({ aleMean: 40_000 });
    });

    it('should leave its what-if rows out of the top controls', async () => {
      const [capability] = await db.select().from(controlCapabilities).limit(1);
      const a1RunId = await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000 });
      const b1RunId = await insertRun(scenarioB1Id, daysAgo(2), { ale: 100_000 });
      await insertWhatIf(a1RunId, capability.id, 'deploy', 40_000);
      await insertWhatIf(b1RunId, capability.id, 'deploy', 15_000);
      await retireOrgA();

      const topControls = await services.withOrigin(adminOrigin).dashboard.getTopControls();

      expect(topControls).toHaveLength(1);
      expect(topControls[0]).toMatchObject({ scenarioCount: 1, totalAleReduction: 15_000 });
    });
  });

  describe('tenant isolation', () => {
    it('does not expose another tenant data', async () => {
      await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000 });

      const tenant2Id = await createTenant(services, adminUserId);
      const admin2Origin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenant2Id };

      const summaries = await services.withOrigin(admin2Origin).dashboard.getScenarioSummaries();
      expect(summaries).toEqual([]);

      const points = await services.withOrigin(admin2Origin).dashboard.getExposureTrend();
      expect(points).toEqual([]);

      const topControls = await services.withOrigin(admin2Origin).dashboard.getTopControls();
      expect(topControls).toEqual([]);
    });
  });
});
