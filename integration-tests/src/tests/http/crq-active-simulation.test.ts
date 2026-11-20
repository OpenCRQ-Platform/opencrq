import { ACTIVE_JOB_STATUSES } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

/**
 * The read every Run CRQ control shares. It answers from the same idempotency key the enqueue
 * dedupes on, which is what makes a second window show the run a first one started instead of
 * offering to book another.
 */
describe('CRQ active simulation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let adminId: string;
  let organizationId: string;
  let attackOutcomeId: string;
  let riskScenarioId: string;

  const createScenario = async (name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).riskScenarios.createRiskScenario({
      id,
      organizationId,
      name,
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });
    return id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'CRQ Run State Tenant' }, adminId);

    const origin = { type: 'client' as const, userId: adminId, tenantId };
    organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Test Org' }]);

    const attackOutcomes = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    attackOutcomeId = attackOutcomes[0].id;
    riskScenarioId = await createScenario('Scenario under test');
  });

  it('should answer with no active simulation when none was ever asked for', async () => {
    const res = await client.query('crqIndicators.getActiveSimulation', { riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toBeNull();
  });

  it('should name the queued run a click just booked', async () => {
    const enqueued = await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId }, { tenantId });
    expect(enqueued.status).toBe(200);
    const { jobId } = enqueued.json.result.data;

    const res = await client.query('crqIndicators.getActiveSimulation', { riskScenarioId }, { tenantId });
    expect(res.json.result.data).toEqual({ jobId });
  });

  it('should name the same run after a second click, which books no additional run — the second ask is recorded as absorbed into the first', async () => {
    const first = await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId }, { tenantId });
    const second = await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId }, { tenantId });
    const survivorId = first.json.result.data.jobId;
    expect(second.json.result.data.jobId).toBe(survivorId);

    const res = await client.query('crqIndicators.getActiveSimulation', { riskScenarioId }, { tenantId });
    expect(res.json.result.data).toEqual({ jobId: survivorId });

    const jobs = await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .jobs.listJobs({ tenantId, kind: 'crq-simulation' });
    expect(jobs.filter((job) => (ACTIVE_JOB_STATUSES as ReadonlyArray<string>).includes(job.status))).toHaveLength(1);
    // The second ask folded into the survivor rather than adding a row of its own.
    expect(jobs).toHaveLength(1);
  });

  it('should not name another scenario\'s run', async () => {
    const otherScenarioId = await createScenario('Another scenario');
    await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId: otherScenarioId }, { tenantId });

    const res = await client.query('crqIndicators.getActiveSimulation', { riskScenarioId }, { tenantId });
    expect(res.json.result.data).toBeNull();
  });

  it('should not name a run to another tenant', async () => {
    await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId }, { tenantId });

    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

    const res = await client.query('crqIndicators.getActiveSimulation', { riskScenarioId }, { tenantId: otherTenantId });
    expect(res.json.result.data).toBeNull();
  });

  it('should stop naming a run once it is no longer queued or running', async () => {
    const enqueued = await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId }, { tenantId });
    const { jobId } = enqueued.json.result.data;
    await services.withOrigin({ type: 'system' }).jobs.cancelJob(jobId);

    const res = await client.query('crqIndicators.getActiveSimulation', { riskScenarioId }, { tenantId });
    expect(res.json.result.data).toBeNull();
  });
});
