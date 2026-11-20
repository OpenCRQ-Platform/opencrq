import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { USERS_LIST_SEARCH_DEFAULTS, usersListSearchSchema } from '../../../../../../../features/users/users-list-search';
import { PlatformUsersDataTable, UsersDataTable } from '../../../../../../../features';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/security/users/')({
  validateSearch: usersListSearchSchema,
  search: { middlewares: [stripSearchParams(USERS_LIST_SEARCH_DEFAULTS)] },
  component: function UsersRoute() {
    const { securityScope } = Route.useRouteContext();
    return securityScope === 'platform' ? <PlatformUsersDataTable /> : <UsersDataTable />;
  },
});
