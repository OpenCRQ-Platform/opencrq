import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PrimaryAssetDependenciesTab } from '../../../../../../features';
import {
  PRIMARY_ASSET_DEPENDENCIES_LIST_SEARCH_DEFAULTS,
  primaryAssetDependenciesListSearchSchema,
} from '../../../../../../features/asset-dependencies/primary-asset-dependencies-list-search';
import { useTRPC } from '../../../../../../lib';
import { Route as PrimaryAssetRoute } from '../$primaryAssetId';

const PrimaryAssetDependenciesPage = () => {
  const trpc = useTRPC();
  const { primaryAsset: initialData } = PrimaryAssetRoute.useLoaderData();
  const { data: primaryAsset } = useQuery(trpc.primaryAssets.getPrimaryAsset.queryOptions(
    { id: initialData.id },
    { initialData },
  ));
  if (!primaryAsset) {
    return null;
  }
  return <PrimaryAssetDependenciesTab primaryAssetId={primaryAsset.id} primaryAssetName={primaryAsset.name} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId/dependencies')({
  validateSearch: primaryAssetDependenciesListSearchSchema,
  search: { middlewares: [stripSearchParams(PRIMARY_ASSET_DEPENDENCIES_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Business dependencies` }),
  component: PrimaryAssetDependenciesPage,
});
