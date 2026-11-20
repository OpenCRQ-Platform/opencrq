import { createFileRoute } from '@tanstack/react-router';
import { GroupsDataTable, PlatformGroupsDataTable } from '../../../../../../../features';

const RouteComponent = () => {
  const { securityScope } = Route.useRouteContext();
  return securityScope === 'platform' ? <PlatformGroupsDataTable /> : <GroupsDataTable />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/groups/')({
  component: RouteComponent,
});
