import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { graphSyncHandler } from './graph-sync-handler';

registerFeature({
  key: 'microsoft-graph',
  activate: () => {
    jobRuntimeEngine.registerHandler('microsoft-graph-sync', graphSyncHandler, { serialized: true });
  },
});
