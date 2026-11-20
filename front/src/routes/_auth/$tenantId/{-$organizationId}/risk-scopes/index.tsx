import { createFileRoute } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { OrganizationsDataTable } from '../../../../../features';

const RouteComponent: FunctionComponent = () => <OrganizationsDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scopes/')({
  component: RouteComponent,
});
