import { CONNECTOR_INVENTORY } from '@app/module';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { drataSyncHandler } from './drata-sync-handler';

registerFeature({
  key: 'drata-sync',
  activate: () => {
    jobRuntimeEngine.registerHandler(CONNECTOR_INVENTORY.drata.jobKind, drataSyncHandler, { serialized: true });
  },
});
