import type { JobCatalogueKind } from '@app/module';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { provenPostureRecordHandler } from './proven-posture-record-handler';

export const PROVEN_POSTURE_RECORD_JOB = 'proven-posture-record' satisfies JobCatalogueKind;

registerFeature({
  key: 'proven-posture-record',
  activate: () => {
    jobRuntimeEngine.registerHandler(PROVEN_POSTURE_RECORD_JOB, provenPostureRecordHandler, { observed: true, daily: true });
  },
});
