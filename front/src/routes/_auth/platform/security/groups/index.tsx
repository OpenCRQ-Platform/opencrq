import { createFileRoute } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { PlatformGroupsDataTable } from '../../../../../features';

const RouteComponent: FunctionComponent = () => (
  <PlatformGroupsDataTable />
);

export const Route = createFileRoute('/_auth/platform/security/groups/')({
  component: RouteComponent,
});
