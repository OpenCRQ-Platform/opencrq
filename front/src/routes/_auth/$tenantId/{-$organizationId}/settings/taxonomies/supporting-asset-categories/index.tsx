import { createFileRoute } from '@tanstack/react-router';
import { SupportingAssetCategoriesDataTable } from '../../../../../../../features';

const RouteComponent = () => <SupportingAssetCategoriesDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/supporting-asset-categories/')({
  component: RouteComponent,
});
