import { createFileRoute } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { DependencyResourceTypesDataTable } from '../../../../../../../features';

const RouteComponent: FunctionComponent = () => <DependencyResourceTypesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/dependency-resource-types/')({
  component: RouteComponent,
});
