import { assertOutcomeCounterModelPresent } from '@app/module';
import { registerEngine } from '../../engines/engines-manager';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { threatBundleAnalysisHandler } from './threat-bundle-analysis-handler';
import { THREAT_BUNDLE_OUTCOME_RESCORE_JOB, threatBundleOutcomeRescoreHandler } from './threat-bundle-outcome-rescore-handler';

registerFeature({
  key: 'threat-parser',
  activate: () => {
    // Only the processes that run the ingestion handlers import this feature, and each of them
    // scores threats with the model.
    registerEngine({
      key: 'outcome-counter-model',
      start: () => {
        assertOutcomeCounterModelPresent();
        return {};
      },
    });
    jobRuntimeEngine.registerHandler('threat-bundle-analysis', threatBundleAnalysisHandler);
    jobRuntimeEngine.registerHandler(THREAT_BUNDLE_OUTCOME_RESCORE_JOB, threatBundleOutcomeRescoreHandler);
  },
});
