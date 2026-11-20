import type { EventOrigin } from '@app/module';
import { crqIndicatorRunAnnualLosses, crqIndicatorRuns } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every year costs something, and the loss exceeded with probability `1 − level` is `level × scale`. */
const insertRun = async (riskScenarioId: string, daysAgo: number, scale: number | null): Promise<void> => {
  const id = uuidv7();
  await db.insert(crqIndicatorRuns).values({
    id,
    riskScenarioId,
    createdAt: new Date(Date.now() - daysAgo * DAY_MS),
    iterations: 1000,
    vulnerabilityP5: 0.1,
    vulnerabilityP50: 0.2,
    vulnerabilityP95: 0.3,
    lefMean: 1,
    aleMean: scale ?? 0,
    techniqueCount: 10,
    coveredTechniqueCount: 5,
  });
  if (scale !== null) {
    const probabilities = [0.5, 0.9, 0.99];
    await db.insert(crqIndicatorRunAnnualLosses).values({
      id,
      runId: id,
      years: 10_000,
      mean: scale / 2,
      lossYearShare: 1,
      lossEventYearShare: 1,
      probabilities,
      losses: probabilities.map((level) => level * scale),
    });
  }
};

describe('Dashboard Service, gap to tolerance', () => {
  let adminOrigin: EventOrigin;
  let orgAId: string;
  let orgBId: string;
  let outcomeId: string;

  const createScenario = async (organizationId: string, name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id, organizationId, name, description: null, attackOutcomeId: outcomeId, primaryAssetIds: [],
    });
    return id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    adminOrigin = (await createTenantWithAdmin(services)).origin;
    orgAId = uuidv7();
    orgBId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgAId, name: 'Org A' },
      { id: orgBId, name: 'Org B' },
    ]);
    const [outcome] = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
    outcomeId = outcome.id;
  });

  const read = (organizationId?: string) => services.withOrigin(adminOrigin).dashboard.getToleranceGaps(organizationId);

  it('should rank the scenarios by their gap to the threshold applied to each, overruns first', async () => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgBId, { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 });
    const overrun = await createScenario(orgAId, 'Overrun');
    const margin = await createScenario(orgAId, 'Margin');
    const own = await createScenario(orgBId, 'Own threshold');
    await services.withOrigin(adminOrigin).riskScenarios.setRiskTolerance(own, { annualLoss: 100_000, maxExceedanceProbability: 0.5 });
    await insertRun(overrun, 2, 1_000_000);
    await insertRun(margin, 2, 500_000);
    await insertRun(own, 2, 1_000_000);

    const { rows } = await read();

    expect(rows.map((row) => ({ name: row.name, source: row.source, outside: row.outside, organizationName: row.organizationName }))).toEqual([
      { name: 'Own threshold', source: 'scenario', outside: true, organizationName: 'Org B' },
      { name: 'Overrun', source: 'scope', outside: true, organizationName: 'Org A' },
      { name: 'Margin', source: 'scope', outside: false, organizationName: 'Org A' },
    ]);
    expect(rows[0].gap).toBeCloseTo(400_000, 3);
    expect(rows[1].gap).toBeCloseTo(300_000, 3);
    expect(rows[1].ratio).toBeCloseTo(1.5, 6);
    expect(rows[2].gap).toBeCloseTo(-150_000, 3);
    expect(rows[0]).toMatchObject({
      scopeTolerance: { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 },
      ownTolerance: { annualLoss: 100_000, maxExceedanceProbability: 0.5 },
    });
  });

  it('should read the latest run of each scenario', async () => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    const scenario = await createScenario(orgAId, 'Improved');
    await insertRun(scenario, 30, 1_000_000);
    await insertRun(scenario, 1, 500_000);

    const [row] = (await read()).rows;

    expect(row.outside).toBe(false);
    expect(row.loss).toBeCloseTo(450_000, 3);
  });

  it('should count the scenarios with no tolerance and leave out those with no distribution to read', async () => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    const unread = await createScenario(orgAId, 'No distribution');
    const untolerated = await createScenario(orgBId, 'No tolerance');
    await createScenario(orgBId, 'Never simulated');
    await insertRun(unread, 2, null);
    await insertRun(untolerated, 2, 1_000_000);

    expect(await read()).toEqual({ rows: [], noToleranceCount: 2, noToleranceScopes: [{ organizationId: orgBId, organizationName: 'Org B' }] });
  });

  it('should name every scope holding a scenario with no tolerance, each once', async () => {
    await createScenario(orgAId, 'Untolerated in A');
    await createScenario(orgBId, 'Untolerated in B');
    await createScenario(orgBId, 'Also untolerated in B');

    const { noToleranceCount, noToleranceScopes } = await read();

    expect(noToleranceCount).toBe(3);
    expect(noToleranceScopes.map(({ organizationName }) => organizationName).toSorted()).toEqual(['Org A', 'Org B']);
  });

  it('should keep to the risk scope asked for', async () => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    const inA = await createScenario(orgAId, 'In A');
    await createScenario(orgBId, 'Untolerated in B');
    await insertRun(inA, 2, 1_000_000);

    expect(await read(orgAId)).toMatchObject({ rows: [{ scenarioId: inA }], noToleranceCount: 0 });
    expect(await read(orgBId)).toEqual({ rows: [], noToleranceCount: 1, noToleranceScopes: [{ organizationId: orgBId, organizationName: 'Org B' }] });
  });

  it('should leave out a scenario of a scope that maps no asset', async () => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    const scenario = await createScenario(orgAId, 'Unmapped');
    await insertRun(scenario, 2, 1_000_000);
    await services.withOrigin(adminOrigin).organizations.updateOrganization(orgAId, { estateMode: 'closed' });

    expect((await read()).rows).toEqual([]);
  });

  it('should agree with the risk treatment card on its tolerance and its distribution', async () => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    const scenario = await createScenario(orgAId, 'Shared');
    await insertRun(scenario, 2, 1_000_000);

    const [card] = await services.withOrigin(adminOrigin).dashboard.getRiskTreatment({ organizationId: orgAId });
    const { annualLoss } = await services.withOrigin(adminOrigin).dashboard.getRiskTreatmentSeries({ riskScenarioId: scenario, windowDays: 30 });
    const [row] = (await read(orgAId)).rows;

    expect(card.scopeTolerance).toEqual(row.tolerance);
    expect(annualLoss?.quantiles.map(({ loss }) => loss)).toEqual([500_000, 900_000, 990_000]);
  });

  it('should count, per risk scope, the scenarios under a tolerance and the ones whose latest run exceeds it', async () => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgAId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(orgBId, { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 });
    const overrun = await createScenario(orgAId, 'Overrun');
    const margin = await createScenario(orgAId, 'Margin');
    const unread = await createScenario(orgAId, 'No distribution');
    await createScenario(orgAId, 'Never simulated');
    const improved = await createScenario(orgBId, 'Improved');
    await insertRun(overrun, 2, 1_000_000);
    await insertRun(margin, 2, 500_000);
    await insertRun(unread, 2, null);
    await insertRun(improved, 30, 5_000_000);
    await insertRun(improved, 1, 500_000);

    const counts = await services.withOrigin(adminOrigin).dashboard.getToleranceCounts();

    expect(counts.toSorted((left, right) => left.organizationId.localeCompare(right.organizationId))).toEqual([
      { organizationId: orgAId, assessed: 4, outside: 1 },
      { organizationId: orgBId, assessed: 1, outside: 0 },
    ].toSorted((left, right) => left.organizationId.localeCompare(right.organizationId)));
    expect(await services.withOrigin(adminOrigin).dashboard.getToleranceCounts(orgBId)).toEqual([{ organizationId: orgBId, assessed: 1, outside: 0 }]);
  });

  it('should leave a scope with no tolerance out of the counts', async () => {
    await createScenario(orgAId, 'Untolerated');

    expect(await services.withOrigin(adminOrigin).dashboard.getToleranceCounts()).toEqual([]);
  });
});
