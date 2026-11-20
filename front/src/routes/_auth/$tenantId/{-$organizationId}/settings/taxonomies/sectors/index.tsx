import { createFileRoute } from '@tanstack/react-router';
import { SectorsDataTable } from '../../../../../../../features';

const RouteComponent = () => <SectorsDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/sectors/')({
  component: RouteComponent,
});
