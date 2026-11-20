import { describe, expect, it, vi } from 'vitest';
import { ensureInitialTenant } from './initial-tenant';

const INITIAL_TENANT = { id: '01a043da-ff47-72c2-aaa4-7da56d85c83e', name: 'Acme Bank' };

const fakeLogger = () => ({ logTrace: vi.fn(), logFromError: vi.fn() });

describe('ensureInitialTenant', () => {
  it('asks once for the tenant, with the id and the name it received', async () => {
    const tenants = { createInitialTenant: vi.fn().mockResolvedValue(true) };

    await ensureInitialTenant(tenants, INITIAL_TENANT, fakeLogger());

    expect(tenants.createInitialTenant).toHaveBeenCalledTimes(1);
    expect(tenants.createInitialTenant).toHaveBeenCalledWith(INITIAL_TENANT, { provisionOnboarding: true });
  });

  it('logs the id and the name of the tenant it created', async () => {
    const logger = fakeLogger();

    await ensureInitialTenant({ createInitialTenant: vi.fn().mockResolvedValue(true) }, INITIAL_TENANT, logger);

    expect(logger.logTrace).toHaveBeenCalledTimes(1);
    expect(logger.logTrace).toHaveBeenCalledWith('Created the initial tenant.', { tenantId: INITIAL_TENANT.id, name: INITIAL_TENANT.name });
    expect(logger.logFromError).not.toHaveBeenCalled();
  });

  it('logs that the platform already holds a tenant, without the id', async () => {
    const logger = fakeLogger();

    await ensureInitialTenant({ createInitialTenant: vi.fn().mockResolvedValue(false) }, INITIAL_TENANT, logger);

    expect(logger.logTrace).toHaveBeenCalledTimes(1);
    expect(logger.logTrace).toHaveBeenCalledWith('The platform already holds a tenant, no initial tenant created.');
    expect(JSON.stringify(logger.logTrace.mock.calls)).not.toContain(INITIAL_TENANT.id);
    expect(logger.logFromError).not.toHaveBeenCalled();
  });

  it('logs the failure and resolves so the boot continues', async () => {
    const logger = fakeLogger();
    const failure = new Error('database is down');

    await expect(ensureInitialTenant({ createInitialTenant: vi.fn().mockRejectedValue(failure) }, INITIAL_TENANT, logger)).resolves.toBeUndefined();

    expect(logger.logFromError).toHaveBeenCalledTimes(1);
    expect(logger.logFromError).toHaveBeenCalledWith(failure, 'Creating the initial tenant failed, booting without it');
  });
});
