import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { createLogger } from '../../utils/logger';
import { imageVersion } from '../../utils/platform-version';

const { logTrace } = createLogger({ feature: 'crq-simulation' });

export const CRQ_PRICE_RECOMPUTE_JOB = 'crq-price-recompute';

/**
 * Well inside the job's runtime limit: a pass over every scenario of a large tenant outlives it, and
 * a retry would start over from the first scenario, so the tail would never be priced.
 */
export const CRQ_PRICE_PASS_BUDGET_MS = 5 * 60 * 1000;

interface CrqPricePassState extends Record<string, unknown> {
  after?: string,
}

export const crqPriceRecomputeHandler: JobHandler<Record<string, unknown>, CrqPricePassState> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    throw newError('crq price recompute must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const pass = await services.crqIndicators.priceAllScenarios(ctx.tenantId, ctx.signal, ctx.jobId, {
    appVersion: imageVersion(),
    after: ctx.state?.after,
    budgetMs: CRQ_PRICE_PASS_BUDGET_MS,
  });
  if (pass === null) {
    return;
  }
  logTrace('Scenarios repriced', {
    tenantId: ctx.tenantId,
    priced: pass.priced,
    unchanged: pass.unchanged,
    skipped: pass.skipped,
    refused: pass.refused.length,
    resumeAfter: pass.resumeAfter,
  });
  for (const { riskScenarioId, reason } of pass.refused) {
    logTrace('Scenario left unpriced', { tenantId: ctx.tenantId, riskScenarioId, reason });
  }
  return pass.resumeAfter === null ? undefined : { continuation: true, state: { after: pass.resumeAfter } };
};
