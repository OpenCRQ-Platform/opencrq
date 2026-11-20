import type { allServiceDefinitions, createServices, EventOrigin } from '@app/module';
import { planRunProfile } from '@app/module';
import { createLogger } from '../../../utils/logger';
import { enqueueRequestedCrqSimulation } from '../../crq-indicators/crq-simulation-queue';

const { logFromError } = createLogger({ feature: 'treatment-plan-recompute' });

type AnyServices = ReturnType<ReturnType<typeof createServices<typeof allServiceDefinitions>>['withOrigin']>;
type RecomputeServices = Pick<AnyServices, 'treatmentPlans' | 'jobs'>;
type RequestingOrigin = Extract<EventOrigin, { type: 'client' | 'connector' }>;

/** The moves are committed when this runs, so a failure is logged and never undoes the save. */
export const enqueuePlanRecompute = async (
  services: RecomputeServices,
  origin: RequestingOrigin,
  planId: string,
): Promise<void> => {
  let toReprice: Array<string>;
  try {
    toReprice = (await services.treatmentPlans.getTreatmentPlanSimulationScope(planId))?.toReprice ?? [];
  } catch (error: unknown) {
    logFromError(error, 'Failed to resolve the scenarios a plan save reprices', { planId });
    return;
  }
  await Promise.all(toReprice.map((riskScenarioId) =>
    enqueueRequestedCrqSimulation(services, origin, riskScenarioId, planRunProfile(planId))
      .catch((error: unknown) => {
        logFromError(error, 'Failed to enqueue the run of a saved plan', { planId, riskScenarioId });
      })));
};
