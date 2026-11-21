import { describe, expect, it, vi } from 'vitest';
import { createPeerTokenProvisioning, peerServiceAccountId } from './peer-tokens-service';

const TENANT = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
const REQUEST = { consumer: 'openaev', name: 'OpenAEV', email: 'openaev@peer.example', token_name: 'opencrq-link' };

const fakeServices = () => ({
  serviceAccounts: { provisionServiceAccount: vi.fn().mockResolvedValue(undefined) },
  serviceAccountTokens: {
    replaceProvisionedToken: vi.fn().mockResolvedValue({ plainToken: 'flgrn_ocrq_tkn_x' }),
    revokeProvisionedTokens: vi.fn().mockResolvedValue(2),
  },
});

describe('peerServiceAccountId', () => {
  it('is stable for one email whatever its case, and differs across emails and tenants', () => {
    expect(peerServiceAccountId(TENANT, 'A@B.example')).toBe(peerServiceAccountId(TENANT, 'a@b.example'));
    expect(peerServiceAccountId(TENANT, 'a@b.example')).not.toBe(peerServiceAccountId(TENANT, 'c@b.example'));
    expect(peerServiceAccountId(TENANT, 'a@b.example')).not.toBe(peerServiceAccountId('11111111-1111-4111-8111-111111111111', 'a@b.example'));
  });
});

describe('createPeerTokenProvisioning', () => {
  it('converges the account in the tenant, then replaces its named token', async () => {
    const services = fakeServices();
    const result = await createPeerTokenProvisioning(services, TENANT).issue(REQUEST);
    const id = peerServiceAccountId(TENANT, REQUEST.email);
    expect(result).toEqual({ serviceAccountId: id, plainToken: 'flgrn_ocrq_tkn_x' });
    expect(services.serviceAccounts.provisionServiceAccount).toHaveBeenCalledWith(expect.objectContaining({ id, tenantId: TENANT, name: 'OpenAEV' }));
    expect(services.serviceAccountTokens.replaceProvisionedToken).toHaveBeenCalledWith({ serviceAccountId: id, tenantId: TENANT, name: 'opencrq-link' });
  });

  it('provisioning twice lands on the same account', async () => {
    const services = fakeServices();
    const provisioning = createPeerTokenProvisioning(services, TENANT);
    const first = await provisioning.issue(REQUEST);
    const second = await provisioning.issue({ ...REQUEST, name: 'OpenAEV renamed' });
    expect(second.serviceAccountId).toBe(first.serviceAccountId);
  });

  it('revokes the named tokens of the account the email keys', async () => {
    const services = fakeServices();
    expect(await createPeerTokenProvisioning(services, TENANT).revoke(REQUEST.email, 'opencrq-link')).toBe(2);
    expect(services.serviceAccountTokens.revokeProvisionedTokens).toHaveBeenCalledWith(peerServiceAccountId(TENANT, REQUEST.email), 'opencrq-link');
  });
});
