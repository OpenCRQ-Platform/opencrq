import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { primaryAssetReachRecomputeHandler } from './primary-asset-reach-recompute-handler';

export const PRIMARY_ASSET_REACH_RECOMPUTE_JOB = 'primary-asset-reach-recompute';

registerFeature({
  key: 'primary-asset-reach',
  activate: () => {
    // Observed and never daily: the reach reads no clock, so a link, a primary asset or its
    // organization changing is the only thing that can make it stale.
    jobRuntimeEngine.registerHandler(
      PRIMARY_ASSET_REACH_RECOMPUTE_JOB,
      primaryAssetReachRecomputeHandler,
      { observed: true },
    );
  },
});
