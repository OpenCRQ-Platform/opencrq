import type { EventOrigin } from '@app/module';
import { crqIndicatorRunAnnualLosses, crqIndicatorRuns } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Gap to tolerance dashboard endpoint (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let anonymous: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let organizationId: string;
  let untoleratedScopeId: string;
  let scenarioId: string;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    anonymous = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tolerance Gap Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };

    const [outcome] = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    organizationId = uuidv7();
    untoleratedScopeId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([
      { id: organizationId, name: 'Acme' },
      { id: untoleratedScopeId, name: 'Partner' },
    ]);
    await services.withOrigin(origin).organizations.setRiskTolerance(organizationId, { annualLoss: 600_000, maxExceedanceProbability: 0.1 });
    scenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: scenarioId, organizationId, name: 'Ransomware', description: null, attackOutcomeId: outcome.id, primaryAssetIds: [],
    });
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: uuidv7(), organizationId: untoleratedScopeId, name: 'Untolerated', description: null, attackOutcomeId: outcome.id, primaryAssetIds: [],
    });

    const runId = uuidv7();
    await db.insert(crqIndicatorRuns).values({
      id: runId,
      riskScenarioId: scenarioId,
      iterations: 1000,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      lefMean: 1,
      aleMean: 500_000,
      techniqueCount: 10,
      coveredTechniqueCount: 5,
    });
    const probabilities = [0.5, 0.9, 0.99];
    await db.insert(crqIndicatorRunAnnualLosses).values({
      id: runId,
      runId,
      years: 10_000,
      mean: 500_000,
      lossYearShare: 1,
      lossEventYearShare: 1,
      probabilities,
      losses: probabilities.map((level) => level * 1_000_000),
    });
  }, 600_000);

  it('should rank the scenario and name the scope with no tolerance', async () => {
    const res = await client.query('dashboard.getToleranceGaps', {}, { tenantId });

    expect(res.status).toBe(200);
    const { rows, noToleranceCount, noToleranceScopes } = res.json.result.data;
    expect(rows).toEqual([expect.objectContaining({
      scenarioId, organizationId, source: 'scope', outside: true, ownTolerance: null,
      scopeTolerance: { annualLoss: 600_000, maxExceedanceProbability: 0.1 },
    })]);
    expect(noToleranceCount).toBe(1);
    expect(noToleranceScopes).toEqual([{ organizationId: untoleratedScopeId, organizationName: 'Partner' }]);
  });

  it('should keep to the risk scope asked for', async () => {
    const res = await client.query('dashboard.getToleranceGaps', { organizationId: untoleratedScopeId }, { tenantId });

    expect(res.json.result.data).toMatchObject({ rows: [], noToleranceCount: 1 });
  });

  it('should refuse a risk scope id that is not a UUID', async () => {
    const res = await client.query('dashboard.getToleranceGaps', { organizationId: 'acme' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse an unauthenticated caller', async () => {
    const res = await anonymous.query('dashboard.getToleranceGaps', {}, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });
});
