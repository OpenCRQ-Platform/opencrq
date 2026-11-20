import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  CveReferencesCard,
  DossierCard,
  FindingDescriptionCard,
  groupAttackRows,
  VulnerabilityRecordCard,
} from '../../../../../../../features/finding-detail';
import { CveAssetsActivityChart } from '../../../../../../../features/supporting-assets/components/cve-assets-activity-chart';
import { DEFAULT_PERIOD_WINDOW } from '../../../../../../../components/shared/period-window';
import { CveScenariosCard, partialWaysIn, uniqueAttackClaimRows, UniqueScoreLifeline, UniqueScoreStrip } from '../../../../../../../features/unique-cve-finding';
import { useTRPC } from '../../../../../../../lib';

const UniqueCveFindingOverviewTab = () => {
  const trpc = useTRPC();
  const { tenantId, organizationId, cveId } = Route.useParams();
  const { data: finding } = useQuery(trpc.findingScore.getUniqueCveFinding.queryOptions({ cveId, organizationId: organizationId ?? null }));
  const { data: cveInfo } = useQuery(trpc.cve.getInfo.queryOptions({ cveId }));
  const { data: remediation } = useQuery(trpc.cve.getRemediation.queryOptions({ cveId }));
  const { data: attack } = useQuery(trpc.findingScore.getUniqueCveFindingAttack.queryOptions({ cveId, organizationId: organizationId ?? null }));
  const { data: history, isError: historyFailed } = useQuery(trpc.findingScore.getUniqueFindingScoreHistory.queryOptions({ cveId, organizationId: organizationId ?? null }));

  if (!finding) {
    return null;
  }

  const attackRows = attack ? uniqueAttackClaimRows(attack) : [];

  return (
    <div className="flex flex-col gap-5">
      <UniqueScoreStrip
        tenantId={tenantId}
        cveId={cveId}
        score={finding.score}
        band={finding.band}
        worstScore={finding.worstScore}
        pendingVector={finding.pendingVector}
        affectedAssetCount={finding.affectedAssetCount}
        composition={finding.composition}
        aside={(
          <UniqueScoreLifeline
            tenantId={tenantId}
            cveId={cveId}
            lines={history}
            isError={historyFailed}
            defaultWindow={DEFAULT_PERIOD_WINDOW}
          />
        )}
      />
      <CveScenariosCard cveId={cveId} organizationId={organizationId ?? null} />
      {cveInfo !== undefined && cveInfo !== null && (
        <>
          <FindingDescriptionCard description={cveInfo.cveDescription} />
          <VulnerabilityRecordCard
            tenantId={tenantId}
            cveId={cveId}
            vulnerabilityLink="taxonomy"
            record={cveInfo}
            attack={attack ? {
              groups: attackRows.length === 0 ? null : groupAttackRows(attackRows),
              partialWaysIn: partialWaysIn(attack),
            } : undefined}
          />
        </>
      )}
      <DossierCard label={t`Impacted assets over 12 months`}>
        <CveAssetsActivityChart cveId={cveId} organizationId={organizationId ?? null} />
      </DossierCard>
      {remediation !== undefined && <CveReferencesCard references={remediation.references} />}
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: UniqueCveFindingOverviewTab,
});
