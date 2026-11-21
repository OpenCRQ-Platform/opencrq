import { PlatformCapability_ManageUsers } from '@app/module/client';
import { Icon } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { createFileRoute, redirect, useLocation } from '@tanstack/react-router';
import { z } from 'zod';
import type { ComponentProps, ReactElement } from 'react';
import type { Link } from '@tanstack/react-router';
import type { MenuEntry } from '../../../../../../components/layout/settings-layout/nav-toolbar-menu';
import type { SecurityEntryKey, SecurityScope } from '../../../../../../components/layout/settings-layout/security-scope-utils';
import { ScopeSwitcher, SecurityLayout, useRevalidateOnLostManageSecurity } from '../../../../../../components';
import {
  resolveSecurityScope,
  SECURITY_ENTRY_ICONS,
  securityEntryFromPathname,
  securityEntryLabel,
  securityScopeEntries,
  securityScopeHref,
  securityScopePin,
  securityScopeSwitchEntry,
} from '../../../../../../components/layout/settings-layout/security-scope-utils';
import { trpcClient } from '../../../../../../lib';

type SecurityMenuEntry = MenuEntry & { linkOption: ComponentProps<typeof Link> };

// `Link`'s generic `search` typing only resolves against one literal `to` at a time, so a table of
// entries pointing at different routes builds a plain `href` instead.
const buildEntry = (tenantId: string, organizationId: string | undefined, securityScope: SecurityScope, key: SecurityEntryKey): SecurityMenuEntry => ({
  linkOption: { href: securityScopeHref(tenantId, organizationId, securityScopePin(key) ?? securityScope, key) },
  label: securityEntryLabel(key),
  icon: <Icon name={SECURITY_ENTRY_ICONS[key]} size={16} aria-hidden />,
});

const buildEntries = (tenantId: string, organizationId: string | undefined, securityScope: SecurityScope): Record<SecurityEntryKey, SecurityMenuEntry> => ({
  roles: buildEntry(tenantId, organizationId, securityScope, 'roles'),
  groups: buildEntry(tenantId, organizationId, securityScope, 'groups'),
  users: buildEntry(tenantId, organizationId, securityScope, 'users'),
  'service-accounts': buildEntry(tenantId, organizationId, securityScope, 'service-accounts'),
  tenants: buildEntry(tenantId, organizationId, securityScope, 'tenants'),
});

const SecurityLayoutComponent = (): ReactElement => {
  const { securityScope, securityEntries, canAccessTenant, canAccessPlatform, hasPlatformManageUsers } = Route.useRouteContext();
  const { tenantId, organizationId } = Route.useParams();
  const { pathname } = useLocation();
  useRevalidateOnLostManageSecurity(canAccessTenant, securityScope);

  const allEntries = buildEntries(tenantId, organizationId, securityScope);
  const entries = securityEntries.map((key) => allEntries[key]);

  const showSwitcher = canAccessTenant && canAccessPlatform;
  const currentEntry = securityEntryFromPathname(pathname) ?? securityEntries[0];
  const tenantTarget = securityScopeSwitchEntry(currentEntry, securityScopeEntries('tenant', { hasPlatformManageUsers }));
  const platformTarget = securityScopeSwitchEntry(currentEntry, securityScopeEntries('platform', { hasPlatformManageUsers }));
  const tenantEntries = buildEntries(tenantId, organizationId, 'tenant');
  const platformEntries = buildEntries(tenantId, organizationId, 'platform');

  return (
    <SecurityLayout
      entries={entries}
      header={showSwitcher && (
        <ScopeSwitcher
          scope={securityScope}
          tenantLinkOption={tenantEntries[tenantTarget].linkOption}
          platformLinkOption={platformEntries[platformTarget].linkOption}
        />
      )}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security')({
  staticData: {
    isVirtual: true,
  },
  validateSearch: z.object({
    scope: z.enum(['tenant', 'platform']).optional(),
  }),
  beforeLoad: async ({ params, search, location }) => {
    const [hasManageSecurity, hasPlatformAccess] = await Promise.all([
      trpcClient.capabilities.hasManageSecurity.query(),
      trpcClient.platformCapabilities.hasPlatformAccess.query(),
    ]);
    const canAccessTenant = hasManageSecurity;
    const canAccessPlatform = hasPlatformAccess;
    if (!canAccessTenant && !canAccessPlatform) {
      throw redirect({ to: '/$tenantId/{-$organizationId}', params: { tenantId: params.tenantId, organizationId: params.organizationId } });
    }
    const hasPlatformManageUsers = canAccessPlatform
      ? await trpcClient.platformCapabilities.hasPlatformCapability.query({ capabilityId: PlatformCapability_ManageUsers })
      : false;
    const pin = securityScopePin(securityEntryFromPathname(location.pathname));
    const securityScope = resolveSecurityScope(search.scope, pin, { canAccessTenant, canAccessPlatform });
    const securityEntries = securityScopeEntries(securityScope, { hasPlatformManageUsers });
    return { canAccessTenant, canAccessPlatform, hasPlatformManageUsers, securityScope, securityEntries };
  },
  loader: () => ({ crumb: t`Security` }),
  component: SecurityLayoutComponent,
});
