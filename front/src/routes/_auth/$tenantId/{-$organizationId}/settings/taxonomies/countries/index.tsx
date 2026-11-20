import { createFileRoute } from '@tanstack/react-router';
import { CountriesDataTable } from '../../../../../../../features';

const RouteComponent = () => <CountriesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/countries/')({
  component: RouteComponent,
});
