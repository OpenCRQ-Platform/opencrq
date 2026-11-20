import { AttackOutcome_DataBreachResale, AttackOutcome_Ransomware, deriveSeedId } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Risk Scenarios Validation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let riskScenarioId: string;
  let adminId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);

    const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
    const organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);

    riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Scenario',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [],
    });
  });

  it('should refuse an update payload carrying an attack outcome', async () => {
    // The outcome is fixed at creation: it carries the scenario's timing assumptions and the threat
    // intelligence attached to it. A stale client must fail loudly, not be silently stripped.
    const res = await client.mutation(
      'riskScenarios.updateRiskScenario',
      { id: riskScenarioId, attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_DataBreachResale) },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should still accept an update of the fields the scenario owns', async () => {
    const res = await client.mutation(
      'riskScenarios.updateRiskScenario',
      { id: riskScenarioId, name: 'Renamed' },
      { tenantId },
    );

    expect(res.json.error).toBeUndefined();

    const updated = await services.withOrigin({ type: 'client', userId: adminId, tenantId }).riskScenarios.getRiskScenario(riskScenarioId);
    expect(updated?.name).toBe('Renamed');
  });
});
