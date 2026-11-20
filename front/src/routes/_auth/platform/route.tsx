import { t } from '@lingui/core/macro';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { MainLayout } from '../../../components';
import { trpcClient } from '../../../lib';

const RouteComponent: FunctionComponent = () => (
  <MainLayout>
    <Outlet />
  </MainLayout>
);

export const Route = createFileRoute('/_auth/platform')({
  staticData: {
    isVirtual: true,
  },
  beforeLoad: async ({ context, location }) => {
    const hasPlatformAccess = await trpcClient.platformCapabilities.hasPlatformAccess.query();

    if (!hasPlatformAccess) {
      throw redirect({ to: '/' });
    }

    const tenants = await context.queryClient.query(context.trpc.tenants.getTenants.queryOptions());
    const firstTenant = tenants.at(0);
    if (firstTenant) {
      // Whoever has a tenant reaches the platform administration from inside it: the same page, in the tenant's shell.
      const security = /^\/platform(\/security(?:\/.*)?)$/.exec(location.pathname);
      if (security) {
        throw redirect({ href: `/${firstTenant.id}/settings${security[1]}?scope=platform` });
      }
      throw redirect({
        to: '/$tenantId/{-$organizationId}',
        params: { tenantId: firstTenant.id, organizationId: undefined },
      });
    }
  },
  loader: () => ({ crumb: t`Settings` }),
  component: RouteComponent,
});
