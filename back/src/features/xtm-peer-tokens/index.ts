import { createServices, serviceAccountsService, serviceAccountTokensService, tenantsService } from '@app/module';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { httpServerEngine } from '../../engines/http-server';
import { setAdminBearer } from '../../trpc';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { registerPeerTokensRoutes } from './peer-tokens-routes';
import { createPeerTokenProvisioning } from './peer-tokens-service';
import { enableAdminBearer } from './admin-bearer';

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
    // After the DB engine's migrations: the account lives in tables the migrations create.
    registerEngine({
      key: 'xtm-admin-bearer',
      start: () => ({
        onEnginesStarted: async () => {
          const services = createServices([tenantsService, serviceAccountsService], dbEngine.db).withOrigin({ type: 'system' });
          try {
            const enabled = await enableAdminBearer({
              adminToken,
              tenantId: config().initial_tenant.id,
              tenantExists: async (tenantId) => (await services.tenants.getTenant(tenantId)) !== undefined,
              provisionServiceAccount: (account) => services.serviceAccounts.provisionServiceAccount(account),
              setAdminBearer,
              logTrace,
            });
            if (enabled) {
              logTrace('APP__ADMIN__TOKEN is accepted as an admin bearer on the API');
            }
          } catch (error) {
            setAdminBearer(null);
            logFromError(error, 'Enabling the admin bearer failed');
          }
        },
      }),
    });
  },
});
