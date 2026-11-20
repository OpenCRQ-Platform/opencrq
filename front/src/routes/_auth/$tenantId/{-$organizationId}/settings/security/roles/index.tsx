import { createFileRoute } from '@tanstack/react-router';
import { PlatformRolesDataTable, RolesDataTable } from '../../../../../../../features';

const RouteComponent = () => {
  const { securityScope } = Route.useRouteContext();
  return securityScope === 'platform' ? <PlatformRolesDataTable /> : <RolesDataTable />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/roles/')({
  component: RouteComponent,
});
