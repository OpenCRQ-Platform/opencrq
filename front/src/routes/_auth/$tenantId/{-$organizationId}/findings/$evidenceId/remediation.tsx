import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RemediationSection } from '../../../../../../features/finding-detail';
import { useTRPC } from '../../../../../../lib';

const FindingRemediationTab = () => {
  const trpc = useTRPC();
  const { evidenceId } = Route.useParams();
  const { data: finding } = useQuery(trpc.supportingAssets.getEvidenceDetail.queryOptions({ evidenceId }));

  if (!finding?.cveId) {
    return null;
  }

  return <RemediationSection cveId={finding.cveId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/remediation')({
  loader: () => ({ crumb: t`Remediation` }),
  component: FindingRemediationTab,
});
