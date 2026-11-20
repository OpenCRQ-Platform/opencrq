import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { AuthNotice } from '../../features/auth/components/auth-notice';
import { trpcClient } from '../../lib';

const NoAccessPage: FunctionComponent = () => {
  const { auth } = Route.useRouteContext();
  return (
    <AuthNotice
      title={t`You don't have access to OpenCRQ yet`}
      description={t`Ask your administrator for access.`}
      action={<Button priority="secondary" onClick={() => void auth.logout()}>{t`Sign out`}</Button>}
    />
  );
};

/** Where a signed-in user lands: their first tenant, else the platform area, else a page saying they have no access yet. */
export const Route = createFileRoute('/_auth/')({
  beforeLoad: async ({ context }) => {
    const tenants = await context.queryClient.query(context.trpc.tenants.getTenants.queryOptions());

    const targetTenant = tenants.at(0);

    if (targetTenant) {
      throw redirect({
        to: '/$tenantId/{-$organizationId}',
        params: { tenantId: targetTenant.id, organizationId: undefined },
      });
    }

    const hasPlatformAccess = await trpcClient.platformCapabilities.hasPlatformAccess.query();
    if (hasPlatformAccess) {
      throw redirect({ to: '/platform/security/tenants' });
    }
  },
  component: NoAccessPage,
});
