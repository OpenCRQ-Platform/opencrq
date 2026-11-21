import { describe, expect, it } from 'vitest';
import { navbarLogoPath } from './navbar-logo-utils';

describe('navbarLogoPath', () => {
  it('opens the home of the tenant on screen, never the tenant-less landing route', () => {
    expect(navbarLogoPath('tenant-1')).toBe('/tenant-1');
  });

  it('keeps the landing route outside a tenant', () => {
    expect(navbarLogoPath(undefined)).toBe('/');
  });
});
