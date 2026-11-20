import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  resolveSecurityScope,
  securityEntryFromPathname,
  securityScopeEntries,
  securityScopeHref,
  securityScopeLabel,
  securityScopePin,
  securityScopeSwitchEntry,
} from './security-scope-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('resolveSecurityScope', () => {
  const reader = (canAccessTenant: boolean, canAccessPlatform: boolean) => ({ canAccessTenant, canAccessPlatform });

  it('lets a pin override the address and the reader', () => {
    expect(resolveSecurityScope('tenant', 'platform', reader(true, true))).toBe('platform');
  });

  it('honours a requested platform scope the reader may open', () => {
    expect(resolveSecurityScope('platform', undefined, reader(true, true))).toBe('platform');
  });

  it('falls back to the tenant scope when the requested platform scope is not open to the reader', () => {
    expect(resolveSecurityScope('platform', undefined, reader(true, false))).toBe('tenant');
  });

  it('honours a requested tenant scope the reader may open', () => {
    expect(resolveSecurityScope('tenant', undefined, reader(true, true))).toBe('tenant');
  });

  it('falls back to the platform scope when the requested tenant scope is not open to the reader', () => {
    expect(resolveSecurityScope('tenant', undefined, reader(false, true))).toBe('platform');
  });

  it('lands a reader with no request on the tenant scope when it is open', () => {
    expect(resolveSecurityScope(undefined, undefined, reader(true, true))).toBe('tenant');
  });

  it('lands a reader with no tenant access on the platform scope', () => {
    expect(resolveSecurityScope(undefined, undefined, reader(false, true))).toBe('platform');
  });

  it('drops a platform pin the reader cannot open, falling back to the requested scope', () => {
    expect(resolveSecurityScope('tenant', 'platform', reader(true, false))).toBe('tenant');
  });

  it('drops a tenant pin the reader cannot open, falling back to whichever scope is open', () => {
    expect(resolveSecurityScope(undefined, 'tenant', reader(false, true))).toBe('platform');
  });
});

describe('securityScopePin', () => {
  it('pins Tenants to the platform scope', () => {
    expect(securityScopePin('tenants')).toBe('platform');
  });

  it('pins Service accounts to the tenant scope', () => {
    expect(securityScopePin('service-accounts')).toBe('tenant');
  });

  it('pins nothing for entries shared by both scopes, or no entry', () => {
    expect(securityScopePin('roles')).toBeUndefined();
    expect(securityScopePin('groups')).toBeUndefined();
    expect(securityScopePin('users')).toBeUndefined();
    expect(securityScopePin(undefined)).toBeUndefined();
  });
});

describe('securityScopeEntries', () => {
  it('offers the four tenant entries regardless of platform capability', () => {
    expect(securityScopeEntries('tenant', { hasPlatformManageUsers: false }))
      .toEqual(['roles', 'groups', 'users', 'service-accounts']);
  });

  it('offers Roles, Groups, Users and Tenants under the platform scope with manage-users', () => {
    expect(securityScopeEntries('platform', { hasPlatformManageUsers: true }))
      .toEqual(['roles', 'groups', 'users', 'tenants']);
  });

  it('drops to Tenants alone under the platform scope without manage-users', () => {
    expect(securityScopeEntries('platform', { hasPlatformManageUsers: false })).toEqual(['tenants']);
  });
});

describe('securityScopeSwitchEntry', () => {
  it('keeps the current entry when the target scope offers it', () => {
    expect(securityScopeSwitchEntry('roles', ['roles', 'groups', 'users', 'tenants'])).toBe('roles');
  });

  it('lands on Users when the target does not offer the current entry but offers Users', () => {
    expect(securityScopeSwitchEntry('service-accounts', ['roles', 'groups', 'users', 'tenants'])).toBe('users');
    expect(securityScopeSwitchEntry('tenants', ['roles', 'groups', 'users', 'service-accounts'])).toBe('users');
  });

  it('lands on the target scope\'s own first entry when it offers neither the current entry nor Users', () => {
    expect(securityScopeSwitchEntry('roles', ['tenants'])).toBe('tenants');
  });
});

describe('securityEntryFromPathname', () => {
  it('reads the entry right after the security segment', () => {
    expect(securityEntryFromPathname('/tenant-1/settings/security/roles')).toBe('roles');
    expect(securityEntryFromPathname('/tenant-1/settings/security/users/user-1')).toBe('users');
    expect(securityEntryFromPathname('/platform/security/tenants')).toBe('tenants');
  });

  it('reads no entry off a pathname with nothing after security', () => {
    expect(securityEntryFromPathname('/tenant-1/settings/security')).toBeUndefined();
  });

  it('reads no entry off a pathname with no security segment at all', () => {
    expect(securityEntryFromPathname('/tenant-1/settings/parameters')).toBeUndefined();
  });
});

describe('securityScopeHref', () => {
  it('builds the section address in the tenant scope, carrying no search', () => {
    expect(securityScopeHref('tenant-1', undefined, 'tenant')).toBe('/tenant-1/settings/security');
  });

  it('builds an entry address in the tenant scope', () => {
    expect(securityScopeHref('tenant-1', 'org-1', 'tenant', 'roles')).toBe('/tenant-1/org-1/settings/security/roles');
  });

  it('carries the platform scope as a search param', () => {
    expect(securityScopeHref('tenant-1', undefined, 'platform')).toBe('/tenant-1/settings/security?scope=platform');
    expect(securityScopeHref('tenant-1', undefined, 'platform', 'tenants')).toBe('/tenant-1/settings/security/tenants?scope=platform');
  });
});

describe('securityScopeLabel', () => {
  it('names the tenant scope', () => {
    expect(securityScopeLabel('tenant')).toBe('This tenant');
  });

  it('names the platform scope', () => {
    expect(securityScopeLabel('platform')).toBe('Platform');
  });
});
