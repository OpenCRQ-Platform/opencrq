import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { threatListProjectionRecomputeHandler } from './threat-list-projection-recompute-handler';

export const THREAT_LIST_PROJECTION_RECOMPUTE_JOB = 'threat-list-projection-recompute';

registerFeature({
  key: 'threat-list-projection',
  activate: () => {
    jobRuntimeEngine.registerHandler(
      THREAT_LIST_PROJECTION_RECOMPUTE_JOB,
      threatListProjectionRecomputeHandler,
      { observed: true },
    );
  },
});
