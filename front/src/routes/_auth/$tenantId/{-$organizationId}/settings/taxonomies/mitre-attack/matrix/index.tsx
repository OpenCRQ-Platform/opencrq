import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { TtpMatrixView } from '../../../../../../../../components/shared/ttp-matrix-view';
import { DetailPageLayout } from '../../../../../../../../components';

const RouteComponent = () => (
  <DetailPageLayout title={t`MITRE ATT&CK Matrix`}>
    <TtpMatrixView highlightedTechniques={[]} />
  </DetailPageLayout>
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/matrix/')({
  component: RouteComponent,
});
