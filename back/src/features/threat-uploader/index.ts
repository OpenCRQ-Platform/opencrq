import { getFileStorageSettings } from '../../clients/file-storage';
import { dbEngine } from '../../engines/db';
import { httpServerEngine } from '../../engines/http-server';
import { registerFeature } from '../features-manager';
import { registerUploadJobRoute } from '../../services/upload-job-route';

registerFeature({
  key: 'threat-uploader',
  activate: () => {
    // No upload route when file storage isn't configured: nothing useful could happen anyway.
    if (getFileStorageSettings()) {
      httpServerEngine.registerHttpRoutes((server) => {
        registerUploadJobRoute(server, dbEngine.db, {
          path: '/api/threats/upload',
          jobKind: 'threat-bundle-analysis',
          idempotencyKeyPrefix: 'threat-bundle',
          featureKey: 'threat-uploader',
          uploadFailedMessage: 'STIX bundle upload failed',
        });
      });
    }
  },
});
