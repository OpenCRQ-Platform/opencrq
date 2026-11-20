import type { EventOrigin } from '@app/module';
import { planRunProfile } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Treatment plan re-simulation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let adminId: string;
  let origin: EventOrigin;
  let organizationId: string;
  let riskScenarioId: string;
  let attackOutcomeId: string;

  const createPlan = async (withMove: boolean): Promise<string> => {
    const scoped = services.withOrigin(origin).treatmentPlans;
    const planId = await scoped.createTreatmentPlan({ organizationId, name: withMove ? 'Harden the estate' : 'Nothing yet' });
    if (withMove) {
      const [capability] = await services.withOrigin(origin).controlCapabilities.getControlCapabilities();
      await scoped.addTreatmentPlanMoves(planId, [{ capabilityId: capability.id, targetStrengthRung: 'L3', targetCoverageBucket: null }]);
    }
    return planId;
  };

  const simulationJobs = async () => await services.withOrigin(origin).jobs.listJobs({ tenantId, kind: 'crq-simulation' });

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Re-simulation Tenant' }, adminId);
    origin = { type: 'client', userId: adminId, tenantId };
    ({ organizationId, riskScenarioId, attackOutcomeId } = await seedAttackRunScenario(services, origin, tenantId));
  });

  it('should count the scenario a plan with a move owes a run, and none running', async () => {
    const planId = await createPlan(true);

    const res = await client.query('treatmentPlans.getTreatmentPlanSimulationState', { planId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ toRepriceCount: 1, runningCount: 0 });
  });

  it('should queue one run per scenario a run can start from, and none for a scenario whose inputs are incomplete', async () => {
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: uuidv7(),
      organizationId,
      name: 'Scenario with no frequency yet',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });
    const planId = await createPlan(true);

    const res = await client.mutation('treatmentPlans.resimulateTreatmentPlanScenarios', { planId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ queuedCount: 1 });
    const jobs = await simulationJobs();
    expect(jobs.map((job) => job.payload)).toEqual([{ riskScenarioId, userId: adminId, profile: planRunProfile(planId) }]);
    expect(jobs[0]).toMatchObject({ triggeredBy: 'user', interactive: true });
    const state = await client.query('treatmentPlans.getTreatmentPlanSimulationState', { planId }, { tenantId });
    expect(state.json.result.data).toEqual({ toRepriceCount: 1, runningCount: 1 });
  });

  it('should fold a second ask into the run still queued rather than book another', async () => {
    const planId = await createPlan(true);

    await client.mutation('treatmentPlans.resimulateTreatmentPlanScenarios', { planId }, { tenantId });
    await client.mutation('treatmentPlans.resimulateTreatmentPlanScenarios', { planId }, { tenantId });

    expect(await simulationJobs()).toHaveLength(1);
  });

  it('should owe nothing and show nothing running for a plan without a move, whatever runs on its scope', async () => {
    const planId = await createPlan(false);
    await client.mutation('crqIndicators.enqueueSimulation', { riskScenarioId }, { tenantId });

    const state = await client.query('treatmentPlans.getTreatmentPlanSimulationState', { planId }, { tenantId });
    const res = await client.mutation('treatmentPlans.resimulateTreatmentPlanScenarios', { planId }, { tenantId });

    expect(state.json.result.data).toEqual({ toRepriceCount: 0, runningCount: 0 });
    expect(res.json.result.data).toEqual({ queuedCount: 0 });
    expect(await simulationJobs()).toHaveLength(1);
  });

  it('should neither read nor re-simulate a plan of another tenant', async () => {
    const planId = await createPlan(true);
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

    const state = await client.query('treatmentPlans.getTreatmentPlanSimulationState', { planId }, { tenantId: otherTenantId });
    const res = await client.mutation('treatmentPlans.resimulateTreatmentPlanScenarios', { planId }, { tenantId: otherTenantId });

    expect(state.json.result.data).toBeNull();
    expect(res.status).toBe(404);
    expect(await simulationJobs()).toHaveLength(0);
  });
});
