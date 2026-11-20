import type { EventOrigin, JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { enqueueCrqSimulationForEstimatesChange } from '../crq-indicators/crq-simulation-queue';
import { enqueueFinancialEstimatesBackfill } from './financial-estimates-recompute-queue';

const { logFromError, logTrace } = createLogger({ engine: 'job-runtime' });

const appServices = (origin: EventOrigin) =>
  createServices([...allServiceDefinitions], dbEngine.db).withOrigin(origin);

export const sweepFinancialEstimates = async (): Promise<void> => {
  const services = appServices({ type: 'system' });
  const tenants = await services.tenants.getTenants();
  for (const tenant of tenants) {
    await enqueueFinancialEstimatesBackfill(services, tenant.id);
  }
  logTrace('Financial estimates backfill enqueued', { tenants: tenants.length });
};

interface FinancialEstimatesRecomputePayload {
  riskScenarioId?: string,
  backfillOnly?: boolean,
}

export const financialEstimatesRecomputeHandler: JobHandler<FinancialEstimatesRecomputePayload> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('financial-estimates recompute must run as an observed job', { kind: ctx.kind });
  }
  const origin: EventOrigin = { type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive };
  const services = createServices([...allServiceDefinitions], ctx.runDb).withOrigin(origin);
  // Queue work goes through the shared instance, never `runDb`: `enqueueJob` reads `jobs` to
  // deduplicate, and an explicitly observed read set is not filtered of runtime tables, so booking
  // a follow-up here would subscribe this job kind to `jobs` and have every lease renewal ask for
  // it again.
  const queueServices = appServices(origin);

  if (ctx.payload.riskScenarioId) {
    const { recomputed, changed } = await services.scenarioLossEstimates.recomputeQuestionnaireEstimatesForScenario(ctx.payload.riskScenarioId);
    if (changed) {
      await enqueueCrqSimulationForEstimatesChange(queueServices, origin, ctx.tenantId, ctx.payload.riskScenarioId);
    }
    logTrace('Financial estimates recomputed for one scenario', { tenantId: ctx.tenantId, riskScenarioId: ctx.payload.riskScenarioId, recomputed, changed });
    return;
  }

  const backfillOnly = ctx.payload.backfillOnly ?? false;
  const { recomputedScenarios, failedScenarios, changedScenarioIds } = await services.scenarioLossEstimates.recomputeQuestionnaireEstimates({
    backfillOnly,
    signal: ctx.signal,
  });
  // The loss magnitude the last CRQ run priced has moved, so its ALE now quotes a figure the
  // Financial Impact page no longer shows. Only the scenarios whose amounts actually changed, so a
  // save on one risk scope leaves every other scope's runs alone.
  //
  // Each ask stands alone: the list only exists in this call's memory, and the estimates are
  // already committed, so a retry would recompute them, find nothing changed and hand back an
  // empty list. One failing enqueue must therefore not carry the rest of the list down with it.
  for (const riskScenarioId of changedScenarioIds) {
    try {
      await enqueueCrqSimulationForEstimatesChange(queueServices, origin, ctx.tenantId, riskScenarioId);
    } catch (error) {
      logFromError(error, 'Could not ask for a CRQ simulation after a loss-estimate change', { tenantId: ctx.tenantId, riskScenarioId });
    }
  }
  logTrace('Financial estimates recomputed', { tenantId: ctx.tenantId, recomputedScenarios, failedScenarios, backfillOnly, resimulated: changedScenarioIds.length });
  // An organization holding a failed scenario keeps its recompute marker behind its answers, so
  // the notice on every one of its scenarios stays up and no user action clears it. Failing the run
  // is what puts it back in the runtime's hands: retried, then dead-lettered where it shows. The
  // replay this costs is bounded by the run's own attempt limit; the notice it spares the reader is
  // not bounded by anything, since no action on the platform clears it.
  if (failedScenarios > 0) {
    throw newError('financial-estimates recompute left scenarios unrefreshed', { tenantId: ctx.tenantId, failedScenarios, recomputedScenarios });
  }
};
