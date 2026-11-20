import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { assetCriticalityLiftRecomputeHandler } from './asset-criticality-lift-recompute-handler';

export const ASSET_CRITICALITY_LIFT_RECOMPUTE_JOB = 'asset-criticality-lift-recompute';

registerFeature({
  key: 'asset-criticality-lift',
  activate: () => {
    // Observed and never daily: the lift reads no clock, so what a sync or a hand-set band writes is
    // the only thing that can make it stale.
    jobRuntimeEngine.registerHandler(
      ASSET_CRITICALITY_LIFT_RECOMPUTE_JOB,
      assetCriticalityLiftRecomputeHandler,
      { observed: true },
    );
  },
});
