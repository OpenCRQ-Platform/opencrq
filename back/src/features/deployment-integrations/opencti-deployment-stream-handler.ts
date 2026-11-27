import type { JobHandler } from '@app/module';
import { createServices, InputsNotReadyError, NonRetryableError, openctiConnectorService, serviceAccountsService } from '@app/module';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { fetchOpenCtiStreams } from '../app-router/opencti/opencti-router';
import { provisionOpencti } from './deployment-integrations';
import { ensureManagedStream, openctiManagedStreamCalls, provisioningSignal } from './opencti-managed-stream';

const { logTrace } = createLogger({ feature: 'deployment-integrations' });

/**
 * Connects a tenant to the OpenCTI the deployment provides: finds or creates the managed Live
 * Stream and binds it, or moves the deployment's own binding to it. One attempt only: the job
 * scheduler asks again while the tenant is not connected, which suits an OpenCTI that takes minutes
 * to come up better than the runtime's retries, which give up in seconds. Runs as `system`: the
 * methods it calls are reserved to that origin, and it writes deployment configuration, not a value
 * computed from other tables.
 */
export const openctiDeploymentStreamHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  const connection = config().connectors?.opencti?.[ctx.tenantId];
  if (!connection) {
    throw new NonRetryableError('The deployment provides no OpenCTI connection for this tenant');
  }
  const services = createServices([serviceAccountsService, openctiConnectorService], dbEngine.db).withOrigin({ type: 'system' });
  const streamCalls = openctiManagedStreamCalls(fetch, ctx.signal);

  const outcome = await provisionOpencti({
    getSettings: (tenantId) => services.openctiConnector.getSettings(tenantId),
    withManagedStreamLock: async (url, run) => {
      // The service answers whether it ran the callback, a service method being unable to carry a type parameter.
      const held: { result?: Awaited<ReturnType<typeof run>> } = {};
      const ran = await services.openctiConnector.withManagedStreamLock(url, async () => {
        held.result = await run();
      });
      return ran && held.result !== undefined ? held.result : null;
    },
    ensureManagedStream: (target) => ensureManagedStream({
      ...streamCalls,
      listStreams: ({ url, token }) => fetchOpenCtiStreams(url, token, provisioningSignal(ctx.signal)),
    }, target),
    provisionServiceAccount: (account) => services.serviceAccounts.provisionServiceAccount(account),
    configureOpencti: (tenantId, serviceAccountId, streamId) =>
      services.openctiConnector.configureDeploymentStream(tenantId, serviceAccountId, streamId),
    repointOpencti: (tenantId, fromStreamId, toStreamId) =>
      services.openctiConnector.repointDeploymentStream(tenantId, fromStreamId, toStreamId),
    resumeOpencti: (tenantId, streamId) => services.openctiConnector.resumeDeploymentStream(tenantId, streamId),
    recordOpenctiMissingCapability: (tenantId, capability) =>
      services.openctiConnector.recordStreamMissingCapability(tenantId, capability),
    logTrace,
  }, ctx.tenantId, connection);

  if (outcome === 'locked') {
    throw new InputsNotReadyError('Another run is provisioning the managed stream of this OpenCTI');
  }
  logTrace('Provisioned the OpenCTI integration the deployment provides', { jobId: ctx.jobId, tenantId: ctx.tenantId, outcome });
};
