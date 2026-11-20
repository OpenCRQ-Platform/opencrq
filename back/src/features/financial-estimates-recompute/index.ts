import { config } from '../../config';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerEngine } from '../../engines/engines-manager';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { financialEstimatesRecomputeHandler, sweepFinancialEstimates } from './financial-estimates-recompute-handler';
import { FINANCIAL_ESTIMATES_RECOMPUTE_JOB } from './financial-estimates-recompute-queue';

const { logFromError } = createLogger({ engine: 'financial-estimates-recompute' });

/** Bounds what a missed recompute costs, the places that owe one being many. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// An engine, not the feature's `activate`: features are activated before engines start, and the
// sweep reads tenants from a database that is not connected yet at that point.
registerEngine({
  key: 'financial-estimates-recompute',
  start: (signal) => {
    // The sweep only books work; a process with no job runtime would queue rows nobody claims.
    if (!config().jobs?.enabled) {
      return {};
    }

    const sweep = () => {
      void sweepFinancialEstimates().catch((error) => logFromError(error, 'Financial estimates sweep failed'));
    };
    const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
    signal.addEventListener('abort', () => clearInterval(timer));

    return {
      // Also the backfill: a deployment upgrading into the projection has no derived estimate at all.
      onEnginesStarted: sweep,
      stop: () => clearInterval(timer),
    };
  },
});

registerFeature({
  key: 'financial-estimates-recompute',
  activate: () => {
    // No `cron` here: the framework's own per-job cron cannot carry `backfillOnly`, so its periodic
    // catch-up would fully recompute every row on a timer, letting a coefficient-set version bump
    // apply outside an explicit recompute. The engine's own interval above is the safe substitute.
    jobRuntimeEngine.registerHandler(FINANCIAL_ESTIMATES_RECOMPUTE_JOB, financialEstimatesRecomputeHandler, { observed: true });
  },
});
