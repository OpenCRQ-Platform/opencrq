import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AttackSection } from '../../../../../../features/finding-detail';
import { useTRPC } from '../../../../../../lib';

const FindingAttackTab = () => {
  const trpc = useTRPC();
  const { evidenceId, tenantId } = Route.useParams();
  const { data: finding } = useQuery(trpc.supportingAssets.getEvidenceDetail.queryOptions({ evidenceId }));
  const { data: scored } = useQuery(trpc.findingScore.getFindingScoreBreakdown.queryOptions({ evidenceId }));

  if (!finding?.cveId || !scored) {
    return null;
  }

  return (
    <AttackSection
      cveId={finding.cveId}
      tenantId={tenantId}
      techniques={scored.columns.techniques}
      categoryId={scored.columns.reachability.categoryId}
      exposure={scored.columns.reachability.exposure}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/attack')({
  loader: () => ({ crumb: t`Attack` }),
  component: FindingAttackTab,
});
