import type { EventOrigin } from '@app/module';
import { controlCapabilities, crqControlWhatIfResults, crqIndicatorRunAnnualLosses, crqIndicatorRuns, dashboardRepository } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 365;

const daysAgo = (days: number, hour: number = 10): Date => {
  const date = new Date(Date.now() - days * DAY_MS);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour));
};

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

interface RunFigures {
  ale?: number | null,
  lef?: number | null,
  lefP10?: number | null,
  lefP90?: number | null,
  lossEventYearShare?: number,
  quantiles?: { probabilities: Array<number>, losses: Array<number> },
}

const insertRun = async (riskScenarioId: string, createdAt: Date, figures: RunFigures): Promise<string> => {
  const id = uuidv7();
  await db.insert(crqIndicatorRuns).values({
    id,
    riskScenarioId,
    createdAt,
    iterations: 1000,
    vulnerabilityP5: 0.1,
    vulnerabilityP50: 0.2,
    vulnerabilityP95: 0.3,
    lefMean: figures.lef ?? null,
    lefP10: figures.lefP10 ?? null,
    lefP90: figures.lefP90 ?? null,
    aleMean: figures.ale ?? null,
    techniqueCount: 10,
    coveredTechniqueCount: 5,
  });
  if (figures.lossEventYearShare !== undefined) {
    await db.insert(crqIndicatorRunAnnualLosses).values({
      id,
      runId: id,
      years: 10_000,
      mean: figures.ale ?? 0,
      lossYearShare: figures.lossEventYearShare,
      lossEventYearShare: figures.lossEventYearShare,
      probabilities: figures.quantiles?.probabilities ?? [0.5],
      losses: figures.quantiles?.losses ?? [0],
    });
  }
  return id;
};

const insertWhatIf = async (runId: string, controlId: string, aleReduction: number) => {
  await db.insert(crqControlWhatIfResults).values({
    id: uuidv7(),
    runId,
    controlId,
    controlKind: 'capability',
    dimension: 'deploy',
    currentStrength: 'L0',
    upgradedStrength: 'L1',
    currentCoverage: 'L0',
    upgradedCoverage: 'L1',
    aleReductionMean: aleReduction,
  });
};

describe('Dashboard Service, risk treatment', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let orgAId: string;
  let orgBId: string;
  let scenarioA1Id: string;
  let scenarioA2Id: string;
  let scenarioB1Id: string;

  const read = (organizationId?: string) =>
    services.withOrigin(adminOrigin).dashboard.getRiskTreatment({ organizationId });

  const readSeries = (riskScenarioId: string, windowDays: number = WINDOW_DAYS) =>
    services.withOrigin(adminOrigin).dashboard.getRiskTreatmentSeries({ riskScenarioId, windowDays });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;

    orgAId = uuidv7();
    orgBId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgAId, name: 'Org A' },
      { id: orgBId, name: 'Org B' },
    ]);

    const [outcome] = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();

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

  it('should mark a scenario holding a run as simulated, and one without as not', async () => {
    await insertRun(scenarioA1Id, daysAgo(3), { ale: null });

    const cards = await read(orgAId);

    expect(cards.map((card) => ({ id: card.scenarioId, simulated: card.simulated, ale: card.aleMean })).toSorted((a, b) => a.id.localeCompare(b.id)))
      .toEqual([
        { id: scenarioA1Id, simulated: true, ale: null },
        { id: scenarioA2Id, simulated: false, ale: null },
      ].toSorted((a, b) => a.id.localeCompare(b.id)));
  });

  it('should give every scenario of the tenant a card, largest expected annual loss first', async () => {
    await insertRun(scenarioA1Id, daysAgo(3), { ale: 100_000, lef: 1 });
    await insertRun(scenarioB1Id, daysAgo(3), { ale: 400_000, lef: 1 });

    const cards = await read();

    expect(cards.map((card) => ({ id: card.scenarioId, ale: card.aleMean }))).toEqual([
      { id: scenarioB1Id, ale: 400_000 },
      { id: scenarioA1Id, ale: 100_000 },
      { id: scenarioA2Id, ale: null },
    ]);
  });

  it('should give a risk scope the cards of its own scenarios only', async () => {
    await insertRun(scenarioB1Id, daysAgo(3), { ale: 400_000, lef: 1 });

    const cards = await read(orgAId);

    expect(cards.map((card) => card.scenarioId).toSorted()).toEqual([scenarioA1Id, scenarioA2Id].toSorted());
  });

  it('should give one scenario its card alone, with its latest figure and its scope tolerance', async () => {
    const scopeTolerance = { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 };
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, scopeTolerance);
    await insertRun(scenarioA1Id, daysAgo(3), { ale: 100_000, lef: 1 });
    await insertRun(scenarioA2Id, daysAgo(3), { ale: 200_000, lef: 1 });

    const cards = await services.withOrigin(adminOrigin).dashboard.getRiskTreatment({ riskScenarioId: scenarioA2Id });

    expect(cards.map((card) => ({ id: card.scenarioId, scopeTolerance: card.scopeTolerance, ale: card.aleMean }))).toEqual([
      { id: scenarioA2Id, scopeTolerance, ale: 200_000 },
    ]);
  });

  it('should read one point per day, from the last run of that day', async () => {
    await insertRun(scenarioA1Id, daysAgo(5, 8), { ale: 100_000, lef: 1, lossEventYearShare: 0.6 });
    await insertRun(scenarioA1Id, daysAgo(5, 15), { ale: 120_000, lef: 2, lossEventYearShare: 0.8 });
    await insertRun(scenarioA1Id, daysAgo(2), { ale: 90_000, lef: 3, lossEventYearShare: 0.9 });

    const { series } = await readSeries(scenarioA1Id);

    expect(series.map(({ date, aleMean, likelihood }) => ({ date, aleMean, likelihood }))).toEqual([
      { date: dayKey(daysAgo(5)), aleMean: 120_000, likelihood: 0.8 },
      { date: dayKey(daysAgo(2)), aleMean: 90_000, likelihood: 0.9 },
    ]);
  });

  it('should open the series on the window start with the last run before it', async () => {
    await insertRun(scenarioA1Id, daysAgo(WINDOW_DAYS + 30), { ale: 50_000, lef: 1, lossEventYearShare: 0.5 });
    await insertRun(scenarioA1Id, daysAgo(10), { ale: 80_000, lef: 1, lossEventYearShare: 0.6 });

    const { windowStart, series } = await readSeries(scenarioA1Id);

    expect(series.map(({ date, aleMean, likelihood }) => ({ date, aleMean, likelihood }))).toEqual([
      { date: dayKey(daysAgo(WINDOW_DAYS - 1)), aleMean: 50_000, likelihood: 0.5 },
      { date: dayKey(daysAgo(10)), aleMean: 80_000, likelihood: 0.6 },
    ]);
    expect(windowStart).toBe(series[0].date);
  });

  it('should name the window start on a card whose series opens after it', async () => {
    await insertRun(scenarioA1Id, daysAgo(10), { ale: 80_000, lef: 1, lossEventYearShare: 0.6 });

    const { windowStart, series } = await readSeries(scenarioA1Id);

    expect(windowStart).toBe(dayKey(daysAgo(WINDOW_DAYS - 1)));
    expect(series.map(({ date }) => date)).toEqual([dayKey(daysAgo(10))]);
  });

  it('should read no likelihood from a run without an annual loss distribution, and no band from a run without one', async () => {
    await insertRun(scenarioA1Id, daysAgo(4), { ale: 100_000, lef: 1, lefP10: 0.5, lefP90: 2 });
    await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000, lef: 1, lossEventYearShare: 0.6 });
    await insertRun(scenarioA1Id, daysAgo(1), { ale: 100_000, lef: 1, lefP10: 0.5, lefP90: 2, lossEventYearShare: 0.65 });

    const { series } = await readSeries(scenarioA1Id);

    expect(series.map(({ likelihood, likelihoodP10, likelihoodP90 }) => ({ likelihood, likelihoodP10, likelihoodP90 }))).toEqual([
      { likelihood: null, likelihoodP10: 1 - Math.exp(-0.5), likelihoodP90: 1 - Math.exp(-2) },
      { likelihood: 0.6, likelihoodP10: null, likelihoodP90: null },
      { likelihood: 0.65, likelihoodP10: 1 - Math.exp(-0.5), likelihoodP90: 1 - Math.exp(-2) },
    ]);
  });

  it('should read the annual loss exposure the CISO trend reads for a scope holding one scenario', async () => {
    await insertRun(scenarioB1Id, daysAgo(40), { ale: 300_000, lef: 2 });
    await insertRun(scenarioB1Id, daysAgo(3), { ale: 360_000, lef: 1.5 });

    const { series } = await readSeries(scenarioB1Id);
    const [card] = await read(orgBId);
    const trend = await services.withOrigin(adminOrigin).dashboard.getExposureTrend(orgBId, WINDOW_DAYS);

    expect(series.at(-1)?.aleMean).toBe(trend.at(-1)?.ale);
    expect(series.at(0)?.aleMean).toBe(trend.at(0)?.ale);
    expect(card.aleMean).toBe(trend.at(-1)?.ale);
  });

  it('should list at most five control moves, ranked on the scenario alone', async () => {
    const capabilities = await db.select().from(controlCapabilities).limit(6);
    const a1RunId = await insertRun(scenarioA1Id, daysAgo(2), { ale: 500_000, lef: 1 });
    const b1RunId = await insertRun(scenarioB1Id, daysAgo(2), { ale: 500_000, lef: 1 });
    for (const [index, capability] of capabilities.entries()) {
      await insertWhatIf(a1RunId, capability.id, (index + 1) * 1_000);
    }
    await insertWhatIf(b1RunId, capabilities[0].id, 90_000);

    const cards = await read();
    const a1 = cards.find((card) => card.scenarioId === scenarioA1Id)!;

    expect(a1.topControlMoves.map((move) => move.totalAleReduction)).toEqual([6_000, 5_000, 4_000, 3_000, 2_000]);
    expect(a1.topControlMoves.every((move) => move.scenarioCount === 1)).toBe(true);
  });

  it('should read only the latest run what-if rows', async () => {
    const [capability] = await db.select().from(controlCapabilities).limit(1);
    const staleRunId = await insertRun(scenarioA1Id, daysAgo(20), { ale: 500_000, lef: 1 });
    await insertRun(scenarioA1Id, daysAgo(2), { ale: 400_000, lef: 1 });
    await insertWhatIf(staleRunId, capability.id, 80_000);

    const cards = await read(orgAId);

    expect(cards.find((card) => card.scenarioId === scenarioA1Id)?.topControlMoves).toEqual([]);
  });

  it('should leave the runs of a scope that maps no asset out', async () => {
    await insertRun(scenarioA1Id, daysAgo(2), { ale: 500_000, lef: 1 });
    await services.withOrigin(adminOrigin).organizations.updateOrganization(orgAId, { estateMode: 'closed' });

    const cards = await read(orgAId);

    expect(cards.find((card) => card.scenarioId === scenarioA1Id)).toMatchObject({ noMappedAsset: true, simulated: false, aleMean: null });
    expect((await readSeries(scenarioA1Id)).series).toEqual([]);
  });

  it('should carry the latest run annual loss distribution with the series, and none when that run kept none', async () => {
    await insertRun(scenarioA1Id, daysAgo(3), { ale: 100_000, lef: 1, lossEventYearShare: 0.6 });
    await insertRun(scenarioA2Id, daysAgo(4), { ale: 100_000, lef: 1, lossEventYearShare: 0.6 });
    await insertRun(scenarioA2Id, daysAgo(2), { ale: 100_000, lef: 1 });

    expect((await readSeries(scenarioA1Id)).annualLoss).toEqual({
      mean: 100_000,
      lossYearShare: 0.6,
      quantiles: [{ probability: 0.5, loss: 0 }],
    });
    expect((await readSeries(scenarioA2Id)).annualLoss).toBeNull();
  });

  it('should carry the scope tolerance to each of its scenarios, and a scenario own one beside it', async () => {
    const scopeTolerance = { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 };
    const ownTolerance = { annualLoss: 500_000, maxExceedanceProbability: 0.05 };
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, scopeTolerance);
    await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(scenarioA2Id, ownTolerance);

    const cards = await read();
    const tolerancesOf = (scenarioId: string) => {
      const card = cards.find((candidate) => candidate.scenarioId === scenarioId);
      return { scopeTolerance: card?.scopeTolerance, ownTolerance: card?.ownTolerance };
    };

    expect(tolerancesOf(scenarioA1Id)).toEqual({ scopeTolerance, ownTolerance: null });
    expect(tolerancesOf(scenarioA2Id)).toEqual({ scopeTolerance, ownTolerance });
    expect(tolerancesOf(scenarioB1Id)).toEqual({ scopeTolerance: null, ownTolerance: null });
  });

  it('should read every run of the window against the threshold applied today, skipping a run without a distribution', async () => {
    const quantiles = { probabilities: [0.5, 0.9], losses: [1_000, 5_000] };
    await insertRun(scenarioA1Id, daysAgo(200), { ale: 100_000, lef: 1, lossEventYearShare: 0.6, quantiles });
    await insertRun(scenarioA1Id, daysAgo(100), { ale: 100_000, lef: 1 });
    await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000, lef: 1, lossEventYearShare: 0.8, quantiles });
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 500, maxExceedanceProbability: 0.1 });

    const exceedanceOf = async () => (await readSeries(scenarioA1Id)).series.map(({ exceedance }) => exceedance);

    expect(await exceedanceOf()).toEqual([0.55, null, 0.65]);

    await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(scenarioA1Id, { annualLoss: 3_000, maxExceedanceProbability: 0.2 });

    expect(await exceedanceOf()).toEqual([0.3, null, 0.3]);
    expect((await readSeries(scenarioA2Id)).series).toEqual([]);
  });

  it('should read a scenario against its own tolerance, never another scenario one', async () => {
    const quantiles = { probabilities: [0.5, 0.9], losses: [1_000, 5_000] };
    await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000, lef: 1, lossEventYearShare: 0.8, quantiles });
    await insertRun(scenarioA2Id, daysAgo(2), { ale: 100_000, lef: 1, lossEventYearShare: 0.8, quantiles });
    await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(scenarioA1Id, { annualLoss: 3_000, maxExceedanceProbability: 0.2 });

    const exceedanceOf = async (riskScenarioId: string) => (await readSeries(riskScenarioId)).series.map(({ exceedance }) => exceedance);

    expect(await exceedanceOf(scenarioA1Id)).toEqual([0.3]);
    expect(await exceedanceOf(scenarioA2Id)).toEqual([null]);
  });

  it('should read no exceedance for a scenario without a tolerance', async () => {
    await insertRun(scenarioB1Id, daysAgo(2), { ale: 100_000, lef: 1, lossEventYearShare: 0.6, quantiles: { probabilities: [0.5], losses: [1_000] } });

    const { series } = await readSeries(scenarioB1Id);

    expect(series.map(({ exceedance }) => exceedance)).toEqual([null]);
  });

  describe('the ALE series of the scope', () => {
    const aleSeries = (organizationId?: string) =>
      services.withOrigin(adminOrigin).dashboard.getScenarioAleSeries({ organizationId, windowDays: WINDOW_DAYS });

    it('should read the scenarios of the named scope alone, from the last run before the window', async () => {
      await insertRun(scenarioA1Id, daysAgo(WINDOW_DAYS + 30), { ale: 50_000 });
      await insertRun(scenarioA1Id, daysAgo(10), { ale: 80_000 });
      await insertRun(scenarioB1Id, daysAgo(WINDOW_DAYS + 40), { ale: 999 });
      await insertRun(scenarioB1Id, daysAgo(5), { ale: 777 });

      expect(await aleSeries(orgAId)).toEqual([{
        scenarioId: scenarioA1Id,
        series: [{ date: dayKey(daysAgo(WINDOW_DAYS - 1)), aleMean: 50_000 }, { date: dayKey(daysAgo(10)), aleMean: 80_000 }],
      }]);
      expect((await aleSeries()).map((row) => row.scenarioId).toSorted()).toEqual([scenarioA1Id, scenarioB1Id].toSorted());
    });

    it('should keep the last run of each day', async () => {
      await insertRun(scenarioA1Id, daysAgo(3, 8), { ale: 100_000 });
      await insertRun(scenarioA1Id, daysAgo(3, 16), { ale: 200_000 });

      expect(await aleSeries(orgAId)).toEqual([{ scenarioId: scenarioA1Id, series: [{ date: dayKey(daysAgo(3)), aleMean: 200_000 }] }]);
    });
  });

  it('should read the latest run of the named scenario alone', async () => {
    await insertRun(scenarioA1Id, daysAgo(3), { ale: 100_000 });
    await insertRun(scenarioA2Id, daysAgo(3), { ale: 200_000 });

    const rows = await dashboardRepository.findInScopeLatestRuns(repositoryContextOf(db, adminOrigin), orgAId, scenarioA2Id);

    expect(rows.map((row) => row.riskScenarioId)).toEqual([scenarioA2Id]);
  });

  it('should read no latest run for a named scenario outside the named scope', async () => {
    await insertRun(scenarioB1Id, daysAgo(3), { ale: 100_000 });

    expect(await dashboardRepository.findInScopeLatestRuns(repositoryContextOf(db, adminOrigin), orgAId, scenarioB1Id)).toEqual([]);
  });

  it('should not expose another tenant scenarios', async () => {
    await insertRun(scenarioA1Id, daysAgo(2), { ale: 100_000, lef: 1, lossEventYearShare: 0.5 });

    const tenant2Id = await createTenant(services, adminUserId);
    const admin2Origin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenant2Id };

    await expect(services.withOrigin(admin2Origin).dashboard.getRiskTreatment({})).resolves.toEqual([]);
    await expect(services.withOrigin(admin2Origin).dashboard.getRiskTreatmentSeries({ riskScenarioId: scenarioA1Id, windowDays: WINDOW_DAYS }))
      .resolves.toMatchObject({ series: [] });
  });
});
