import { t } from '@lingui/core/macro';
import { createFileRoute, Outlet } from '@tanstack/react-router';

const RouteComponent = () => <Outlet />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/countries')({
  component: RouteComponent,
  loader: () => ({
    crumb: t`Countries`,
  }),
});
