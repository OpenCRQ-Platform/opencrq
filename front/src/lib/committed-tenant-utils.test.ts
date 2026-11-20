import { describe, expect, it } from 'vitest';
import { getTenantIdFromMatches, isPlatformScope } from './committed-tenant-utils';

describe('getTenantIdFromMatches', () => {
  it('returns null when there are no matches', () => {
    expect(getTenantIdFromMatches([])).toBeNull();
  });

  it('returns the tenant id carried by the leaf match', () => {
    const matches = [
      { routeId: '__root__', params: {} },
      { routeId: '/_auth/$tenantId', params: { tenantId: 'tenant-1' } },
      { routeId: '/_auth/$tenantId/organizations', params: { tenantId: 'tenant-1' } },
    ];

    expect(getTenantIdFromMatches(matches)).toBe('tenant-1');
  });

  it('returns null on a route with no tenant segment', () => {
    const matches = [
      { routeId: '__root__', params: {} },
      { routeId: '/_auth/platform', params: {} },
    ];

    expect(getTenantIdFromMatches(matches)).toBeNull();
  });

  it('returns null on the merged Security section resolved to the platform scope in context', () => {
    const matches = [
      { routeId: '__root__', params: {} },
      { routeId: '/_auth/$tenantId', params: { tenantId: 'tenant-1' } },
      { routeId: '/_auth/$tenantId/{-$organizationId}/settings/security/users', params: { tenantId: 'tenant-1' }, context: { securityScope: 'platform' } },
    ];

    expect(getTenantIdFromMatches(matches)).toBeNull();
  });

  it('keeps the tenant on the merged Security section resolved to the tenant scope in context', () => {
    const matches = [
      { routeId: '__root__', params: {} },
      { routeId: '/_auth/$tenantId', params: { tenantId: 'tenant-1' } },
      { routeId: '/_auth/$tenantId/{-$organizationId}/settings/security/users', params: { tenantId: 'tenant-1' }, context: { securityScope: 'tenant' } },
    ];

    expect(getTenantIdFromMatches(matches)).toBe('tenant-1');
  });

  it('keeps the tenant while the destination context is not resolved yet (the pending-navigation window)', () => {
    const pendingMatches = [
      { routeId: '__root__', params: {} },
      { routeId: '/_auth/$tenantId', params: { tenantId: 'tenant-1' } },
      { routeId: '/_auth/$tenantId/{-$organizationId}/settings/security/users', params: { tenantId: 'tenant-1' } },
    ];

    expect(getTenantIdFromMatches(pendingMatches, { ignoreContext: true })).toBe('tenant-1');
  });

  it('keeps the tenant during the window even when the match carries the previous commit\'s stale platform context', () => {
    // Leaving `?scope=platform` for no scope on the same Security section route: matchRoutes has
    // been observed to carry over that route's already-committed context rather than leaving it
    // unresolved, so the pending path must not trust context at all, not just when it's absent.
    const staleMatches = [
      { routeId: '__root__', params: {} },
      { routeId: '/_auth/$tenantId', params: { tenantId: 'tenant-1' } },
      { routeId: '/_auth/$tenantId/{-$organizationId}/settings/security/users', params: { tenantId: 'tenant-1' }, context: { securityScope: 'platform' } },
    ];

    expect(getTenantIdFromMatches(staleMatches, { ignoreContext: true })).toBe('tenant-1');
  });

  it('keeps the tenant when a `scope=platform` search param is pasted onto a route outside the Security section', () => {
    const matches = [
      { routeId: '__root__', params: {} },
      { routeId: '/_auth/$tenantId', params: { tenantId: 'tenant-1' } },
      { routeId: '/_auth/$tenantId/{-$organizationId}/assets', params: { tenantId: 'tenant-1' }, search: { scope: 'platform' } },
    ];

    expect(getTenantIdFromMatches(matches)).toBe('tenant-1');
  });
});

describe('isPlatformScope', () => {
  it('is false with no route id', () => {
    expect(isPlatformScope(undefined)).toBe(false);
  });

  it('is true under the tenant-less platform surface', () => {
    expect(isPlatformScope('/_auth/platform/security/users')).toBe(true);
  });

  it('is true on the merged section resolved to the platform scope in context', () => {
    expect(isPlatformScope('/_auth/$tenantId/{-$organizationId}/settings/security/roles', { securityScope: 'platform' })).toBe(true);
  });

  it('is false on the merged section resolved to the tenant scope, or with no context', () => {
    expect(isPlatformScope('/_auth/$tenantId/{-$organizationId}/settings/security/roles', { securityScope: 'tenant' })).toBe(false);
    expect(isPlatformScope('/_auth/$tenantId/{-$organizationId}/settings/security/roles')).toBe(false);
  });

  it('is false on an ordinary tenant route', () => {
    expect(isPlatformScope('/_auth/$tenantId/{-$organizationId}/risk-scenarios')).toBe(false);
  });
});
