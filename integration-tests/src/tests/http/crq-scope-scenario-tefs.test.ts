import type { EventOrigin } from '@app/module';
import { AttackOutcome_Ransomware, deriveSeedId } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Risk scope scenario TEFs (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Scope Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };
    organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
    riskScenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Typed',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [],
    });
    await services.withOrigin(origin).crqIndicators.setTefMode(riskScenarioId, 'manual', tenantId);
    await services.withOrigin(origin).crqIndicators.upsertTefInput({ riskScenarioId, min: 0.2, likely: 0.5, max: 2 });
  });

  it('should serve the scope\'s scenarios with the likely TEF each runs on', async () => {
    const res = await client.query('crqIndicators.getScopeScenarioTefs', { organizationId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([
      { id: riskScenarioId, name: 'Typed', attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware), tefMode: 'manual', likely: 0.5, read: null },
    ]);
  });

  it('should refuse a risk scope id that is not a UUID', async () => {
    const res = await client.query('crqIndicators.getScopeScenarioTefs', { organizationId: 'not-a-uuid' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse a call that names no tenant', async () => {
    const res = await client.query('crqIndicators.getScopeScenarioTefs', { organizationId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should serve a member of another tenant none of this scope\'s scenarios', async () => {
    const outsider = await createUser(db);
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other tenant' }, adminId);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId })
      .tenants.addTenantUser(otherTenantId, outsider.userId);
    const outsiderClient = createTrpcTestClient(await getTestServer());
    await signInAs(outsiderClient, outsider.userId);

    const res = await outsiderClient.query('crqIndicators.getScopeScenarioTefs', { organizationId }, { tenantId: otherTenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([]);
  });
});
