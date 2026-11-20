import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS, supportingAssetsListSearchSchema } from '../../../../../features/supporting-assets/supporting-assets-list-search';
import { SupportingAssetsDataTable } from '../../../../../features';

const RouteComponent = () => <SupportingAssetsDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/')({
  validateSearch: supportingAssetsListSearchSchema,
  search: { middlewares: [stripSearchParams(SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
