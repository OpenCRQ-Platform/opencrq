import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { noopHandler } from './noop-handler';

registerFeature({
  key: 'jobs',
  activate: () => {
    jobRuntimeEngine.registerHandler('noop', noopHandler);
  },
});
