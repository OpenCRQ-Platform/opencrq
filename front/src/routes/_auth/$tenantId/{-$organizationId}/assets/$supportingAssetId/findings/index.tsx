import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  SUPPORTING_ASSET_FINDINGS_LIST_SEARCH_DEFAULTS,
  supportingAssetFindingsListSearchSchema,
} from '../../../../../../../features/supporting-assets/supporting-asset-findings-list-search';
import { SupportingAssetFindingsSection } from '../../../../../../../features';
import { Route as SupportingAssetRoute } from '../../$supportingAssetId';

const SupportingAssetFindingsPage = () => {
  const { supportingAsset } = SupportingAssetRoute.useLoaderData();

  return (
    <SupportingAssetFindingsSection supportingAssetId={supportingAsset.id} />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/findings/')({
  validateSearch: supportingAssetFindingsListSearchSchema,
  search: { middlewares: [stripSearchParams(SUPPORTING_ASSET_FINDINGS_LIST_SEARCH_DEFAULTS)] },
  component: SupportingAssetFindingsPage,
});
