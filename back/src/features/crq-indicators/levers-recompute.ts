import type { allServiceDefinitions, createServices, EventOrigin, PostureCrossing, ScenarioControls } from '@app/module';
import { leversRunProfile } from '@app/module';
import { createLogger } from '../../utils/logger';
import { enqueueCrqSimulationForSubjectChange } from './crq-simulation-queue';

const { logFromError } = createLogger({ feature: 'crq-levers-recompute' });

type AnyServices = ReturnType<ReturnType<typeof createServices<typeof allServiceDefinitions>>['withOrigin']>;
type RecomputeServices = Pick<AnyServices, 'crqIndicators' | 'jobs'>;

/** Each booking fails on its own, so one broken enqueue does not cost the other scenarios their figures. */
const enqueueLeversRecompute = async (
  services: Pick<AnyServices, 'jobs'>,
  origin: EventOrigin,
  tenantId: string,
  scenarios: ReadonlyArray<ScenarioControls>,
): Promise<void> => {
  await Promise.all(scenarios.map(({ riskScenarioId, controlIds }) =>
    enqueueCrqSimulationForSubjectChange(
      services, origin, tenantId, riskScenarioId, leversRunProfile(controlIds), 'CRQ levers asked after a control posture move',
    ).catch((error: unknown) => {
      logFromError(error, 'Failed to enqueue the levers of a moved control', { riskScenarioId, controlIds });
    })));
};

/**
 * Runs after the posture write committed, so a failure here is logged and never undoes the
 * declaration the user already made.
 */
export const enqueueLeversOnTenantCrossings = async (
  services: RecomputeServices,
  origin: EventOrigin,
  tenantId: string,
  crossings: ReadonlyArray<PostureCrossing>,
): Promise<void> => {
  if (crossings.length === 0) {
    return;
  }
  let scenarios: Array<ScenarioControls>;
  try {
    scenarios = await services.crqIndicators.getScenariosRepricedByCrossings(crossings, tenantId);
  } catch (error: unknown) {
    logFromError(error, 'Failed to resolve the scenarios a control posture move reprices', {
      capabilityIds: crossings.map((crossing) => crossing.capabilityId),
    });
    return;
  }
  await enqueueLeversRecompute(services, origin, tenantId, scenarios);
};
