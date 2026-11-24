import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { FindingScoreSection } from '../../../../../../features/finding-score';
import { useTRPC } from '../../../../../../lib';

const FindingScoreTab = () => {
  const trpc = useTRPC();
  const { evidenceId, tenantId } = Route.useParams();
  const { data: scored } = useQuery(trpc.findingScore.getFindingScoreBreakdown.queryOptions({ evidenceId }));
  const { data: cveInfo } = useQuery(trpc.cve.getInfo.queryOptions(
    { cveId: scored?.cveId ?? '' },
    { enabled: scored?.cveId != null },
  ));

  if (!scored) {
    return null;
  }

  return <FindingScoreSection tenantId={tenantId} finding={scored} nvdRecordMissing={cveInfo?.nvdRecord === 'none'} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/score')({
  loader: () => ({ crumb: t`Score` }),
  component: FindingScoreTab,
});
