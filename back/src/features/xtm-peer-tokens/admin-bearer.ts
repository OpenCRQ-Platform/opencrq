import { deriveSeedId } from '@app/module';
import type { AdminBearer } from '../../trpc';

/** The account the deployment's `APP__ADMIN__TOKEN` acts as, keyed under the initial tenant. */
export const adminBearerServiceAccountId = (tenantId: string): string =>
  deriveSeedId('xtm-admin-token', tenantId);

export interface AdminBearerDeps {
  /** The deployment's bootstrap admin token; unset leaves the bearer off. */
  adminToken: string | undefined,
  tenantId: string,
  tenantExists: (tenantId: string) => Promise<boolean>,
  provisionServiceAccount: (account: { id: string, tenantId: string, name: string, description: string, groupSlug: string }) => Promise<void>,
  setAdminBearer: (value: AdminBearer | null) => void,
  logTrace: (message: string) => void,
}

/**
 * Makes `APP__ADMIN__TOKEN` a platform-admin bearer on the API, as OpenCTI's admin token is: a
 * single-token deployment (xtm-docker) calls OpenCRQ with it without an init step that issues a
 * service-account token first. It acts as a service account of the initial tenant in its Admin group
 * (every capability, every marking the group is cleared for), converged at every start. No token is
 * stored: the bearer is compared in constant time with the configured value.
 */
export const enableAdminBearer = async (deps: AdminBearerDeps): Promise<boolean> => {
  if (!deps.adminToken) {
    deps.setAdminBearer(null);
    return false;
  }
  if (!(await deps.tenantExists(deps.tenantId))) {
    deps.logTrace('APP__ADMIN__TOKEN is not a bearer: the initial tenant does not exist');
    deps.setAdminBearer(null);
    return false;
  }
  const serviceAccountId = adminBearerServiceAccountId(deps.tenantId);
  await deps.provisionServiceAccount({
    id: serviceAccountId,
    tenantId: deps.tenantId,
    name: 'Deployment admin token',
    description: 'The account APP__ADMIN__TOKEN acts as on the API (Admin group of the initial tenant).',
    groupSlug: 'admin',
  });
  deps.setAdminBearer({ token: deps.adminToken, serviceAccountId, tenantId: deps.tenantId });
  return true;
};
