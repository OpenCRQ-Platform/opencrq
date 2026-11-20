import type { EventOrigin } from '@app/module';
import { FULL_RUN_PROFILE, PRICE_RUN_PROFILE } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const CRQ_SIMULATION_JOB = 'crq-simulation';

/**
 * The first-visit auto-run decides from a client cache, and a scenario creation books a run of its
 * own through the recompute it sets off. `onlyIfNoRun` is what stops those two asks becoming two
 * runs once the first has finished, which is past the reach of the idempotency key.
 */
describe('CRQ auto-run on first visit (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let origin: EventOrigin;
  let riskScenarioId: string;

  const crqJobCount = async () =>
    (await services.withOrigin(origin).jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB })).length;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Auto-run Tenant' }, adminId);

    origin = { type: 'client', userId: adminId, tenantId };
    ({ riskScenarioId } = await seedAttackRunScenario(services, origin, tenantId));
  }, 600_000);

  it('books a run on a scenario that has none', async () => {
    const res = await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId, onlyIfNoRun: true }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.jobId).not.toBeNull();
    expect(await crqJobCount()).toBe(1);
    const [booking] = await services.withOrigin(origin).jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB });
    expect(booking.payload).toMatchObject({ riskScenarioId, profile: FULL_RUN_PROFILE });
  });

  it('books nothing once a run exists, and says so with a null job', async () => {
    await runAttackRun(services, origin, riskScenarioId, tenantId, PRICE_RUN_PROFILE);
    const before = await crqJobCount();

    const res = await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId, onlyIfNoRun: true }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.jobId).toBeNull();
    expect(await crqJobCount()).toBe(before);
  });

  // The guard is the auto-run's alone: asked by hand, the procedure enqueues whatever the scenario
  // already holds, since a run can be owed by a change this endpoint cannot see — a TEF edit, a
  // control, the estate. Here it folds into the job the first test left in flight, which is the
  // idempotency key doing its own, narrower job.
  it('always enqueues when the analyst asks by hand, folding into a run still in flight', async () => {
    const before = await crqJobCount();

    const res = await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.jobId).not.toBeNull();
    expect(await crqJobCount()).toBe(before);
  });
});
