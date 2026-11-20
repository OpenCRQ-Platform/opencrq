import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { USERS_LIST_SEARCH_DEFAULTS, usersListSearchSchema } from '../../../../../features/users/users-list-search';
import { PlatformUsersDataTable } from '../../../../../features';

const RouteComponent: FunctionComponent = () => (
  <PlatformUsersDataTable />
);

export const Route = createFileRoute('/_auth/platform/security/users/')({
  validateSearch: usersListSearchSchema,
  search: { middlewares: [stripSearchParams(USERS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
