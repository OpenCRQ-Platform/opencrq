import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { AttackOutcome_Ransomware, deriveSeedId } from '@app/module';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

/**
 * A simulation outlives the scenario it prices: queued it would fail its run insert on the deleted
 * scenario, running it holds the tenant's one simulation slot pricing something nobody can read.
 */
describe('Deleting a risk scenario cancels its simulations (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let scenarioIds: Array<string>;

  const listSimulationJobs = () => services.withOrigin({ type: 'system' }).jobs
    .listJobs({ tenantId, kind: 'crq-simulation' });

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    adminOrigin = { type: 'client', userId: adminId, tenantId };
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);

    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Acme Europe' }]);

    const attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_Ransomware);
    scenarioIds = [uuidv7(), uuidv7()];
    for (const [index, id] of scenarioIds.entries()) {
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: `Scenario ${index + 1}`, description: null, attackOutcomeId, primaryAssetIds: [],
      });
      await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId: id }, { tenantId });
    }
  });

  it('should cancel the simulations a deleted scenario leaves queued', async () => {
    expect(await listSimulationJobs()).toHaveLength(2);

    const res = await client.mutation('riskScenarios.deleteRiskScenarios', scenarioIds, { tenantId });

    expect(res.status).toBe(200);
    const remaining = await listSimulationJobs();
    expect(remaining.map((job) => job.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('should ask a simulation already running on a deleted scenario to stop', async () => {
    const systemJobs = services.withOrigin({ type: 'system' }).jobs;
    const claimed = await systemJobs.claimNext('test-worker', ['crq-simulation'], 60_000);
    expect(claimed).toBeDefined();

    await client.mutation('riskScenarios.deleteRiskScenarios', scenarioIds, { tenantId });

    const jobs = await listSimulationJobs();
    const running = jobs.find((job) => job.id === claimed!.id);
    // A claimed run cannot be cancelled from outside: the engine reads the flag at its own yield
    // point and stops there, instead of pricing a scenario nobody can read any more.
    expect(running?.abortRequestedAt).not.toBeNull();
    expect(jobs.filter((job) => job.id !== claimed!.id).map((job) => job.status)).toEqual(['cancelled']);
  });

  it('should leave the simulations of a scenario nobody deleted alone', async () => {
    await client.mutation('riskScenarios.deleteRiskScenarios', [scenarioIds[0]], { tenantId });

    const jobs = await listSimulationJobs();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a queued payload is stored as JSON and comes back untyped
    const survivor = jobs.find((job) => (job.payload as { riskScenarioId: string }).riskScenarioId === scenarioIds[1]);
    expect(survivor?.status).toBe('queued');
  });
});
