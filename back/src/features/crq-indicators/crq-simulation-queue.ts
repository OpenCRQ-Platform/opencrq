import type { allServiceDefinitions, createServices, CrqRunProfile, EventOrigin, TriggeredBy } from '@app/module';
import { FULL_RUN_PROFILE, originJobTag, originTrigger } from '@app/module';
import type { CrqBaselinePayload } from './crq-simulation-origin';
import { createLogger } from '../../utils/logger';
import { recordRecomputeAsk } from '../../utils/recompute-metrics';

const { logTrace } = createLogger({ feature: 'crq-simulation' });

export const CRQ_SIMULATION_JOB = 'crq-simulation';

/**
 * One active simulation per scenario. Shared with the user-triggered enqueue so a click and a
 * downstream ask fold into the same run rather than racing to write the same scenario's figures.
 * An ask folding into that run widens its profile to compute both, so no ask is lost to the fold.
 */
export const crqSimulationIdempotencyKey = (riskScenarioId: string): string =>
  `${CRQ_SIMULATION_JOB}-${riskScenarioId}`;

type AnyServices = ReturnType<ReturnType<typeof createServices<typeof allServiceDefinitions>>['withOrigin']>;
type JobEnqueuer = Pick<AnyServices, 'jobs'>;
type RequestingOrigin = Extract<EventOrigin, { type: 'client' | 'connector' }>;

interface SimulationTrigger {
  triggeredBy: TriggeredBy,
  triggeredById?: string,
  interactive: boolean,
}

const enqueueCrqSimulation = async (
  services: JobEnqueuer,
  tenantId: string,
  riskScenarioId: string,
  trigger: SimulationTrigger,
  why: string,
  profile: CrqRunProfile = FULL_RUN_PROFILE,
): Promise<void> => {
  // Typed against the handler's own contract: `enqueueJob` takes an untyped payload, and a shape
  // the handler cannot read fails only at run time, in the dead-letter queue.
  const payload: CrqBaselinePayload = { riskScenarioId, profile };
  const { alreadyExisted } = await services.jobs.enqueueJob({
    kind: CRQ_SIMULATION_JOB,
    tenantId,
    payload,
    idempotencyKey: crqSimulationIdempotencyKey(riskScenarioId),
    ...trigger,
  });
  recordRecomputeAsk('followup', CRQ_SIMULATION_JOB, alreadyExisted);
  logTrace(why, { kind: CRQ_SIMULATION_JOB, tenantId, riskScenarioId, alreadyExisted });
};

/**
 * A run someone asked for from a screen. It carries the caller in its payload so it runs under their
 * authorization, and it is interactive whoever asked: a service account waits on it as a person does.
 */
export const enqueueRequestedCrqSimulation = async (
  services: JobEnqueuer,
  origin: RequestingOrigin,
  riskScenarioId: string,
  profile: CrqRunProfile = FULL_RUN_PROFILE,
): Promise<{ jobId: string }> => {
  const payload: CrqBaselinePayload = origin.type === 'client'
    ? { riskScenarioId, userId: origin.userId, profile }
    : { riskScenarioId, serviceAccountId: origin.serviceAccountId, profile };
  const { jobId } = await services.jobs.enqueueJob({
    kind: CRQ_SIMULATION_JOB,
    tenantId: origin.tenantId,
    payload,
    idempotencyKey: crqSimulationIdempotencyKey(riskScenarioId),
    ...originTrigger(origin),
    interactive: true,
  });
  return { jobId };
};

/**
 * The full run a questionnaire-driven recompute books for a scenario whose estimates it moved. Any
 * estimate write, the analyst's own included, already wakes the price job, so this booking is what
 * refreshes the levers, the technique values and the plans.
 *
 * Callers pass only the scenarios whose amounts actually moved, never every scenario they walked:
 * that is what bounds a questionnaire save to the risk scope it changed.
 */
export const enqueueCrqSimulationForEstimatesChange = (
  services: JobEnqueuer,
  origin: EventOrigin,
  tenantId: string,
  riskScenarioId: string,
): Promise<void> => enqueueCrqSimulation(services, tenantId, riskScenarioId, {
  triggeredBy: 'event',
  // The recompute that asks for this is the one the scenario's staleness notice is waiting on,
  // so the figures it rewrites owe the reader the same window their own edit would get.
  interactive: originJobTag(origin)?.interactive ?? false,
}, 'CRQ simulation asked after a loss-estimate write');

/**
 * The ask a scope posture declaration owes to each scenario of that scope priced against the
 * control. The save that moved the posture is the one whose result the page is about to show.
 */
export const enqueueCrqSimulationForPostureChange = (
  services: JobEnqueuer,
  origin: EventOrigin,
  tenantId: string,
  riskScenarioId: string,
): Promise<void> => enqueueCrqSimulationForSubjectChange(
  services, origin, tenantId, riskScenarioId, FULL_RUN_PROFILE, 'CRQ simulation asked after a scope posture write',
);

/** A person's save is waited on by the page that made it, a job's change only when the job itself was. */
export const enqueueCrqSimulationForSubjectChange = (
  services: JobEnqueuer,
  origin: EventOrigin,
  tenantId: string,
  riskScenarioId: string,
  profile: CrqRunProfile,
  why: string,
): Promise<void> => {
  const jobTag = origin.type === 'job' ? originJobTag(origin) : undefined;
  return enqueueCrqSimulation(services, tenantId, riskScenarioId, jobTag === undefined
    ? { ...originTrigger(origin), interactive: true }
    : { triggeredBy: 'event', interactive: jobTag.interactive }, why, profile);
};
