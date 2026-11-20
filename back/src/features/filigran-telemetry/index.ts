// Importing the engine barrel registers the filigran-telemetry engine; the
// feature entry makes the activation explicit in the boot log.
import '../../engines/filigran-telemetry';
import { registerFeature } from '../features-manager';

registerFeature({
  key: 'filigran-telemetry',
  activate: () => {
    // Nothing to wire at activation: the engine starts collecting once all
    // engines are started (it needs the db engine to be ready).
  },
});
