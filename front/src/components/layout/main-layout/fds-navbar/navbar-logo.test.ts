import { describe, expect, it } from 'vitest';
import { navbarLogoLink } from './navbar-logo';

describe('navbarLogoLink', () => {
  it('opens the home of the tenant on screen, never the tenant-less landing route', () => {
    expect(navbarLogoLink('tenant-1')).toEqual({
      to: '/$tenantId/{-$organizationId}',
      params: { tenantId: 'tenant-1', organizationId: undefined },
    });
  });

  it('keeps the landing route outside a tenant', () => {
    expect(navbarLogoLink(undefined)).toEqual({ to: '/' });
  });
});
