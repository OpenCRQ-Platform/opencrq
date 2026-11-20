import { afterEach, describe, expect, it, vi } from 'vitest';

// The reachability check reaches the edition state, whose IPC relay reaches the
// logger, which parses the process config at import time.
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const { communityEditionTenantId, isTenantReachable, isTenantReachableOnce, visibleTenants } = await import('./tenant-edition-utils');
const { resetEditionState, setRemoteEntitlementExpiry } = await import('../edition/edition-state');

// UUIDv7, so the lexicographic order below is the creation order.
const OLDEST = '01890000-0000-7000-8000-000000000001';
const MIDDLE = '01990000-0000-7000-8000-000000000002';
const NEWEST = '019a0000-0000-7000-8000-000000000003';

describe('communityEditionTenantId', () => {
  it('should pick the oldest tenant whatever order they arrive in', () => {
    expect(communityEditionTenantId([NEWEST, OLDEST, MIDDLE])).toBe(OLDEST);
  });

  it('should return nothing when the user belongs to no tenant', () => {
    expect(communityEditionTenantId([])).toBeUndefined();
  });

  it('should not mutate the list it was given', () => {
    const ids = [NEWEST, OLDEST];
    communityEditionTenantId(ids);
    expect(ids).toEqual([NEWEST, OLDEST]);
  });
});

describe('visibleTenants', () => {
  const tenants = [{ id: NEWEST }, { id: OLDEST }, { id: MIDDLE }];

  it('should hand back every tenant on an entitled platform', () => {
    expect(visibleTenants(tenants, true)).toHaveLength(3);
  });

  it('should keep only the oldest on Community Edition', () => {
    expect(visibleTenants(tenants, false)).toEqual([{ id: OLDEST }]);
  });

  it('should leave a single-tenant deployment untouched', () => {
    expect(visibleTenants([{ id: MIDDLE }], false)).toEqual([{ id: MIDDLE }]);
  });

  it('should hand back nothing when the user belongs to no tenant', () => {
    expect(visibleTenants([], false)).toEqual([]);
  });
});

describe('isTenantReachable', () => {
  afterEach(() => {
    resetEditionState();
  });

  it('reaches any tenant once the platform is entitled, without listing them', async () => {
    setRemoteEntitlementExpiry(Date.now() + 60_000);
    const listTenantIds = vi.fn();

    await expect(isTenantReachable('tenant-b', listTenantIds)).resolves.toBe(true);
    expect(listTenantIds).not.toHaveBeenCalled();
  });

  it('reaches only the first tenant on a Community platform', async () => {
    // UUIDv7 ids sort by creation, so the lowest is the one a downgraded user keeps.
    const listTenantIds = () => Promise.resolve(['tenant-b', 'tenant-a']);

    await expect(isTenantReachable('tenant-a', listTenantIds)).resolves.toBe(true);
    await expect(isTenantReachable('tenant-b', listTenantIds)).resolves.toBe(false);
  });

  it('reaches nothing when the caller belongs to no tenant at all', async () => {
    await expect(isTenantReachable('tenant-a', () => Promise.resolve([]))).resolves.toBe(false);
  });
});

describe('isTenantReachableOnce', () => {
  it('lists the tenants once for every call one request carries', async () => {
    const request = {};
    const listTenantIds = vi.fn().mockResolvedValue(['tenant-a', 'tenant-b']);

    const answers = await Promise.all([
      isTenantReachableOnce(request, 'tenant-a', listTenantIds),
      isTenantReachableOnce(request, 'tenant-a', listTenantIds),
    ]);

    expect(answers).toEqual([true, true]);
    expect(listTenantIds).toHaveBeenCalledTimes(1);
  });

  it('asks again on the next request, so a membership change is never carried over', async () => {
    const listTenantIds = vi.fn().mockResolvedValue(['tenant-a']);

    await isTenantReachableOnce({}, 'tenant-a', listTenantIds);
    await isTenantReachableOnce({}, 'tenant-a', listTenantIds);

    expect(listTenantIds).toHaveBeenCalledTimes(2);
  });

  it('answers each tenant a single request names, rather than reusing the first answer', async () => {
    const request = {};
    const listTenantIds = vi.fn().mockResolvedValue(['tenant-a', 'tenant-b']);

    await expect(isTenantReachableOnce(request, 'tenant-a', listTenantIds)).resolves.toBe(true);
    await expect(isTenantReachableOnce(request, 'tenant-b', listTenantIds)).resolves.toBe(false);
  });
});
