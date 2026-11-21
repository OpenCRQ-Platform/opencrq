import { deriveSeedId } from '@app/module';

/**
 * The OpenCTI and OpenAEV connections a deployment provides (`CONNECTORS__OPENCTI__<tenant>__URL/__TOKEN`,
 * `CONNECTORS__OPENAEV__<tenant>__URL/__TOKEN`) come up enabled: at every boot, a tenant given one and
 * left unconfigured gets the account the integration runs as, bound, and for OpenCTI the first
 * Live Stream that delivers what OpenCRQ reads. Idempotent: the account id is derived from the
 * tenant, and a binding an admin made (a disabled connector included) is never overwritten.
 */

export type DeploymentProduct = 'opencti' | 'openaev';

const ACCOUNT_NAMES: Record<DeploymentProduct, string> = {
  opencti: 'OpenCTI (deployment)',
  openaev: 'OpenAEV (deployment)',
};

export const deploymentServiceAccountId = (tenantId: string, product: DeploymentProduct): string =>
  deriveSeedId(`deployment-integration:${product}`, tenantId);

export interface DeploymentConnection { url: string, token: string }

export interface DeploymentStream { id: string, verdict: string }

export interface DeploymentIntegrationsDeps {
  /** Tenant id → connection, as configured. */
  opencti: Record<string, DeploymentConnection> | undefined,
  openaev: Record<string, DeploymentConnection> | undefined,
  tenantExists: (tenantId: string) => Promise<boolean>,
  provisionServiceAccount: (account: { id: string, tenantId: string, name: string, description: string }) => Promise<void>,
  /** Binds unless an account is already bound; answers whether it bound. */
  bindOpenaev: (tenantId: string, serviceAccountId: string) => Promise<boolean>,
  /** Configures and enables unless configured; answers whether it configured. */
  configureOpencti: (tenantId: string, serviceAccountId: string, streamId: string) => Promise<boolean>,
  isOpenctiConfigured: (tenantId: string) => Promise<boolean>,
  listOpenctiStreams: (connection: DeploymentConnection) => Promise<Array<DeploymentStream>>,
  logTrace: (message: string, meta?: Record<string, unknown>) => void,
  logFromError: (error: unknown, message: string, meta?: Record<string, unknown>) => void,
}

/** The stream to bind: the first one judged to deliver every claim OpenCRQ reads, else none. */
export const pickDeploymentStream = (streams: ReadonlyArray<DeploymentStream>): string | null =>
  streams.find((stream) => stream.verdict === 'delivers')?.id ?? null;

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
  if (await deps.isOpenctiConfigured(tenantId)) {
    return;
  }
  const streamId = pickDeploymentStream(await deps.listOpenctiStreams(connection));
  if (streamId === null) {
    deps.logTrace('The OpenCTI the deployment provides has no Live Stream delivering what OpenCRQ reads: left for an admin.', { tenantId });
    return;
  }
  const serviceAccountId = await ensureAccount(deps, tenantId, 'opencti');
  if (await deps.configureOpencti(tenantId, serviceAccountId, streamId)) {
    deps.logTrace('Enabled the OpenCTI integration the deployment provides.', { tenantId, streamId });
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
