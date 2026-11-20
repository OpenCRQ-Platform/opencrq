import type { JobCatalogueKind } from '@app/module';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { capabilityDerivationHandler } from './capability-derivation-handler';

export const CAPABILITY_DERIVATION_JOB = 'capability-derivation' satisfies JobCatalogueKind;

registerFeature({
  key: 'capability-derivation',
  activate: () => {
    jobRuntimeEngine.registerHandler(CAPABILITY_DERIVATION_JOB, capabilityDerivationHandler, { observed: true, daily: true });
  },
});
