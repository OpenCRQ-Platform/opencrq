import { TenantNotFoundError } from '@app/module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const requireEnterpriseEdition = vi.fn<() => Promise<boolean>>();
vi.mock('../../edition', () => ({ requireEnterpriseEdition: () => requireEnterpriseEdition() }));

const { trpcInstance } = await import('../../../trpc');
const { tenantsRouter } = await import('./tenants-router');

const hasPlatformCapability = vi.fn<(capabilityId: string) => Promise<boolean>>();
const renameTenant = vi.fn();
const createTenant = vi.fn();
const getTenants = vi.fn();
const services = {
  withOrigin: () => ({
    platformCapabilities: { hasPlatformCapability },
    tenants: { renameTenant, createTenant, getTenants },
  }),
};
const origin = { type: 'platform', userId: 'user-1' };
const user = { id: 'user-1', email: 'admin@acme.com', name: 'Admin' };
const tenantId = '0198a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b';

const procedure = trpcInstance.procedure.use(({ next }) => next({ ctx: { services, origin, user } }));
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the router reads only the context fields set above
const caller = tenantsRouter(procedure as never, procedure as never).createCaller({ serviceAccount: null } as never);

beforeEach(() => {
  hasPlatformCapability.mockReset().mockResolvedValue(true);
  renameTenant.mockReset().mockResolvedValue(undefined);
  createTenant.mockReset().mockResolvedValue(undefined);
  getTenants.mockReset().mockResolvedValue([]);
  requireEnterpriseEdition.mockReset().mockResolvedValue(true);
});

describe('tenants.renameTenant', () => {
  it('hands the service the trimmed name', async () => {
    await caller.renameTenant({ id: tenantId, name: '  Acme  ' });

    expect(renameTenant).toHaveBeenCalledWith(tenantId, 'Acme');
  });

  it('refuses a caller without the Create Tenants capability, without calling the service', async () => {
    hasPlatformCapability.mockResolvedValue(false);

    await expect(caller.renameTenant({ id: tenantId, name: 'Acme' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'You do not have permission to rename tenants',
    });
    expect(renameTenant).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('refuses the blank name %j, without calling the service', async (name) => {
    await expect(caller.renameTenant({ id: tenantId, name })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(renameTenant).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for a tenant the caller does not reach', async () => {
    renameTenant.mockRejectedValue(new TenantNotFoundError());

    await expect(caller.renameTenant({ id: tenantId, name: 'Acme' })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Tenant not found' });
  });

  it('renames the tenant a Community Edition platform serves', async () => {
    requireEnterpriseEdition.mockResolvedValue(false);
    getTenants.mockResolvedValue([{ id: tenantId }]);

    await caller.renameTenant({ id: tenantId, name: 'Acme' });

    expect(renameTenant).toHaveBeenCalledWith(tenantId, 'Acme');
  });

  it('answers NOT_FOUND for a tenant a Community Edition platform put out of reach, without calling the service', async () => {
    requireEnterpriseEdition.mockResolvedValue(false);
    getTenants.mockResolvedValue([{ id: '0100a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b' }, { id: tenantId }]);

    await expect(caller.renameTenant({ id: tenantId, name: 'Acme' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(renameTenant).not.toHaveBeenCalled();
  });
});

describe('tenants.createTenantsTransaction', () => {
  it('refuses a blank name, without calling the service', async () => {
    await expect(caller.createTenantsTransaction({ id: tenantId, name: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createTenant).not.toHaveBeenCalled();
  });

  it('hands the service the trimmed name', async () => {
    await caller.createTenantsTransaction({ id: tenantId, name: '  Acme  ' });

    expect(createTenant).toHaveBeenCalledWith({ id: tenantId, name: 'Acme' }, 'user-1', { provisionOnboarding: true });
  });
});
