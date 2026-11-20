import { registerEngine } from '../../engines/engines-manager';
import { registerFeature } from '../features-manager';
import { startAll } from './opencti-connector-manager';

const OPENCTI_FEATURE_KEY = 'opencti';

registerFeature({
  key: OPENCTI_FEATURE_KEY,
  activate: () => {
    // Deferred to `onEnginesStarted` so this doesn't race the DB engine's migration
    // (the manager queries `opencti_connector_settings` on boot).
    registerEngine({
      key: OPENCTI_FEATURE_KEY,
      start: (signal) => ({
        onEnginesStarted: () => startAll(signal),
      }),
    });
  },
});
