import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ASSET_CATEGORY_VALUES } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import { SupportingAssetTtps } from '../../../../../../features';
import { useTRPC } from '../../../../../../lib';
import { Route as SupportingAssetRoute } from '../$supportingAssetId';

const SupportingAssetTtpsPage = () => {
  const trpc = useTRPC();
  const { supportingAsset: initialData } = SupportingAssetRoute.useLoaderData();
  const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!supportingAsset) {
    return null;
  }

  if (!ASSET_CATEGORY_VALUES.includes(supportingAsset.categoryId)) {
    return null;
  }

  return <SupportingAssetTtps categoryId={supportingAsset.categoryId} supportingAssetId={supportingAsset.id} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/ttp')({
  loader: () => ({ crumb: t`TTP` }),
  component: SupportingAssetTtpsPage,
});
