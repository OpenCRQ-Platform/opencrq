import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FindingActivityCard, FindingHistoryCard, FindingSourcesCard } from '../../../../../../features/finding-detail';
import { buildLinks } from '../../../../../../features/supporting-assets/connectors-utils';
import { useTRPC } from '../../../../../../lib';

const FindingActivityTab = () => {
  const trpc = useTRPC();
  const { evidenceId } = Route.useParams();
  const { data: finding } = useQuery(trpc.supportingAssets.getEvidenceDetail.queryOptions({ evidenceId }));
  const { data: connectorsStatus } = useQuery(trpc.integrations.getConnectorsStatus.queryOptions());

  if (!finding) {
    return null;
  }

  const sourcesWithLinks = finding.sources.map((source) => ({
    ...source,
    sourceFindingId: source.externalReference ?? source.sourceFindingId ?? null,
    sourceFindingUrl: buildLinks({
      connectorSource: source.source,
      sourceScenarioId: finding.sourceScenarioId,
      sourceSimulationId: finding.sourceSimulationId,
      sourceInjectId: finding.sourceInjectId,
      sourceFindingId: source.sourceFindingId,
      externalReference: source.externalReference,
      openaevUrl: connectorsStatus?.openaev.url ?? null,
    }).finding ?? null,
  }));

  return (
    <div className="flex flex-col gap-5">
      <FindingActivityCard history={finding.history} />
      {sourcesWithLinks.length > 0 && <FindingSourcesCard sources={sourcesWithLinks} />}
      <FindingHistoryCard
        history={finding.history}
        sources={finding.sources}
        // A history row carries no connector id, so it cannot honestly be branded with any one
        // source's name or icon when several report the finding — neutral attribution throughout.
        connectorName={t`Automatic control`}
      />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/activity')({
  loader: () => ({ crumb: t`Activity` }),
  component: FindingActivityTab,
});
