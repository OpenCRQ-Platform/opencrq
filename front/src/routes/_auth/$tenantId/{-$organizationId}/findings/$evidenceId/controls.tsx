import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FindingControlsCard } from '../../../../../../features/finding-detail';
import { useTRPC } from '../../../../../../lib';

const FindingControlsTab = () => {
  const trpc = useTRPC();
  const { evidenceId, tenantId } = Route.useParams();
  const { data: scored } = useQuery(trpc.findingScore.getFindingScoreBreakdown.queryOptions({ evidenceId }));

  if (!scored) {
    return null;
  }

  return (
    <FindingControlsCard
      mitigations={scored.columns.mitigations}
      techniqueTests={scored.columns.techniqueTests}
      uncoveredTechniqueExternalIds={scored.columns.uncoveredTechniqueExternalIds}
      categoryId={scored.assetCategoryId}
      tenantId={tenantId}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/controls')({
  loader: () => ({ crumb: t`Controls` }),
  component: FindingControlsTab,
});
