import { deriveSeedId } from '@app/module';
import type { PeerTokenRequest } from './peer-tokens-routes';

/** What the provisioning needs from the module's services, under the system origin. */
export interface PeerTokenServices {
  serviceAccounts: {
    provisionServiceAccount: (account: { id: string, tenantId: string, name: string, description: string }) => Promise<void>,
  },
  serviceAccountTokens: {
    replaceProvisionedToken: (params: { serviceAccountId: string, tenantId: string, name: string }) => Promise<{ plainToken: string }>,
    revokeProvisionedTokens: (serviceAccountId: string, name: string) => Promise<number>,
  },
}

/**
 * The account a sibling product is given is keyed by its email: its id is derived from it under
 * the tenant, so provisioning again (a redeploy, a retry) converges on the same account.
 */
export const peerServiceAccountId = (tenantId: string, email: string): string =>
  deriveSeedId(`xtm-peer:${email.toLowerCase()}`, tenantId);

export const createPeerTokenProvisioning = (services: PeerTokenServices, tenantId: string) => ({
  issue: async (request: PeerTokenRequest) => {
    const serviceAccountId = peerServiceAccountId(tenantId, request.email);
    await services.serviceAccounts.provisionServiceAccount({
      id: serviceAccountId,
      tenantId,
      name: request.name,
      description: `Provisioned by the deployment for ${request.consumer} (${request.email}).`,
    });
    const { plainToken } = await services.serviceAccountTokens.replaceProvisionedToken({
      serviceAccountId,
      tenantId,
      name: request.token_name,
    });
    return { serviceAccountId, plainToken };
  },
  revoke: (email: string, tokenName: string) =>
    services.serviceAccountTokens.revokeProvisionedTokens(peerServiceAccountId(tenantId, email), tokenName),
});
