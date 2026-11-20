import type { allServiceDefinitions, CoverageBucket, createServices, EventOrigin, ScenarioControls, StrengthRung } from '@app/module';
import { createLogger } from '../../../../utils/logger';
import { enqueueCrqSimulationForPostureChange } from '../../../crq-indicators/crq-simulation-queue';

const { logFromError } = createLogger({ feature: 'scope-posture-recompute' });

export interface ScopePostureSnapshot {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
}

const postureVersion = (posture: ScopePostureSnapshot | undefined): string =>
  `${posture?.strengthRung ?? 'inherit'}|${posture?.coverageBucket ?? 'inherit'}`;

type AnyServices = ReturnType<ReturnType<typeof createServices<typeof allServiceDefinitions>>['withOrigin']>;
type RecomputeServices = Pick<AnyServices, 'crqIndicators' | 'jobs'>;

/**
 * Runs after the declaration committed, so every failure here is caught on its own: a broken lookup
 * or queue must not cost the user the declaration they already made, nor stop the other scenarios'
 * runs. Two saves in a row queue a scenario once, on the key its own Run click uses.
 *
 * It books a full run, which already computes every lever.
 */
export const enqueueCrqSimulationOnScopePostureChange = async (
  services: RecomputeServices,
  origin: EventOrigin,
  tenantId: string,
  organizationId: string,
  capabilityId: string,
  before: ScopePostureSnapshot | undefined,
  after: ScopePostureSnapshot | undefined,
): Promise<void> => {
  if (postureVersion(before) === postureVersion(after)) {
    return;
  }
  let scenarios: Array<ScenarioControls>;
  try {
    scenarios = await services.crqIndicators.getScenariosPricedAgainstCapabilities([capabilityId], organizationId, tenantId);
  } catch (error: unknown) {
    logFromError(error, 'Failed to resolve the scenarios a scope posture change reprices', { capabilityId, organizationId });
    return;
  }
  await Promise.all(scenarios.map(({ riskScenarioId }) =>
    enqueueCrqSimulationForPostureChange(services, origin, tenantId, riskScenarioId)
      .catch((error: unknown) => {
        logFromError(error, 'Failed to enqueue crq-simulation job', { riskScenarioId });
      })));
};
