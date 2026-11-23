import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { dependencyRulesApplyHandler } from './dependency-rules-apply-handler';

export const DEPENDENCY_RULES_APPLY_JOB = 'dependency-rules-apply';

registerFeature({
  key: 'dependency-rules',
  activate: () => {
    // Observed and never daily: the rules read no clock, so a sync changing the inventory or a rule
    // changing is the only thing that can make the rule links stale.
    jobRuntimeEngine.registerHandler(
      DEPENDENCY_RULES_APPLY_JOB,
      dependencyRulesApplyHandler,
      { observed: true },
    );
  },
});
