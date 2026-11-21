import { deriveSeedId } from '@app/module';

/**
 * The OpenAEV connection a deployment provides (`CONNECTORS__OPENAEV__<tenant>__URL/__TOKEN`) comes up
 * enabled: at every boot, a tenant given one and left unconfigured gets the account the integration
 * runs as, bound. Idempotent: the account id is derived from the tenant, and a binding an admin made
 * (a disabled connector included) is never overwritten.
 *
 * The OpenCTI connection (`CONNECTORS__OPENCTI__<tenant>__URL/__TOKEN`) is never bound here: OpenCRQ
 * shows what a Live Stream carries to every member of the tenant, so only an admin picks the stream,
 * with Configure. Until then the connector stays idle and reads "Not configured".
 */

export type DeploymentProduct = 'openaev';

const ACCOUNT_NAMES: Record<DeploymentProduct, string> = {
  openaev: 'OpenAEV (deployment)',
};

export const deploymentServiceAccountId = (tenantId: string, product: DeploymentProduct): string =>
  deriveSeedId(`deployment-integration:${product}`, tenantId);

export interface DeploymentConnection { url: string, token: string }

export interface DeploymentIntegrationsDeps {
  /** Tenant id → connection, as configured. */
  openaev: Record<string, DeploymentConnection> | undefined,
  tenantExists: (tenantId: string) => Promise<boolean>,
  provisionServiceAccount: (account: { id: string, tenantId: string, name: string, description: string }) => Promise<void>,
  /** Binds unless an account is already bound; answers whether it bound. */
  bindOpenaev: (tenantId: string, serviceAccountId: string) => Promise<boolean>,
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
