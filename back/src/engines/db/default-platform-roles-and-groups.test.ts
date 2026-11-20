import { describe, expect, it, vi } from 'vitest';
import { ensureDefaultPlatformRolesAndGroups } from './default-platform-roles-and-groups';

const fakeLogger = () => ({ logTrace: vi.fn(), logFromError: vi.fn() });

describe('ensureDefaultPlatformRolesAndGroups', () => {
  it('asks once for the defaults', async () => {
    const platformGroups = { createDefaultPlatformRolesAndGroups: vi.fn().mockResolvedValue(true) };

    await ensureDefaultPlatformRolesAndGroups(platformGroups, fakeLogger());

    expect(platformGroups.createDefaultPlatformRolesAndGroups).toHaveBeenCalledTimes(1);
  });

  it('logs that it created the defaults', async () => {
    const logger = fakeLogger();

    await ensureDefaultPlatformRolesAndGroups({ createDefaultPlatformRolesAndGroups: vi.fn().mockResolvedValue(true) }, logger);

    expect(logger.logTrace).toHaveBeenCalledTimes(1);
    expect(logger.logTrace).toHaveBeenCalledWith('Created the default platform roles and groups.');
    expect(logger.logFromError).not.toHaveBeenCalled();
  });

  it('logs that the platform already holds platform roles or groups', async () => {
    const logger = fakeLogger();

    await ensureDefaultPlatformRolesAndGroups({ createDefaultPlatformRolesAndGroups: vi.fn().mockResolvedValue(false) }, logger);

    expect(logger.logTrace).toHaveBeenCalledTimes(1);
    expect(logger.logTrace).toHaveBeenCalledWith('The platform already holds platform roles or groups, no default created.');
    expect(logger.logFromError).not.toHaveBeenCalled();
  });

  it('logs the failure and resolves so the boot continues', async () => {
    const logger = fakeLogger();
    const failure = new Error('database is down');

    await expect(
      ensureDefaultPlatformRolesAndGroups({ createDefaultPlatformRolesAndGroups: vi.fn().mockRejectedValue(failure) }, logger),
    ).resolves.toBeUndefined();

    expect(logger.logTrace).not.toHaveBeenCalled();
    expect(logger.logFromError).toHaveBeenCalledTimes(1);
    expect(logger.logFromError).toHaveBeenCalledWith(failure, 'Creating the default platform roles and groups failed, booting without them');
  });
});
