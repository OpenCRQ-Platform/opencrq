import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { AssetEvents } from '../../../../../../features/supporting-assets';

const SupportingAssetEventsPage = () => {
  const { tenantId, supportingAssetId } = Route.useParams();
  return <AssetEvents tenantId={tenantId} supportingAssetId={supportingAssetId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/events')({
  loader: () => ({ crumb: t`Events` }),
  component: SupportingAssetEventsPage,
});
