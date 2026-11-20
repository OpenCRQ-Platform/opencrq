import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { findingScoreRecomputeHandler } from './finding-score-recompute-handler';
import { FINDING_SCORE_RECOMPUTE_JOB } from './finding-score-recompute-queue';

export { FINDING_SCORE_RECOMPUTE_JOB };

registerFeature({
  key: 'finding-score',
  activate: () => {
    jobRuntimeEngine.registerHandler(FINDING_SCORE_RECOMPUTE_JOB, findingScoreRecomputeHandler, { observed: true, daily: true });
  },
});
