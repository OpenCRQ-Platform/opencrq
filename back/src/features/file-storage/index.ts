import { fileStorageClient, getFileStorageSettings } from '../../clients/file-storage';
import { dbEngine } from '../../engines/db';
import { httpServerEngine } from '../../engines/http-server';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { registerFileStorageDownloadRoute } from './file-storage-download-route';

const { logTrace } = createLogger({ feature: 'file-storage' });

registerFeature({
  key: 'file-storage',
  activate: () => {
    const settings = getFileStorageSettings();
    if (!settings) {
      logTrace('File storage disabled (file_storage config missing)');
      return;
    }

    httpServerEngine.registerHttpRoutes((server) => {
      registerFileStorageDownloadRoute(server, dbEngine.db);
    });

    // Fire-and-forget: never blocks boot. Hard-fails the process on a real misconfiguration,
    // just logs and self-heals lazily on the first real use for a transient outage.
    fileStorageClient.checkStartupConfig();
  },
});
