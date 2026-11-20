import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('CRQ pending computation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let adminId: string;
  let riskScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Pending Computation Tenant' }, adminId);

    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Test Org' }]);
    const [attackOutcome] = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    riskScenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Scenario under test',
      description: null,
      attackOutcomeId: attackOutcome.id,
      primaryAssetIds: [],
    });
  });

  const enqueueRecompute = () => services.withOrigin({ type: 'system' }).jobs.enqueueJob({
    kind: 'financial-estimates-recompute',
    tenantId,
    payload: { riskScenarioId },
  });

  it('should answer not pending while no job is in flight', async () => {
    const res = await client.query('crqIndicators.getPendingComputation', { riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ pending: false });
  });

  it('should answer pending, and only a boolean, while the scenario\'s recompute is queued', async () => {
    await enqueueRecompute();

    const res = await client.query('crqIndicators.getPendingComputation', { riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ pending: true });
  });

  it('should answer not pending once the job is terminal', async () => {
    const { jobId } = await enqueueRecompute();
    await services.withOrigin({ type: 'system' }).jobs.cancelJob(jobId);

    const res = await client.query('crqIndicators.getPendingComputation', { riskScenarioId }, { tenantId });
    expect(res.json.result.data).toEqual({ pending: false });
  });

  it('should answer not pending for a scenario the caller cannot see, though a job names it', async () => {
    await enqueueRecompute();
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

    const res = await client.query('crqIndicators.getPendingComputation', { riskScenarioId }, { tenantId: otherTenantId });
    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ pending: false });
  });

  it('should answer not pending for an unknown scenario', async () => {
    const res = await client.query('crqIndicators.getPendingComputation', { riskScenarioId: uuidv7() }, { tenantId });
    expect(res.json.result.data).toEqual({ pending: false });
  });
});
