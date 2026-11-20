import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { jobsRetentionHandler } from './retention-handler';

registerFeature({
  key: 'jobs-retention',
  activate: () => {
    jobRuntimeEngine.registerHandler('jobs-retention', jobsRetentionHandler, { daily: true });
  },
});
