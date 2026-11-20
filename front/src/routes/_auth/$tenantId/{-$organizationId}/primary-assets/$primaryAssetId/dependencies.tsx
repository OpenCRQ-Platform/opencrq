import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PrimaryAssetDependenciesTab } from '../../../../../../features';
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
  loader: () => ({ crumb: t`Business dependencies` }),
  component: PrimaryAssetDependenciesPage,
});
