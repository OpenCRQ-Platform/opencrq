import type { EventOrigin } from '@app/module';
import { controlCapabilities, crqControlWhatIfResults, crqIndicatorRunAnnualLosses, crqIndicatorRuns } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const DAY_MS = 24 * 60 * 60 * 1000;
const OLD_RUN_DAYS_AGO = 500;

describe('Risk treatment dashboard endpoint (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let anonymous: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let scenarioId: string;
  let capabilityId: string;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    anonymous = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Risk Treatment Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };

    const [outcome] = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    const organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Acme' }]);
    scenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: scenarioId, organizationId, name: 'Ransomware', description: null, attackOutcomeId: outcome.id, primaryAssetIds: [],
    });

    await db.insert(crqIndicatorRuns).values({
      id: uuidv7(),
      riskScenarioId: scenarioId,
      createdAt: new Date(Date.now() - OLD_RUN_DAYS_AGO * DAY_MS),
      iterations: 1000,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      aleMean: 150_000,
      techniqueCount: 10,
      coveredTechniqueCount: 5,
    });

    const runId = uuidv7();
    await db.insert(crqIndicatorRuns).values({
      id: runId,
      riskScenarioId: scenarioId,
      createdAt: new Date(Date.now() - 30 * DAY_MS),
      iterations: 1000,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      lefMean: 2,
      lefP10: 1,
      lefP90: 3,
      aleMean: 200_000,
      techniqueCount: 10,
      coveredTechniqueCount: 5,
    });
    await db.insert(crqIndicatorRunAnnualLosses).values({
      id: runId,
      runId,
      years: 10_000,
      mean: 200_000,
      lossYearShare: 0.86,
      lossEventYearShare: 0.86,
      probabilities: [0.5],
      losses: [0],
    });

    const [capability] = await db.select().from(controlCapabilities).limit(1);
    capabilityId = capability.id;
    await db.insert(crqControlWhatIfResults).values({
      id: uuidv7(),
      runId,
      controlId: capabilityId,
      controlKind: 'capability',
      dimension: 'coverage',
      currentStrength: 'L1',
      upgradedStrength: 'L1',
      currentCoverage: 'L1',
      upgradedCoverage: 'L2',
      aleReductionMean: 30_000,
    });
  }, 600_000);

  it('should carry the scenario card with its headline figures and its top move', async () => {
    const res = await client.query('dashboard.getRiskTreatment', {}, { tenantId });

    expect(res.status).toBe(200);
    const [card] = res.json.result.data;
    expect(card).toMatchObject({ scenarioId, name: 'Ransomware', aleMean: 200_000, noMappedAsset: false, simulated: true });
    expect(card.series).toBeUndefined();
    expect(card.topControlMoves).toEqual([expect.objectContaining({
      controlId: capabilityId, dimension: 'coverage', totalAleReduction: 30_000,
    })]);
  });

  it('should carry the scenario series with the window it opens on', async () => {
    const res = await client.query('dashboard.getRiskTreatmentSeries', { riskScenarioId: scenarioId, windowDays: 365 }, { tenantId });

    expect(res.status).toBe(200);
    const { windowStart, series } = res.json.result.data;
    expect(windowStart).toBe(new Date(Date.now() - 364 * DAY_MS).toISOString().slice(0, 10));
    expect(series.at(-1)).toMatchObject({
      likelihood: 0.86, likelihoodP10: 1 - Math.exp(-1), likelihoodP90: 1 - Math.exp(-3), aleMean: 200_000,
    });
  });

  it('should reach a run of more than a year ago on a two-year window', async () => {
    const oldRunDay = new Date(Date.now() - OLD_RUN_DAYS_AGO * DAY_MS).toISOString().slice(0, 10);

    const twoYears = await client.query('dashboard.getRiskTreatmentSeries', { riskScenarioId: scenarioId, windowDays: 731 }, { tenantId });
    const oneYear = await client.query('dashboard.getRiskTreatmentSeries', { riskScenarioId: scenarioId, windowDays: 365 }, { tenantId });

    expect(twoYears.status).toBe(200);
    expect(twoYears.json.result.data.series[0]).toMatchObject({ date: oldRunDay, aleMean: 150_000 });
    expect(oneYear.json.result.data.series[0].date > oldRunDay).toBe(true);
  });

  it.each([0, 732])('should refuse a window of %i days', async (windowDays) => {
    const res = await client.query('dashboard.getRiskTreatmentSeries', { riskScenarioId: scenarioId, windowDays }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse an unauthenticated caller', async () => {
    const res = await anonymous.query('dashboard.getRiskTreatment', {}, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });
});
