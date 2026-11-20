import { existsSync } from 'node:fs';
import path from 'node:path';
import { dbEngine } from '../../engines/db';
import { httpServerEngine } from '../../engines/http-server';
import { resolveRequestAuth } from '../../trpc';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { registerMapRoutes } from './maps-routes';

const { logError } = createLogger({ feature: 'maps' });

// The build copies `static/maps` next to the bundle.
const MAPS_ROOT = path.join(__dirname, 'maps');

registerFeature({
  key: 'maps',
  activate: () => {
    if (!existsSync(MAPS_ROOT)) {
      logError(`Map files not found at ${MAPS_ROOT}: threat maps will show no base map`);
      return;
    }
    httpServerEngine.registerHttpRoutes((server) => {
      registerMapRoutes(server, { root: MAPS_ROOT, resolveAuth: resolveRequestAuth(dbEngine.db) });
    });
  },
});
