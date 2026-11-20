import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { attackOutcomeMixtureRecomputeHandler } from './attack-outcome-mixture-recompute-handler';

export const ATTACK_OUTCOME_MIXTURE_RECOMPUTE_JOB = 'attack-outcome-mixture-recompute';

registerFeature({
  key: 'attack-outcome-mixture',
  activate: () => {
    jobRuntimeEngine.registerHandler(
      ATTACK_OUTCOME_MIXTURE_RECOMPUTE_JOB,
      attackOutcomeMixtureRecomputeHandler,
      { observed: true, daily: true },
    );
  },
});
