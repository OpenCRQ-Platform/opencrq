import { createServices, integrationSettingsService, jobsService, serviceAccountsService, tenantsService } from '@app/module';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { jobRuntimeEngine } from '../../engines/job-runtime';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { enableDeploymentIntegrations, enqueueOpenctiProvisioning, OPENCTI_DEPLOYMENT_STREAM_JOB } from './deployment-integrations';
import { openctiDeploymentStreamHandler } from './opencti-deployment-stream-handler';

const DEPLOYMENT_INTEGRATIONS_KEY = 'deployment-integrations';
const { logTrace, logFromError } = createLogger({ feature: DEPLOYMENT_INTEGRATIONS_KEY });

registerFeature({
  key: DEPLOYMENT_INTEGRATIONS_KEY,
  activate: () => {
    // One run per tenant: the provisioning and the scheduler's retries share a key.
    jobRuntimeEngine.registerHandler(OPENCTI_DEPLOYMENT_STREAM_JOB, openctiDeploymentStreamHandler, { serialized: true });
    // After the DB engine's migrations: the bindings live in tables the migrations create.
    registerEngine({
      key: DEPLOYMENT_INTEGRATIONS_KEY,
      start: () => ({
        onEnginesStarted: async () => {
          const services = createServices(
            [tenantsService, serviceAccountsService, integrationSettingsService, jobsService],
            dbEngine.db,
          ).withOrigin({ type: 'system' });
          const connectors = config().connectors;
          const tenantExists = async (tenantId: string) => (await services.tenants.getTenant(tenantId)) !== undefined;
          await enableDeploymentIntegrations({
            openaev: connectors?.openaev,
            tenantExists,
            provisionServiceAccount: (account) => services.serviceAccounts.provisionServiceAccount(account),
            bindOpenaev: (tenantId, serviceAccountId) =>
              services.integrationSettings.bindDeploymentIntegration(tenantId, 'openaev', serviceAccountId),
            logTrace,
            logFromError,
          });
          await enqueueOpenctiProvisioning({
            opencti: connectors?.opencti,
            tenantExists,
            enqueueJob: (options) => services.jobs.enqueueJob(options),
            logTrace,
            logFromError,
          });
        },
      }),
    });
  },
});
