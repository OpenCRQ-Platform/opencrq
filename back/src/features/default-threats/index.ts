import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { DEFAULT_THREATS_SYNC_JOB, defaultThreatsSyncHandler } from './default-threats-sync-handler';

registerFeature({
  key: 'default-threats',
  activate: () => {
    jobRuntimeEngine.registerHandler(DEFAULT_THREATS_SYNC_JOB, defaultThreatsSyncHandler, { serialized: true });
  },
});
