import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { FindingScoreSection } from '../../../../../../features/finding-score';
import { useTRPC } from '../../../../../../lib';

const FindingScoreTab = () => {
  const trpc = useTRPC();
  const { evidenceId, tenantId } = Route.useParams();
  const { data: scored } = useQuery(trpc.findingScore.getFindingScoreBreakdown.queryOptions({ evidenceId }));

  if (!scored) {
    return null;
  }

  return <FindingScoreSection tenantId={tenantId} finding={scored} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/score')({
  loader: () => ({ crumb: t`Score` }),
  component: FindingScoreTab,
});
