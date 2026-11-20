import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SupportingAssetProtectedBy } from '../../../../../../features';
import { useTRPC } from '../../../../../../lib';
import { assetNameText } from '../../../../../../utils/asset-name-utils';
import { Route as SupportingAssetRoute } from '../$supportingAssetId';

const SupportingAssetProtectedByPage = () => {
  const trpc = useTRPC();
  const { tenantId } = Route.useParams();
  const { supportingAsset: initialData } = SupportingAssetRoute.useLoaderData();
  const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!supportingAsset) {
    return null;
  }

  return (
    <SupportingAssetProtectedBy
      tenantId={tenantId}
      supportingAssetId={supportingAsset.id}
      supportingAssetName={assetNameText(supportingAsset, t`Unnamed asset`)}
      categoryId={supportingAsset.categoryId}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/protected-by')({
  loader: () => ({ crumb: t`Protected by` }),
  component: SupportingAssetProtectedByPage,
});
