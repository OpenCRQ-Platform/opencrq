import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { THREAT_OUTCOME_COUNTER_RECOMPUTE_JOB, threatOutcomeCounterRecomputeHandler } from './threat-outcome-counter-recompute-handler';

registerFeature({
  key: 'threat-outcome-counter',
  activate: () => {
    jobRuntimeEngine.registerHandler(
      THREAT_OUTCOME_COUNTER_RECOMPUTE_JOB,
      threatOutcomeCounterRecomputeHandler,
      { observed: true, daily: true },
    );
  },
});
