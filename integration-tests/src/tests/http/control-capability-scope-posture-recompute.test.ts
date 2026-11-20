import type { EventOrigin } from '@app/module';
import { FULL_RUN_PROFILE } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const CRQ_SIMULATION_JOB = 'crq-simulation';

describe('Scope control posture → attack run recompute (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let organizationId: string;
  let riskScenarioId: string;
  let mfaId: string;

  const queuedSimulations = () => services.withOrigin({ type: 'system' })
    .jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB });

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

    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, { tef: false, losses: false }));

    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    mfaId = capabilities.find((capability) => capability.externalId === 'IDP')!.id;
  });

  it('should book the engine run of the scope’s scenario the control contests', async () => {
    const res = await client.mutation('controlCapabilities.declareScopeControlPosture', {
      organizationId, capabilityId: mfaId, strengthRung: null, coverageBucket: 'L0', comment: 'no MFA here',
    }, { tenantId });
    expect(res.status).toBe(200);

    const jobs = await queuedSimulations();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ riskScenarioId, profile: FULL_RUN_PROFILE });
    expect(jobs[0].triggeredBy).toBe('user');
  });

  it('should queue the scenario once on two saves of the same declaration in a row', async () => {
    const save = () => client.mutation('controlCapabilities.declareScopeControlPosture', {
      organizationId, capabilityId: mfaId, strengthRung: null, coverageBucket: 'L0', comment: null,
    }, { tenantId });

    await save();
    await save();

    expect(await queuedSimulations()).toHaveLength(1);
  });

  it('should refuse a declaration naming neither dimension and book nothing', async () => {
    const res = await client.mutation('controlCapabilities.declareScopeControlPosture', {
      organizationId, capabilityId: mfaId, strengthRung: null, coverageBucket: null, comment: 'nothing declared',
    }, { tenantId });
    expect(res.status).toBe(400);

    expect(await queuedSimulations()).toHaveLength(0);
  });

  it('should book nothing for the scenarios of another scope', async () => {
    const otherScopeId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherScopeId, name: 'Other scope' }]);

    const res = await client.mutation('controlCapabilities.declareScopeControlPosture', {
      organizationId: otherScopeId, capabilityId: mfaId, strengthRung: null, coverageBucket: 'L0', comment: null,
    }, { tenantId });
    expect(res.status).toBe(200);

    expect(await queuedSimulations()).toHaveLength(0);
  });

  it('should book the run again when clearing the declaration puts the control back on the tenant', async () => {
    await client.mutation('controlCapabilities.declareScopeControlPosture', {
      organizationId, capabilityId: mfaId, strengthRung: null, coverageBucket: 'L0', comment: null,
    }, { tenantId });
    await services.withOrigin({ type: 'system' }).jobs.listJobs({ tenantId, kind: CRQ_SIMULATION_JOB });

    const res = await client.mutation('controlCapabilities.clearScopeControlPosture', {
      organizationId, capabilityId: mfaId, dimension: 'coverage',
    }, { tenantId });
    expect(res.status).toBe(200);

    // The first ask is still queued, so the second folds into it rather than racing it.
    expect(await queuedSimulations()).toHaveLength(1);
  });
});
