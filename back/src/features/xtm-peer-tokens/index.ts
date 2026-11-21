import { createServices, serviceAccountsService, serviceAccountTokensService } from '@app/module';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { httpServerEngine } from '../../engines/http-server';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { registerPeerTokensRoutes } from './peer-tokens-routes';
import { createPeerTokenProvisioning } from './peer-tokens-service';

const { logTrace, logFromError } = createLogger({ feature: 'xtm-peer-tokens' });

registerFeature({
  key: 'xtm-peer-tokens',
  activate: () => {
    const adminToken = config().app.admin.token;
    if (!adminToken) {
      logTrace('Peer token provisioning is off: no APP__ADMIN__TOKEN');
    }
    httpServerEngine.registerHttpRoutes((server) => {
      const services = createServices([serviceAccountsService, serviceAccountTokensService], dbEngine.db).withOrigin({ type: 'system' });
      const provisioning = createPeerTokenProvisioning(services, config().initial_tenant.id);
      registerPeerTokensRoutes(server, {
        adminToken,
        issue: provisioning.issue,
        revoke: provisioning.revoke,
        logError: (error, message) => logFromError(error, message),
      });
    });
  },
});
