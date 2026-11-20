import { createFileRoute } from '@tanstack/react-router';
import { BusinessValueCategoriesDataTable } from '../../../../../../../features';

const RouteComponent = () => <BusinessValueCategoriesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/business-value-categories/')({
  component: RouteComponent,
});
