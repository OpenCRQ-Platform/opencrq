import { describe, expect, it, vi } from 'vitest';
import { isOriginAuthorizedForItsTenant } from './tenant-access-utils';

describe('isOriginAuthorizedForItsTenant', () => {
  it('rejects a client origin with no tenantId', async () => {
    const callerReachesTenant = vi.fn();
    await expect(isOriginAuthorizedForItsTenant({ type: 'client', tenantId: undefined, userId: 'user-1' }, callerReachesTenant)).resolves.toBe(false);
    expect(callerReachesTenant).not.toHaveBeenCalled();
  });

  it('rejects a client origin claiming a tenant it is not a member of', async () => {
    const callerReachesTenant = vi.fn().mockResolvedValue(false);
    const authorized = await isOriginAuthorizedForItsTenant({ type: 'client', tenantId: 'tenant-b', userId: 'user-1' }, callerReachesTenant);
    expect(authorized).toBe(false);
    expect(callerReachesTenant).toHaveBeenCalledWith('tenant-b');
  });

  it('accepts a client origin that is a member of the claimed tenant', async () => {
    const callerReachesTenant = vi.fn().mockResolvedValue(true);
    const authorized = await isOriginAuthorizedForItsTenant({ type: 'client', tenantId: 'tenant-a', userId: 'user-1' }, callerReachesTenant);
    expect(authorized).toBe(true);
    expect(callerReachesTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('always accepts a connector origin without checking membership — its tenantId is already bound to its service account', async () => {
    const callerReachesTenant = vi.fn();
    const authorized = await isOriginAuthorizedForItsTenant({ type: 'connector', tenantId: 'tenant-a' }, callerReachesTenant);
    expect(authorized).toBe(true);
    expect(callerReachesTenant).not.toHaveBeenCalled();
  });
});
