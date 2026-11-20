import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { threatActivityRecomputeHandler } from './threat-activity-recompute-handler';

export const THREAT_ACTIVITY_RECOMPUTE_JOB = 'threat-activity-recompute';

registerFeature({
  key: 'threat-activity',
  activate: () => {
    jobRuntimeEngine.registerHandler(
      THREAT_ACTIVITY_RECOMPUTE_JOB,
      threatActivityRecomputeHandler,
      { observed: true, daily: true },
    );
  },
});
