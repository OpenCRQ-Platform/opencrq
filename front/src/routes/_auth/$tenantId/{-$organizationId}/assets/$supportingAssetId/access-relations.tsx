import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SupportingAssetAccessRelationsTab } from '../../../../../../features';
import { useTRPC } from '../../../../../../lib';
import { assetNameText } from '../../../../../../utils/asset-name-utils';
import { Route as SupportingAssetRoute } from '../$supportingAssetId';

const SupportingAssetAccessRelationsPage = () => {
  const trpc = useTRPC();
  const { supportingAsset: initialData } = SupportingAssetRoute.useLoaderData();
  const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions(
    { id: initialData.id },
    { initialData },
  ));
  const current = supportingAsset ?? initialData;

  return (
    <SupportingAssetAccessRelationsTab
      supportingAssetId={initialData.id}
      supportingAssetName={assetNameText(current, t`Unnamed asset`)}
      relations={current.relations}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/access-relations')({
  loader: () => ({ crumb: t`Access relations` }),
  component: SupportingAssetAccessRelationsPage,
});
