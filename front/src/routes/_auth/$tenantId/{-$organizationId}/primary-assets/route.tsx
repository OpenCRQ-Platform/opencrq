import { t } from '@lingui/core/macro';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

const RouteComponent = () => <Outlet />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/primary-assets')({
  component: RouteComponent,
  loader: ({ params }) => {
    if (params.organizationId === undefined) {
      throw redirect({ to: '/$tenantId/{-$organizationId}', params: { tenantId: params.tenantId } });
    }
    return { crumb: t`Primary Assets` };
  },
});
