import type { CrqRunProfile, EventOrigin } from '@app/module';
import { FULL_RUN_PROFILE, leversRunProfile, planRunProfile } from '@app/module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The queue reaches the logger through the backend config, which the shared setup stubs out.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const { enqueueLeversOnTenantCrossings } = await import('@app/back/src/features/crq-indicators/levers-recompute');
const { enqueueCrqSimulationOnScopePostureChange } = await import('@app/back/src/features/app-router/controls/capability/scope-posture-recompute');
const { enqueuePlanRecompute } = await import('@app/back/src/features/app-router/treatment-plans/plan-recompute');

const services = createTestServices(db);

describe('booking the levers of a moved control and the run of a saved plan', () => {
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let controlId: string;

  const scoped = () => services.withOrigin(adminOrigin);
  const expectBooked = async (...profiles: Array<CrqRunProfile>) => expect(
    (await scoped().jobs.listJobs({ tenantId, kind: 'crq-simulation' })).map((job) => job.payload),
  ).toEqual(profiles.map((profile) => expect.objectContaining({ profile })));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 100 });
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId));
    const { result } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
    controlId = result.controlValues.find((value) => value.declaredStrengthRung === 'L2')!.controlId;
  });

  it('should book the levers of that control alone on the scenarios priced against it', async () => {
    const crossings = await scoped().controlCapabilities.upsertAssessment(controlId, 'L3', null, null);

    await enqueueLeversOnTenantCrossings(scoped(), adminOrigin, tenantId, crossings);

    await expectBooked(leversRunProfile([controlId]));
  });

  it('should book nothing for a save that moved no rung or bucket', async () => {
    const crossings = await scoped().controlCapabilities.upsertAssessment(controlId, 'L2', 'L2', 'Same posture, new comment');

    await enqueueLeversOnTenantCrossings(scoped(), adminOrigin, tenantId, crossings);

    await expectBooked();
  });

  it('should book a single full run for a scope posture save', async () => {
    await enqueueCrqSimulationOnScopePostureChange(
      scoped(), adminOrigin, tenantId, organizationId, controlId,
      undefined, { strengthRung: 'L1', coverageBucket: null },
    );

    await expectBooked(FULL_RUN_PROFILE);
  });

  it('should book a saved plan alone on its scope\'s scenarios', async () => {
    const planId = await scoped().treatmentPlans.createTreatmentPlan({ organizationId, name: 'Raise one control' });
    await scoped().treatmentPlans.setTreatmentPlanScope(planId, [{ capabilityId: controlId, targetStrengthRung: 'L3', targetCoverageBucket: null }]);

    await enqueuePlanRecompute(scoped(), adminOrigin, planId);

    await expectBooked(planRunProfile(planId));
  });
});
