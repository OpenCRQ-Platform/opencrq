import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { openaevSyncHandler } from './openaev-sync-handler';

registerFeature({
  key: 'openaev-sync',
  activate: () => {
    jobRuntimeEngine.registerHandler('openaev-findings-sync', openaevSyncHandler, { serialized: true });
  },
});
