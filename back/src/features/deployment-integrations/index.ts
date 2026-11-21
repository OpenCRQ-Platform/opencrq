import { createServices, integrationSettingsService, openctiConnectorService, serviceAccountsService, tenantsService } from '@app/module';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { createLogger } from '../../utils/logger';
import { fetchOpenCtiStreams } from '../app-router/opencti/opencti-router';
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
            [tenantsService, serviceAccountsService, integrationSettingsService, openctiConnectorService],
            dbEngine.db,
          ).withOrigin({ type: 'system' });
          const connectors = config().connectors;
          await enableDeploymentIntegrations({
            opencti: connectors?.opencti,
            openaev: connectors?.openaev,
            tenantExists: async (tenantId) => (await services.tenants.getTenant(tenantId)) !== undefined,
            provisionServiceAccount: (account) => services.serviceAccounts.provisionServiceAccount(account),
            bindOpenaev: (tenantId, serviceAccountId) =>
              services.integrationSettings.bindDeploymentIntegration(tenantId, 'openaev', serviceAccountId),
            configureOpencti: (tenantId, serviceAccountId, streamId) =>
              services.openctiConnector.configureDeploymentStream(tenantId, serviceAccountId, streamId),
            isOpenctiConfigured: async (tenantId) => {
              const settings = await services.openctiConnector.getSettings(tenantId);
              return !!(settings?.serviceAccountId || settings?.streamId);
            },
            listOpenctiStreams: (connection) => fetchOpenCtiStreams(connection.url, connection.token),
            logTrace,
            logFromError,
          });
        },
      }),
    });
  },
});
