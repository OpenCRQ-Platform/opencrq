import type { EnqueueJobOptions, EnqueueJobResult } from '@app/module';
import type { ManagedStreamOutcome } from './opencti-managed-stream';
import { deriveSeedId } from '@app/module';

/**
 * The OpenAEV and OpenCTI connections a deployment provides (`CONNECTORS__OPENAEV__<tenant>__URL/__TOKEN`,
 * `CONNECTORS__OPENCTI__<tenant>__URL/__TOKEN`) come up enabled: a tenant given one and left
 * unconfigured gets the account the integration runs as, bound. Idempotent: the account id is derived
 * from the tenant, and a binding an admin made (a disabled connector included) is never overwritten.
 *
 * OpenAEV is bound at boot, since binding needs nothing from the peer. OpenCTI is provisioned by a job
 * per tenant (`opencti-deployment-stream-handler.ts`), enqueued at boot and again by the job scheduler
 * while the tenant is not connected, so an OpenCTI that starts later, or a token granted the right
 * later, comes up without a restart. OpenCRQ drives the Live Stream itself there (see
 * `opencti-managed-stream.ts`): it finds or creates the stream it manages and binds it. Binding
 * unattended is safe since every mirrored object keeps its OpenCTI markings and each person's read is
 * filtered by them. A binding the deployment made (`boundByDeployment`, which every admin Configure
 * clears) that points anywhere but at the managed stream (a stream deleted in OpenCTI, a duplicate an
 * earlier release left) is moved to it, and one stopped on an authentication failure is resumed once
 * the token answers again; a binding an admin made is never touched. A token without the right to
 * manage streams leaves the connector idle, with the missing capability shown on the connector page;
 * an admin can still pick a stream with Configure.
 */

export const OPENCTI_DEPLOYMENT_STREAM_JOB = 'opencti-deployment-stream';

/** One run per tenant at a time, whoever asks: the boot of any worker or the scheduler. */
export const openctiDeploymentStreamKey = (tenantId: string): string => `${tenantId}:${OPENCTI_DEPLOYMENT_STREAM_JOB}`;

export type DeploymentProduct = 'opencti' | 'openaev';

const ACCOUNT_NAMES: Record<DeploymentProduct, string> = {
  opencti: 'OpenCTI (deployment)',
  openaev: 'OpenAEV (deployment)',
};

export const deploymentServiceAccountId = (tenantId: string, product: DeploymentProduct): string =>
  deriveSeedId(`deployment-integration:${product}`, tenantId);

export interface DeploymentConnection { url: string, token: string }

type ProvisionServiceAccount = (account: { id: string, tenantId: string, name: string, description: string }) => Promise<void>;

export interface DeploymentIntegrationsDeps {
  /** Tenant id → connection, as configured. */
  openaev: Record<string, DeploymentConnection> | undefined,
  tenantExists: (tenantId: string) => Promise<boolean>,
  provisionServiceAccount: ProvisionServiceAccount,
  /** Binds unless an account is already bound; answers whether it bound. */
  bindOpenaev: (tenantId: string, serviceAccountId: string) => Promise<boolean>,
  logTrace: (message: string, meta?: Record<string, unknown>) => void,
  logFromError: (error: unknown, message: string, meta?: Record<string, unknown>) => void,
}

export interface OpenctiBindingSettings {
  serviceAccountId: string | null,
  streamId: string | null,
  authFailedAt: Date | null,
  boundByDeployment: boolean,
}

type OpenctiBindingKind = 'none' | 'deployment' | 'admin';

/** Who a tenant's OpenCTI binding belongs to. An account bound without a stream is an admin's half-made choice: theirs. */
export const openctiBindingKind = (settings: OpenctiBindingSettings | null | undefined): OpenctiBindingKind => {
  if (!settings?.serviceAccountId && !settings?.streamId) {
    return 'none';
  }
  return settings.boundByDeployment ? 'deployment' : 'admin';
};

export interface OpenctiProvisioningDeps {
  getSettings: (tenantId: string) => Promise<OpenctiBindingSettings | null | undefined>,
  /** Runs the callback holding the lock of one OpenCTI's managed stream and answers its result; answers null without running it when another run holds it. */
  withManagedStreamLock: <T>(openctiUrl: string, run: () => Promise<T>) => Promise<T | null>,
  ensureManagedStream: (connection: DeploymentConnection) => Promise<ManagedStreamOutcome>,
  provisionServiceAccount: ProvisionServiceAccount,
  /** Configures and enables unless configured; answers whether it configured. */
  configureOpencti: (tenantId: string, serviceAccountId: string, streamId: string) => Promise<boolean>,
  /** Moves the deployment's binding from one stream to another; answers whether it moved. */
  repointOpencti: (tenantId: string, fromStreamId: string, toStreamId: string) => Promise<boolean>,
  /** Re-enables the deployment's binding on that stream after an authentication failure; answers whether it resumed. */
  resumeOpencti: (tenantId: string, streamId: string) => Promise<boolean>,
  /** Records the capability the token lacks, or clears it with null. */
  recordOpenctiMissingCapability: (tenantId: string, capability: string | null) => Promise<void>,
  logTrace: (message: string, meta?: Record<string, unknown>) => void,
}

export type OpenctiProvisioningOutcome = 'configured' | 'repointed' | 'resumed' | 'kept' | 'missing_capability' | 'locked';

const ensureAccount = async (deps: { provisionServiceAccount: ProvisionServiceAccount }, tenantId: string, product: DeploymentProduct): Promise<string> => {
  const id = deploymentServiceAccountId(tenantId, product);
  await deps.provisionServiceAccount({
    id,
    tenantId,
    name: ACCOUNT_NAMES[product],
    description: `The account the ${ACCOUNT_NAMES[product].split(' ')[0]} integration the deployment provides runs as.`,
  });
  return id;
};

const enableOpenaev = async (deps: DeploymentIntegrationsDeps, tenantId: string): Promise<void> => {
  const serviceAccountId = await ensureAccount(deps, tenantId, 'openaev');
  if (await deps.bindOpenaev(tenantId, serviceAccountId)) {
    deps.logTrace('Enabled the OpenAEV integration the deployment provides.', { tenantId });
  }
};

/** One OpenCTI is one lock whatever its spelling in the configuration: the parser drops a default port and lowercases the host. */
export const normaliseUrl = (url: string): string => {
  const parsed = new URL(url.trim());
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
};

/**
 * One provisioning attempt for a tenant. A tenant with nothing bound gets the managed stream; a
 * binding the deployment made is moved to it when it points elsewhere, or resumed when it stopped on
 * an authentication failure the token no longer has; a binding an admin made is kept. Every attempt
 * reads the OpenCTI's streams under that OpenCTI's lock, so concurrent runs never create two.
 */
export const provisionOpencti = async (
  deps: OpenctiProvisioningDeps,
  tenantId: string,
  connection: DeploymentConnection,
): Promise<OpenctiProvisioningOutcome> => {
  const settings = await deps.getSettings(tenantId);
  const binding = openctiBindingKind(settings);

  const outcome = await deps.withManagedStreamLock(normaliseUrl(connection.url), () => deps.ensureManagedStream(connection));
  if (outcome === null) {
    return 'locked';
  }
  if (outcome.kind === 'missing_capability') {
    // The managed stream is not touched, whoever bound what: only a tenant with nothing bound is told.
    if (binding === 'none') {
      await deps.recordOpenctiMissingCapability(tenantId, outcome.capability);
      deps.logTrace('The OpenCTI token cannot manage Live Streams: the connector stays idle until the capability is granted or an admin picks a stream.', {
        tenantId,
        capability: outcome.capability,
      });
    }
    return 'missing_capability';
  }
  if (outcome.kind !== 'unchanged') {
    deps.logTrace(outcome.kind === 'created' ? 'Created the OpenCTI Live Stream OpenCRQ manages.' : 'Brought the OpenCTI Live Stream OpenCRQ manages up to date.', {
      tenantId,
      streamId: outcome.streamId,
    });
  }
  if (binding === 'none') {
    const serviceAccountId = await ensureAccount(deps, tenantId, 'opencti');
    if (!await deps.configureOpencti(tenantId, serviceAccountId, outcome.streamId)) {
      return 'kept';
    }
    await deps.recordOpenctiMissingCapability(tenantId, null);
    deps.logTrace('Enabled the OpenCTI integration the deployment provides.', { tenantId, streamId: outcome.streamId });
    return 'configured';
  }
  if (binding !== 'deployment' || !settings?.streamId) {
    return 'kept';
  }
  if (settings.streamId !== outcome.streamId) {
    if (!await deps.repointOpencti(tenantId, settings.streamId, outcome.streamId)) {
      return 'kept';
    }
    deps.logTrace('Moved the OpenCTI integration the deployment provides to the Live Stream OpenCRQ manages.', {
      tenantId,
      fromStreamId: settings.streamId,
      streamId: outcome.streamId,
    });
    return 'repointed';
  }
  // The token just listed the streams, so the failure that stopped the connector is gone.
  if (settings.authFailedAt !== null && await deps.resumeOpencti(tenantId, outcome.streamId)) {
    deps.logTrace('Resumed the OpenCTI integration the deployment provides after an authentication failure.', { tenantId, streamId: outcome.streamId });
    return 'resumed';
  }
  return 'kept';
};

export interface OpenctiProvisioningEnqueueDeps {
  /** Tenant id → connection, as configured. */
  opencti: Record<string, DeploymentConnection> | undefined,
  tenantExists: (tenantId: string) => Promise<boolean>,
  enqueueJob: (options: EnqueueJobOptions) => Promise<EnqueueJobResult>,
  logTrace: (message: string, meta?: Record<string, unknown>) => void,
  logFromError: (error: unknown, message: string, meta?: Record<string, unknown>) => void,
}

/** Asks for the OpenCTI provisioning of every tenant the deployment provides one for, once whatever the number of workers starting. */
export const enqueueOpenctiProvisioning = async (deps: OpenctiProvisioningEnqueueDeps): Promise<void> => {
  // A failed enqueue leaves the tenant to the scheduler's next tick, never fails the boot.
  for (const tenantId of Object.keys(deps.opencti ?? {})) {
    try {
      if (!(await deps.tenantExists(tenantId))) {
        deps.logTrace('A deployment-provided integration names a tenant this platform does not hold: skipped.', { product: 'opencti', tenantId });
        continue;
      }
      await deps.enqueueJob({
        kind: OPENCTI_DEPLOYMENT_STREAM_JOB,
        tenantId,
        payload: {},
        idempotencyKey: openctiDeploymentStreamKey(tenantId),
        triggeredBy: 'system',
        interactive: false,
        skipIfActive: true,
        maxAttempts: 1,
      });
    } catch (error) {
      deps.logFromError(error, 'Enqueuing the OpenCTI provisioning of a deployment-provided integration failed', { tenantId });
    }
  }
};

export const enableDeploymentIntegrations = async (deps: DeploymentIntegrationsDeps): Promise<void> => {
  // One after the other: a handful of tenants, and each step is a few statements.
  for (const tenantId of Object.keys(deps.openaev ?? {})) {
    try {
      if (!(await deps.tenantExists(tenantId))) {
        deps.logTrace('A deployment-provided integration names a tenant this platform does not hold: skipped.', { product: 'openaev', tenantId });
        continue;
      }
      await enableOpenaev(deps, tenantId);
    } catch (error) {
      // A peer down at boot leaves the integration for the next boot or an admin, never the boot itself.
      deps.logFromError(error, 'Enabling a deployment-provided integration failed', { product: 'openaev', tenantId });
    }
  }
};
