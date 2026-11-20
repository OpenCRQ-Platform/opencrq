import { Chip } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { SectionCard } from '../../../../components/shared';
import { AssetName } from '../../../../components/shared/asset-name';
import { useTRPC } from '../../../../lib';
import { useTenant } from '../../../../providers/tenant-provider';
import { EMPTY_VALUE, getCvssSeverity } from '../../../../utils';

const TOP_FINDINGS_LIMIT = 5;

const NO_FINDINGS = { critical: 0, high: 0, medium: 0, low: 0, none: 0, unscored: 0, kev: 0, dismissed: 0, total: 0 };

interface FindingsSummaryCardProps {
  riskScenarioId: string,
}

export const FindingsSummaryCard: FunctionComponent<FindingsSummaryCardProps> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const { tenantId } = useTenant();
  const { data, isError } = useQuery(trpc.riskScenarios.getFindingsSummaryForRiskScenario.queryOptions({
    riskScenarioId,
    topLimit: TOP_FINDINGS_LIMIT,
  }));

  const topFindings = data?.top ?? [];
  const { critical, high, medium, low, none, unscored, kev, dismissed, total } = data?.counts ?? NO_FINDINGS;

  const findingsTabLink = {
    to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/findings',
    params: { tenantId, riskScenarioId },
  } as const;

  return (
    <SectionCard title={t`Top Findings`} cardClassName="h-full p-4">
      {data === undefined && !isError ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="txt-sub-content text-destructive">
          <Trans>Findings could not be loaded, so this is not a clean scenario.</Trans>
        </p>
      ) : total === 0 ? (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>No finding affects the assets in this scenario's blast radius.</Trans>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip severity="critical" label={t`Critical: ${critical}`} />
              <Chip severity="high" label={t`High: ${high}`} />
              <Chip severity="medium" label={t`Medium: ${medium}`} />
              <Chip severity="low" label={t`Low: ${low}`} />
              {none > 0 && <Chip label={t`None: ${none}`} />}
              {unscored > 0 && <Chip label={t`Unscored: ${unscored}`} />}
              <Chip severity="critical" label={t`KEV: ${kev}`} />
              <Chip label={t`Set aside or no longer reported: ${dismissed}`} />
            </div>
            <Link
              {...findingsTabLink}
              className="txt-sub-content text-primary hover:underline"
            >
              <Trans>View findings</Trans>
            </Link>
          </div>
          {topFindings.length === 0 ? (
            <p className="txt-sub-content text-muted-foreground">
              <Trans>Every finding in this scenario's blast radius is set aside or no longer reported.</Trans>
            </p>
          ) : (
            <ul className="divide-y">
              {topFindings.map((finding) => {
                const severity = getCvssSeverity(finding.cvss);
                const [firstThreat] = finding.exploitedBy;
                return (
                  <li key={finding.id}>
                    <Link
                      {...findingsTabLink}
                      className="flex items-center gap-3 py-2 hover:bg-muted/50 transition-colors rounded-md"
                    >
                      <Chip
                        severity={severity ? severity.tone : 'neutral'}
                        className="w-20 justify-center shrink-0"
                        label={severity ? severity.label : EMPTY_VALUE}
                      />
                      <span className="font-mono font-medium shrink-0">{finding.cveId}</span>
                      <AssetName name={finding.supportingAssetName} derivedName={finding.supportingAssetDerivedName} className="text-muted-foreground truncate" />
                      <span className="flex items-center gap-2 ml-auto shrink-0">
                        {firstThreat && (
                          <span className="txt-sub-content text-muted-foreground">
                            {firstThreat.name}
                            {finding.exploitedBy.length > 1 && ` +${finding.exploitedBy.length - 1}`}
                          </span>
                        )}
                        {finding.kev && (
                          <Chip severity="critical" label={t`KEV`} />
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
};
