import type { allServiceDefinitions, createServices, EventOrigin } from '@app/module';
import { originTrigger } from '@app/module';
import { createLogger } from '../../utils/logger';
import { recordRecomputeAsk } from '../../utils/recompute-metrics';

const { logTrace } = createLogger({ feature: 'financial-estimates-recompute' });

export const FINANCIAL_ESTIMATES_RECOMPUTE_JOB = 'financial-estimates-recompute';

type AnyServices = ReturnType<ReturnType<typeof createServices<typeof allServiceDefinitions>>['withOrigin']>;
type JobEnqueuer = Pick<AnyServices, 'jobs'>;

/**
 * The periodic/boot-time sweep's own ask. `backfillOnly` carries through to the handler, which only
 * fills a driver with no row at all — it can never promote an already-derived row onto a newer
 * coefficient set, which a coefficient-set version bump must not do outside an explicit recompute.
 */
export const enqueueFinancialEstimatesBackfill = async (
  services: JobEnqueuer,
  tenantId: string,
): Promise<void> => {
  const { alreadyExisted } = await services.jobs.enqueueJob({
    kind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB,
    tenantId,
    payload: { backfillOnly: true },
    triggeredBy: 'system',
  });
  recordRecomputeAsk('sweep', FINANCIAL_ESTIMATES_RECOMPUTE_JOB, alreadyExisted);
  logTrace('Backfill recompute asked', { kind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, tenantId, alreadyExisted });
};

/**
 * A recompute asked for one named scenario, which is what a freshly created one needs before the
 * analyst reaches its Financial Impact tab. A non-empty payload, so it never dedupes against the
 * dispatcher's own `payload: {}` asks (`recompute-dispatcher/index.ts`) — a minor efficiency cost,
 * not a correctness one. The periodic/boot-time sweep above sends its own distinct
 * `payload: { backfillOnly: true }`, so it was never the dedup target here either.
 */
export const enqueueScenarioRecompute = async (
  services: JobEnqueuer,
  origin: EventOrigin,
  tenantId: string,
  riskScenarioId: string,
): Promise<void> => {
  const { alreadyExisted } = await services.jobs.enqueueJob({
    kind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB,
    tenantId,
    payload: { riskScenarioId },
    ...originTrigger(origin),
    interactive: true,
  });
  recordRecomputeAsk('manual', FINANCIAL_ESTIMATES_RECOMPUTE_JOB, alreadyExisted);
  logTrace('Manual scenario recompute asked', { kind: FINANCIAL_ESTIMATES_RECOMPUTE_JOB, tenantId, riskScenarioId, alreadyExisted });
};
