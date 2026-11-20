import { createFileRoute, Outlet } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';

const RouteComponent = () => <Outlet />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/integrations')({
  component: RouteComponent,
  loader: () => ({
    crumb: t`Integrations`,
  }),
});
