import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { openctiMirrorRebuildHandler } from './opencti-mirror-rebuild-handler';

export const OPENCTI_MIRROR_REBUILD_JOB = 'opencti-mirror-rebuild';

registerFeature({
  key: 'opencti-mirror-rebuild',
  activate: () => {
    // Observed and not daily: the marks say what is left to do, so the payload is always `{}` and
    // the dedup index folds a second enqueue into the one already queued.
    jobRuntimeEngine.registerHandler(OPENCTI_MIRROR_REBUILD_JOB, openctiMirrorRebuildHandler, { observed: true });
  },
});
