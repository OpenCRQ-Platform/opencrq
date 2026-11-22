import { describe, expect, it, vi } from 'vitest';
import { adminBearerServiceAccountId, enableAdminBearer } from './admin-bearer';

const TENANT = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
const ADMIN_TOKEN = '6f1c2e9a-1b3d-4c5e-8f7a-9b0c1d2e3f4a';

const deps = (overrides: Partial<Parameters<typeof enableAdminBearer>[0]> = {}) => ({
  adminToken: ADMIN_TOKEN,
  tenantId: TENANT,
  tenantExists: vi.fn().mockResolvedValue(true),
  provisionServiceAccount: vi.fn().mockResolvedValue(undefined),
  setAdminBearer: vi.fn(),
  logTrace: vi.fn(),
  ...overrides,
});

describe('enableAdminBearer', () => {
  it('provisions the account in the Admin group of the initial tenant and turns the bearer on', async () => {
    const d = deps();
    expect(await enableAdminBearer(d)).toBe(true);
    const id = adminBearerServiceAccountId(TENANT);
    expect(d.provisionServiceAccount).toHaveBeenCalledWith(expect.objectContaining({ id, tenantId: TENANT, groupSlug: 'admin' }));
    expect(d.setAdminBearer).toHaveBeenCalledWith({ token: ADMIN_TOKEN, serviceAccountId: id, tenantId: TENANT });
  });

  it('converges on the same account at every start', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    await enableAdminBearer(deps({ provisionServiceAccount: first }));
    await enableAdminBearer(deps({ provisionServiceAccount: second }));
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ id: adminBearerServiceAccountId(TENANT) }));
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ id: adminBearerServiceAccountId(TENANT) }));
  });

  it('stays off without APP__ADMIN__TOKEN', async () => {
    const d = deps({ adminToken: undefined });
    expect(await enableAdminBearer(d)).toBe(false);
    expect(d.provisionServiceAccount).not.toHaveBeenCalled();
    expect(d.setAdminBearer).toHaveBeenCalledWith(null);
  });

  it('stays off when the initial tenant does not exist', async () => {
    const d = deps({ tenantExists: vi.fn().mockResolvedValue(false) });
    expect(await enableAdminBearer(d)).toBe(false);
    expect(d.provisionServiceAccount).not.toHaveBeenCalled();
    expect(d.setAdminBearer).toHaveBeenCalledWith(null);
  });

  it('derives an account id distinct from any peer account', () => {
    expect(adminBearerServiceAccountId(TENANT)).not.toBe(adminBearerServiceAccountId('11111111-1111-4111-8111-111111111111'));
  });
});
