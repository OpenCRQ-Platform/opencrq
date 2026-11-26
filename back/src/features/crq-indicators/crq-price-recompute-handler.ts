import type { JobHandler, ScenarioAleMove, ScenarioPricingPass } from '@app/module';
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

/**
 * The moved scenarios a run names, in `moved` and `movedAle` alike; `movedCount` keeps counting past it.
 * A scenario re-priced to the same ALE mean is in `priced` only, never in `moved` nor `movedCount`.
 */
export const CRQ_PRICE_MOVED_IDS_CAP = 100;

/**
 * What a chain of passes has done so far, carried from one run to its continuation so the last run
 * of the chain reports the whole pass.
 */
interface CrqPriceTotals {
  walked: number,
  priced: number,
  unchanged: number,
  sameResult: number,
  skipped: number,
  refused: number,
  moved: Array<string>,
  /**
   * The ALE mean before and after each scenario of `moved`, in the same order, and the delta. A
   * chain resumed from a state written before it existed starts it empty.
   */
  movedAle: Array<ScenarioAleMove>,
  movedCount: number,
}

interface CrqPricePassState extends Record<string, unknown> {
  after?: string,
  // A continuation booked by an image from before `movedAle` carries totals without it.
  totals?: Omit<CrqPriceTotals, 'movedAle'> & Partial<Pick<CrqPriceTotals, 'movedAle'>>,
}

/**
 * The run's progress message once the pass stops: what it re-priced, as JSON, so a reader of the run
 * tells a pass that moved prices (`priced` above 0, `moved` naming the scenarios) from one that moved
 * nothing without reading every scenario. `complete` is false on a run that booked a continuation:
 * the next run of the chain carries the totals on.
 */
interface CrqPriceRunSummary extends CrqPriceTotals {
  complete: boolean,
}

const NO_TOTALS: CrqPriceTotals = { walked: 0, priced: 0, unchanged: 0, sameResult: 0, skipped: 0, refused: 0, moved: [], movedAle: [], movedCount: 0 };

const addPassToTotals = (totals: CrqPriceTotals, pass: ScenarioPricingPass): CrqPriceTotals => ({
  walked: totals.walked + pass.walked,
  priced: totals.priced + pass.priced,
  unchanged: totals.unchanged + pass.unchanged,
  sameResult: totals.sameResult + pass.sameResult,
  skipped: totals.skipped + pass.skipped,
  refused: totals.refused + pass.refused.length,
  moved: [...totals.moved, ...pass.moved].slice(0, CRQ_PRICE_MOVED_IDS_CAP),
  movedAle: [...totals.movedAle, ...pass.movedAle].slice(0, CRQ_PRICE_MOVED_IDS_CAP),
  movedCount: totals.movedCount + pass.moved.length,
});

export const crqPriceRecomputeHandler: JobHandler<Record<string, unknown>, CrqPricePassState> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    throw newError('crq price recompute must run as an observed job', { kind: ctx.kind });
  }
  const carried = ctx.state?.totals;
  const before: CrqPriceTotals = carried ? { ...carried, movedAle: carried.movedAle ?? [] } : NO_TOTALS;
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const pass = await services.crqIndicators.priceAllScenarios(ctx.tenantId, ctx.signal, ctx.jobId, {
    appVersion: imageVersion(),
    after: ctx.state?.after,
    budgetMs: CRQ_PRICE_PASS_BUDGET_MS,
    // The chain's figures: what the runs before this one walked counts in both.
    onProgress: ({ walked, total }) => ctx.updateProgress({
      processedTotal: before.walked + walked,
      expectedTotal: before.walked + total,
    }),
  });
  if (pass === null) {
    return;
  }
  const totals = addPassToTotals(before, pass);
  const summary: CrqPriceRunSummary = { ...totals, complete: pass.resumeAfter === null };
  await ctx.updateProgress({
    processedTotal: totals.walked,
    expectedTotal: before.walked + pass.total,
    message: JSON.stringify(summary),
  });
  logTrace('Scenarios repriced', {
    tenantId: ctx.tenantId,
    priced: pass.priced,
    unchanged: pass.unchanged,
    sameResult: pass.sameResult,
    skipped: pass.skipped,
    refused: pass.refused.length,
    resumeAfter: pass.resumeAfter,
  });
  for (const { riskScenarioId, reason } of pass.refused) {
    logTrace('Scenario left unpriced', { tenantId: ctx.tenantId, riskScenarioId, reason });
  }
  return pass.resumeAfter === null ? undefined : { continuation: true, state: { after: pass.resumeAfter, totals } };
};
