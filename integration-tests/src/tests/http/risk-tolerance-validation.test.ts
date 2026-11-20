import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Risk tolerance validation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);

    const origin = { type: 'client', userId: adminId, tenantId } as const;
    organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);
    const [outcome] = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    riskScenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Scenario',
      description: null,
      attackOutcomeId: outcome.id,
      primaryAssetIds: [],
    });
  });

  const setScopeTolerance = (annualLoss: number, maxExceedanceProbability: number) => client.mutation(
    'organizations.setRiskTolerance',
    { organizationId, tolerance: { annualLoss, maxExceedanceProbability } },
    { tenantId },
  );

  it.each([
    ['an annual loss of zero', 0, 0.1],
    ['a negative annual loss', -1, 0.1],
    ['a maximum probability below 0.1%', 1_000_000, 0.0009],
    ['a maximum probability above 100%', 1_000_000, 1.01],
  ])('should refuse %s', async (_label, annualLoss, maxExceedanceProbability) => {
    const res = await setScopeTolerance(annualLoss, maxExceedanceProbability);

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should accept both ends of the probability range', async () => {
    expect((await setScopeTolerance(1_000_000, 0.001)).status).toBe(200);
    expect((await setScopeTolerance(1_000_000, 1)).status).toBe(200);
  });

  it('should refuse the same out-of-range threshold on a scenario', async () => {
    const res = await client.mutation(
      'riskScenarios.setRiskTolerance',
      { riskScenarioId, tolerance: { annualLoss: 1_000_000, maxExceedanceProbability: 0 } },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should answer not found for a scenario the caller cannot see', async () => {
    const res = await client.mutation(
      'riskScenarios.setRiskTolerance',
      { riskScenarioId: uuidv7(), tolerance: null },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });
});
