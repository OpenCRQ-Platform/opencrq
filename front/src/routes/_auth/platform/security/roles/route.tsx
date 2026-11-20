import { t } from '@lingui/core/macro';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { securityScopeLabel } from '../../../../../components/layout/settings-layout/security-scope-utils';

export const Route = createFileRoute('/_auth/platform/security/roles')({
  beforeLoad: ({ context }) => {
    if (!context.securityEntries.includes('roles')) {
      throw redirect({ href: `/platform/security/${context.securityEntries[0]}` });
    }
  },
  loader: () => ({
    ancestorCrumbs: [{ label: securityScopeLabel('platform'), to: '/platform/security' }],
    crumb: t`Roles`,
  }),
});
