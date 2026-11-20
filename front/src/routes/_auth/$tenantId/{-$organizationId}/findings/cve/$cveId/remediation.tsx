import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { RemediationSection } from '../../../../../../../features/finding-detail';

const UniqueCveFindingRemediationTab = () => {
  const { cveId } = Route.useParams();
  return <RemediationSection cveId={cveId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId/remediation')({
  loader: () => ({ crumb: t`Remediation` }),
  component: UniqueCveFindingRemediationTab,
});
