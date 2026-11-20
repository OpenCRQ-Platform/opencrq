import { createFileRoute } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { PlatformRolesDataTable } from '../../../../../features';

const RouteComponent: FunctionComponent = () => (
  <PlatformRolesDataTable />
);

export const Route = createFileRoute('/_auth/platform/security/roles/')({
  component: RouteComponent,
});
