import { createServices, integrationSettingsService, serviceAccountsService, tenantsService } from '@app/module';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { enableDeploymentIntegrations } from './deployment-integrations';

const DEPLOYMENT_INTEGRATIONS_KEY = 'deployment-integrations';
const { logTrace, logFromError } = createLogger({ feature: DEPLOYMENT_INTEGRATIONS_KEY });

registerFeature({
  key: DEPLOYMENT_INTEGRATIONS_KEY,
  activate: () => {
    // After the DB engine's migrations: the bindings live in tables the migrations create.
    registerEngine({
      key: DEPLOYMENT_INTEGRATIONS_KEY,
      start: () => ({
        onEnginesStarted: async () => {
          const services = createServices(
            [tenantsService, serviceAccountsService, integrationSettingsService],
            dbEngine.db,
          ).withOrigin({ type: 'system' });
          const connectors = config().connectors;
          // The OpenCTI connection is never bound here: only an admin picks the Live Stream (Configure).
          await enableDeploymentIntegrations({
            openaev: connectors?.openaev,
            tenantExists: async (tenantId) => (await services.tenants.getTenant(tenantId)) !== undefined,
            provisionServiceAccount: (account) => services.serviceAccounts.provisionServiceAccount(account),
            bindOpenaev: (tenantId, serviceAccountId) =>
              services.integrationSettings.bindDeploymentIntegration(tenantId, 'openaev', serviceAccountId),
            logTrace,
            logFromError,
          });
        },
      }),
    });
  },
});
