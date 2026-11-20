import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { PrimaryAssetsDataTable } from '../../../../../features';
import { PRIMARY_ASSETS_LIST_SEARCH_DEFAULTS, primaryAssetsListSearchSchema } from '../../../../../features/primary-assets/primary-assets-list-search';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();
  return organizationId === undefined ? null : <PrimaryAssetsDataTable organizationId={organizationId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/primary-assets/')({
  validateSearch: primaryAssetsListSearchSchema,
  search: { middlewares: [stripSearchParams(PRIMARY_ASSETS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
