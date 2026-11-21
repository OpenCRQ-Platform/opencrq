import { PlatformCapability_ManageUsers } from '@app/module/client';
import { Icon } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import type { MenuEntry } from '../../../../components/layout/settings-layout/nav-toolbar-menu';
import type { SecurityEntryKey } from '../../../../components/layout/settings-layout/security-scope-utils';
import { SecurityLayout } from '../../../../components';
import { SECURITY_ENTRY_ICONS, securityEntryLabel, securityScopeEntries } from '../../../../components/layout/settings-layout/security-scope-utils';
import { trpcClient } from '../../../../lib';

const PLATFORM_ENTRY_KEYS: Array<SecurityEntryKey> = ['roles', 'groups', 'users', 'tenants'];

// Only the entries the tenant-less platform surface actually offers: `securityScopeEntries('platform', …)`
// never yields `service-accounts` (tenant-only), so this stays partial rather than
// carrying placeholder entries that would point at Roles if that ever changed.
const buildEntries = (): Partial<Record<SecurityEntryKey, MenuEntry>> => Object.fromEntries(
  PLATFORM_ENTRY_KEYS.map((key) => [key, { linkOption: { href: `/platform/security/${key}` }, label: securityEntryLabel(key), icon: <Icon name={SECURITY_ENTRY_ICONS[key]} size={16} aria-hidden /> }]),
);

const SecurityLayoutComponent = () => {
  const { securityEntries } = Route.useRouteContext();
  const allEntries = buildEntries();
  const entries = securityEntries
    .map((key) => allEntries[key])
    .filter((entry): entry is MenuEntry => entry !== undefined);
  return <SecurityLayout entries={entries} />;
};

export const Route = createFileRoute('/_auth/platform/security')({
  staticData: {
    isVirtual: true,
  },
  beforeLoad: async () => {
    const hasPlatformManageUsers = await trpcClient.platformCapabilities.hasPlatformCapability
      .query({ capabilityId: PlatformCapability_ManageUsers });
    return {
      canAccessTenant: false,
      canAccessPlatform: true,
      hasPlatformManageUsers,
      securityScope: 'platform' as const,
      securityEntries: securityScopeEntries('platform', { hasPlatformManageUsers }),
    };
  },
  loader: () => ({ crumb: t`Security` }),
  component: SecurityLayoutComponent,
});
