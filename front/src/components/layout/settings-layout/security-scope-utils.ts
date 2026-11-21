import { t } from '@lingui/core/macro';
import type { IconName } from '@filigran/design-system';
import { scopePath } from '../scope-path-utils';

export type SecurityScope = 'tenant' | 'platform';

export type SecurityEntryKey = 'roles' | 'groups' | 'users' | 'service-accounts' | 'tenants';

const TENANT_ENTRIES: Array<SecurityEntryKey> = ['roles', 'groups', 'users', 'service-accounts'];
const PLATFORM_ENTRIES: Array<SecurityEntryKey> = ['roles', 'groups', 'users', 'tenants'];
const PLATFORM_ENTRIES_TENANTS_ONLY: Array<SecurityEntryKey> = ['tenants'];
const ALL_ENTRY_KEYS: Array<SecurityEntryKey> = ['roles', 'groups', 'users', 'service-accounts', 'tenants'];

/**
 * The design system icon a Security nav entry renders, shared by the tenant-scoped and the tenant-less
 * menu. The same glyph per entry as the OpenAEV Security menu (one table for both products): Users
 * `user`, Groups `users`, Roles `shield`, Organizations `building-2`, Sessions `key`, Policies
 * `shield-check`, Marking definitions `focus`, Service accounts `key-round`, Tenants `landmark`,
 * This tenant `building-2`, Platform `earth`.
 */
export const SECURITY_ENTRY_ICONS: Record<SecurityEntryKey, IconName> = {
  roles: 'shield',
  groups: 'users',
  users: 'user',
  'service-accounts': 'key-round',
  tenants: 'landmark',
};

/** The label a Security nav entry renders, shared by the tenant-scoped and the tenant-less menu. */
export const securityEntryLabel = (entry: SecurityEntryKey): string => {
  switch (entry) {
    case 'roles': return t`Roles`;
    case 'groups': return t`Groups`;
    case 'users': return t`Users`;
    case 'service-accounts': return t`Service accounts`;
    case 'tenants': return t`Tenants`;
  }
};

export interface SecurityScopeReader {
  canAccessTenant: boolean,
  canAccessPlatform: boolean,
  hasPlatformManageUsers: boolean,
}

/**
 * The scope a Security page renders: a surface pin (Tenants only exists under the platform
 * scope, Service accounts only under the tenant scope) wins over the address,
 * which wins over the reader's capabilities. A pin only wins when the reader can actually open
 * that scope, otherwise it is dropped rather than serving a page the reader has no right to.
 * Falls back to whichever scope the reader can open, tenant first, so an address requesting a
 * scope the reader may not open never resolves to an empty or forbidden page.
 */
export const resolveSecurityScope = (
  requested: SecurityScope | undefined,
  pinned: SecurityScope | undefined,
  reader: Pick<SecurityScopeReader, 'canAccessTenant' | 'canAccessPlatform'>,
): SecurityScope => {
  if (pinned === 'platform' && reader.canAccessPlatform) {
    return 'platform';
  }
  if (pinned === 'tenant' && reader.canAccessTenant) {
    return 'tenant';
  }
  if (requested === 'platform' && reader.canAccessPlatform) {
    return 'platform';
  }
  if (requested === 'tenant' && reader.canAccessTenant) {
    return 'tenant';
  }
  return reader.canAccessTenant ? 'tenant' : 'platform';
};

/** The scope an entry is pinned to, when it exists in only one of the two. */
export const securityScopePin = (entry: SecurityEntryKey | undefined): SecurityScope | undefined => {
  if (entry === 'tenants') {
    return 'platform';
  }
  if (entry === 'service-accounts') {
    return 'tenant';
  }
  return undefined;
};

/** The entries a scope offers, in display order. Platform drops to Tenants alone without the manage-users capability. */
export const securityScopeEntries = (
  scope: SecurityScope,
  reader: Pick<SecurityScopeReader, 'hasPlatformManageUsers'>,
): Array<SecurityEntryKey> => {
  if (scope === 'tenant') {
    return TENANT_ENTRIES;
  }
  return reader.hasPlatformManageUsers ? PLATFORM_ENTRIES : PLATFORM_ENTRIES_TENANTS_ONLY;
};

/**
 * Where a scope change lands: the same entry when the target scope offers it, Users when it
 * does not and the target offers Users, else the target's own first entry.
 */
export const securityScopeSwitchEntry = (
  currentEntry: SecurityEntryKey,
  targetEntries: Array<SecurityEntryKey>,
): SecurityEntryKey => {
  if (targetEntries.includes(currentEntry)) {
    return currentEntry;
  }
  return targetEntries.includes('users') ? 'users' : targetEntries[0];
};

export const securityScopeLabel = (scope: SecurityScope): string => (scope === 'platform' ? t`Platform` : t`This tenant`);

/** The entry a Security pathname names, read from the segment right after `security`. */
export const securityEntryFromPathname = (pathname: string): SecurityEntryKey | undefined => {
  const segments = pathname.split('/');
  const afterSecurity = segments[segments.indexOf('security') + 1];
  return ALL_ENTRY_KEYS.find((key) => key === afterSecurity);
};

/**
 * The address of a Security page in a given scope: an entry's own page, or the section itself
 * (its index redirects to the scope's first entry) when none is named. Carries `?scope=platform`
 * whenever the scope isn't the tenant default, so the link keeps landing there on a reload.
 */
export const securityScopeHref = (
  tenantId: string,
  organizationId: string | undefined,
  scope: SecurityScope,
  entry?: SecurityEntryKey,
): string => {
  const surface = entry ? `settings/security/${entry}` : 'settings/security';
  const path = scopePath(tenantId, organizationId, surface);
  return scope === 'platform' ? `${path}?scope=platform` : path;
};
