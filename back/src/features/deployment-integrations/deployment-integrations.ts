import type { ManagedStreamOutcome } from './opencti-managed-stream';
import { deriveSeedId } from '@app/module';

/**
 * The OpenCTI and OpenAEV connections a deployment provides (`CONNECTORS__OPENCTI__<tenant>__URL/__TOKEN`,
 * `CONNECTORS__OPENAEV__<tenant>__URL/__TOKEN`) come up enabled: at every boot, a tenant given one and
 * left unconfigured gets the account the integration runs as, bound. Idempotent: the account id is
 * derived from the tenant, and a binding an admin made (a disabled connector included) is never
 * overwritten.
 *
 * For OpenCTI, OpenCRQ also drives the Live Stream itself: it creates (or brings up to date) the
 * stream it manages in that OpenCTI, see `opencti-managed-stream.ts`, and binds it. Binding at boot is
 * safe since every mirrored object keeps its OpenCTI markings and each person's read is filtered by
 * them. A token without the right to manage streams leaves the connector idle, with the missing
 * capability shown on the connector page; an admin can still pick a stream with Configure.
 */

export type DeploymentProduct = 'opencti' | 'openaev';

const ACCOUNT_NAMES: Record<DeploymentProduct, string> = {
  opencti: 'OpenCTI (deployment)',
  openaev: 'OpenAEV (deployment)',
};

export const deploymentServiceAccountId = (tenantId: string, product: DeploymentProduct): string =>
  deriveSeedId(`deployment-integration:${product}`, tenantId);

export interface DeploymentConnection { url: string, token: string }

export interface DeploymentIntegrationsDeps {
  /** Tenant id → connection, as configured. */
  opencti: Record<string, DeploymentConnection> | undefined,
  openaev: Record<string, DeploymentConnection> | undefined,
  tenantExists: (tenantId: string) => Promise<boolean>,
  provisionServiceAccount: (account: { id: string, tenantId: string, name: string, description: string }) => Promise<void>,
  /** Binds unless an account is already bound; answers whether it bound. */
  bindOpenaev: (tenantId: string, serviceAccountId: string) => Promise<boolean>,
  /** Whether an admin or an earlier boot bound an account or a stream. */
  isOpenctiConfigured: (tenantId: string) => Promise<boolean>,
  ensureManagedStream: (connection: DeploymentConnection) => Promise<ManagedStreamOutcome>,
  /** Configures and enables unless configured; answers whether it configured. */
  configureOpencti: (tenantId: string, serviceAccountId: string, streamId: string) => Promise<boolean>,
  /** Records the capability the token lacks, or clears it with null. */
  recordOpenctiMissingCapability: (tenantId: string, capability: string | null) => Promise<void>,
  logTrace: (message: string, meta?: Record<string, unknown>) => void,
  logFromError: (error: unknown, message: string, meta?: Record<string, unknown>) => void,
}

const ensureAccount = async (deps: DeploymentIntegrationsDeps, tenantId: string, product: DeploymentProduct): Promise<string> => {
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

const enableOpencti = async (deps: DeploymentIntegrationsDeps, tenantId: string, connection: DeploymentConnection): Promise<void> => {
  const bound = await deps.isOpenctiConfigured(tenantId);
  const outcome = await deps.ensureManagedStream(connection);
  if (outcome.kind === 'missing_capability') {
    // The managed stream is not touched, whoever bound what: only a tenant with nothing bound is told.
    if (!bound) {
      await deps.recordOpenctiMissingCapability(tenantId, outcome.capability);
      deps.logTrace('The OpenCTI token cannot manage Live Streams: the connector stays idle until the capability is granted or an admin picks a stream.', {
        tenantId,
        capability: outcome.capability,
      });
    }
    return;
  }
  if (outcome.kind !== 'unchanged') {
    deps.logTrace(outcome.kind === 'created' ? 'Created the OpenCTI Live Stream OpenCRQ manages.' : 'Brought the OpenCTI Live Stream OpenCRQ manages up to date.', {
      tenantId,
      streamId: outcome.streamId,
    });
  }
  if (bound) {
    // An admin's binding, or the managed stream an earlier boot bound: either way, kept.
    return;
  }
  const serviceAccountId = await ensureAccount(deps, tenantId, 'opencti');
  if (await deps.configureOpencti(tenantId, serviceAccountId, outcome.streamId)) {
    await deps.recordOpenctiMissingCapability(tenantId, null);
    deps.logTrace('Enabled the OpenCTI integration the deployment provides.', { tenantId, streamId: outcome.streamId });
  }
};

export const enableDeploymentIntegrations = async (deps: DeploymentIntegrationsDeps): Promise<void> => {
  const work: Array<[DeploymentProduct, string, () => Promise<void>]> = [
    ...Object.keys(deps.openaev ?? {}).map((tenantId): [DeploymentProduct, string, () => Promise<void>] =>
      ['openaev', tenantId, () => enableOpenaev(deps, tenantId)]),
    ...Object.entries(deps.opencti ?? {}).map(([tenantId, connection]): [DeploymentProduct, string, () => Promise<void>] =>
      ['opencti', tenantId, () => enableOpencti(deps, tenantId, connection)]),
  ];
  // One after the other: a handful of tenants, and each step is a few statements.
  for (const [product, tenantId, run] of work) {
    try {
      if (!(await deps.tenantExists(tenantId))) {
        deps.logTrace('A deployment-provided integration names a tenant this platform does not hold: skipped.', { product, tenantId });
        continue;
      }
      await run();
    } catch (error) {
      // A peer down at boot leaves the integration for the next boot or an admin, never the boot itself.
      deps.logFromError(error, 'Enabling a deployment-provided integration failed', { product, tenantId });
    }
  }
};
