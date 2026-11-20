import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SupportingAssetDependenciesTab } from '../../../../../../features';
import { useTRPC } from '../../../../../../lib';
import { assetNameText } from '../../../../../../utils/asset-name-utils';
import { Route as SupportingAssetRoute } from '../$supportingAssetId';

const SupportingAssetDependenciesPage = () => {
  const trpc = useTRPC();
  const { supportingAsset: initialData } = SupportingAssetRoute.useLoaderData();
  const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  return (
    <SupportingAssetDependenciesTab
      supportingAssetId={initialData.id}
      supportingAssetName={assetNameText(supportingAsset ?? initialData, t`Unnamed asset`)}
      categoryId={supportingAsset?.categoryId}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/dependencies')({
  loader: () => ({ crumb: t`Business dependencies` }),
  component: SupportingAssetDependenciesPage,
});
