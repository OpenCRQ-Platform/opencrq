import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  CveReferencesCard,
  FindingActivityCard,
  FindingDescriptionCard,
  FindingInstanceCard,
  FindingScoreHistoryCard,
  groupAttackRows,
  VulnerabilityRecordCard,
} from '../../../../../../features/finding-detail';
import { stateDurationLabel } from '../../../../../../features/finding-score';
import { buildLinks } from '../../../../../../features/supporting-assets/connectors-utils';
import { useTRPC } from '../../../../../../lib';

const FindingOverviewTab = () => {
  const trpc = useTRPC();
  const { evidenceId, tenantId } = Route.useParams();
  const { data: finding } = useQuery(trpc.supportingAssets.getEvidenceDetail.queryOptions({ evidenceId }));
  const { data: scored } = useQuery(trpc.findingScore.getFindingScoreBreakdown.queryOptions({ evidenceId }));
  const { data: cveInfo } = useQuery(trpc.cve.getInfo.queryOptions(
    { cveId: finding?.cveId ?? '' },
    { enabled: finding?.cveId != null },
  ));
  const { data: remediation } = useQuery(trpc.cve.getRemediation.queryOptions(
    { cveId: finding?.cveId ?? '' },
    { enabled: finding?.cveId != null },
  ));
  const { data: connectorsStatus } = useQuery(trpc.integrations.getConnectorsStatus.queryOptions());

  if (!finding || !scored) {
    return null;
  }

  // Sources come back oldest-first, so the one shown does not change between two identical requests.
  const primarySource = finding.sources.at(0) ?? null;
  const externalLinks = buildLinks({
    connectorSource: primarySource?.source ?? null,
    sourceScenarioId: finding.sourceScenarioId,
    sourceSimulationId: finding.sourceSimulationId,
    sourceInjectId: finding.sourceInjectId,
    sourceFindingId: primarySource?.sourceFindingId ?? null,
    externalReference: primarySource?.externalReference ?? null,
    openaevUrl: connectorsStatus?.openaev.url ?? null,
  });

  return (
    <div className="flex flex-col gap-5">
      <FindingDescriptionCard description={finding.cveDescription} />
      {/* The two record cards share a row so their own field grids fit two columns instead of
          spreading four fields across the full page width. The row stretches and each card fills
          its cell, so the shorter of the two does not leave a step against its neighbour. */}
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(30rem,1fr))]">
        {finding.cveId !== null && cveInfo !== undefined && cveInfo !== null && (
          <VulnerabilityRecordCard
            className="h-full"
            cveId={finding.cveId}
            tenantId={tenantId}
            vulnerabilityLink="uniqueFinding"
            record={cveInfo}
            attack={{
              evidenceId,
              groups: scored.columns.techniques === null || scored.columns.techniques.rows.length === 0
                ? null
                : groupAttackRows(scored.columns.techniques.rows),
            }}
            sourceFindingId={primarySource?.externalReference ?? primarySource?.sourceFindingId ?? null}
            sourceFindingUrl={externalLinks.finding ?? null}
          />
        )}
        <FindingInstanceCard
          className="h-full"
          tenantId={tenantId}
          supportingAssetId={scored.supportingAssetId}
          assetName={{ name: scored.assetName, derivedName: scored.assetDerivedName }}
          assetCategoryId={scored.assetCategoryId}
          software={finding.software}
          sources={finding.sources.flatMap((s) => (s.source ? [s.source] : []))}
          reportedBy={finding.userName}
          firstSeen={scored.firstSeenAt}
          lastSeen={scored.lastEvaluatedAt}
          state={scored.currentState}
          stateOrigin={finding.history.at(-1)?.origin ?? null}
          dismissalType={finding.history.at(-1)?.dismissalType ?? null}
          dismissalReasonCode={finding.history.at(-1)?.dismissalReasonCode ?? null}
          stateDuration={stateDurationLabel(scored.currentState, scored.currentStateSince, { kind: 'cve', latest: finding.history.at(-1) ?? null })}
        />
      </div>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(30rem,1fr))]">
        <FindingActivityCard className="h-full" history={finding.history} />
        <FindingScoreHistoryCard className="h-full" tenantId={tenantId} evidenceId={evidenceId} />
      </div>
      {remediation !== undefined && <CveReferencesCard references={remediation.references} />}
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/$evidenceId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: FindingOverviewTab,
});
