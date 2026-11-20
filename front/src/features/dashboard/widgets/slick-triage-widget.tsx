import { Chip } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { SeverityBucketKey } from '../findings-dashboard-utils';
import type { RankedRow } from '../components/slick-primitives';
import { MetricInfo } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { useTRPC } from '../../../lib';
import { formatFractionAsPercent, getCvssSeverity, getCvssSeverityLabel } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { buildSeverityMix } from '../findings-dashboard-utils';
import { Caption, Figure, Panel, RankedList, ShareBar } from '../components/slick-primitives';

/**
 * A severity ramp, hottest first. Green at the bottom is the CVSS convention and is safe here
 * because every segment of this bar is a finding: the colour grades the work, it never says
 * "fine".
 */
const SEVERITY_BAR_CLASSES: Record<SeverityBucketKey, string> = {
  critical: 'bg-red-600',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-lime-500',
  none: 'bg-muted-foreground/40',
  unscored: 'bg-muted-foreground/25',
};

const bucketLabel = (bucket: SeverityBucketKey): string =>
  bucket === 'unscored' ? t`Unscored` : getCvssSeverityLabel(bucket);

interface SlickTriageWidgetProps {
  organizationId?: string,
}

/**
 * The queue: what the whole backlog is made of, and which findings to work first.
 *
 * The composition bar at the top is what makes the count above it worth showing. "1 247 active
 * findings" on its own is the archetypal vanity metric: it only ever rises and implies no action.
 * Split by severity and set against the assets it touches, the same number says how much of the
 * queue actually demands attention.
 *
 * The magnitude bar on each row is EPSS and nothing else: a published probability that the CVE is
 * exploited within 30 days. No composite is invented: blending CVSS, EPSS and KEV into one score
 * would produce a figure nobody could check against its source.
 */
export const SlickTriageWidget: FunctionComponent<SlickTriageWidgetProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.dashboard.getFindingsOverview.queryOptions({ organizationId }));

  const summary = data?.summary;
  const mix = buildSeverityMix(summary?.severityDistribution ?? {
    critical: 0, high: 0, medium: 0, low: 0, none: 0, unscored: 0,
  });
  const kevCount = summary?.kevCount ?? 0;

  const rows: Array<RankedRow> = (data?.topFindings ?? []).map((finding) => {
    const severity = getCvssSeverity(finding.cvss);
    return {
      id: finding.evidenceId,
      label: finding.cveId,
      value: finding.epss === null ? EMPTY_VALUE : formatFractionAsPercent(finding.epss, 1),
      valueMeta: finding.epss === null ? t`no EPSS` : t`exploit likelihood`,
      ratio: finding.epss,
      meta: (
        <span className="flex min-w-0 items-center gap-1">
          {finding.kev === true && (
            <Chip severity="critical" label={t`KEV`} />
          )}
          {severity && <Chip severity={severity.tone} label={severity.label} />}
          <AssetName name={finding.assetName} derivedName={finding.assetDerivedName} className="txt-mini text-muted-foreground min-w-0 truncate" />
        </span>
      ),
      onClick: () => {
        void navigate({
          to: '/$tenantId/{-$organizationId}/findings/$evidenceId',
          params: (prev) => ({
            tenantId: prev.tenantId ?? '',
            evidenceId: finding.evidenceId,
          }),
        });
      },
    };
  });

  return (
    <Panel
      title={<Trans>The queue</Trans>}
      info={
        <MetricInfo
          title={t`The queue`}
          what={<Trans>What the open backlog is made of, and the findings with the strongest case for being worked today.</Trans>}
          how={
            <Trans>
              Every finding not dismissed, deduplicated so one asset carrying the same CVE from
              several sources counts once. The bar splits that population by CVSS severity, and
              Unscored is a finding whose CVE has no CVSS on file. The rows below are ordered by
              exploitability, known-exploited first, then CVSS, then EPSS, and the figure on each
              is EPSS alone, the published probability the CVE is exploited within 30 days, so a row
              with no EPSS shows no bar rather than a zero. Select a row to open the finding.
            </Trans>
          }
          caveat={
            <Trans>
              This orders by severity, not by effort or by what the asset is worth. Read it next to
              Patch leverage, which ranks the same estate by how many findings one fix closes. None
              of these figures reach the risk model: findings evidence the estate, they are never an
              input to the loss simulation.
            </Trans>
          }
        />
      }
    >
      {data === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Caption><Trans>Open findings</Trans></Caption>
              <Figure className="txt-title">{mix.total}</Figure>
            </div>
            {kevCount > 0 && (
              <span className="txt-sub-content shrink-0 font-medium text-red-600 dark:text-red-400">
                <Trans>{kevCount} known exploited</Trans>
              </span>
            )}
          </div>

          {mix.total > 0 && (
            <>
              <ShareBar
                segments={mix.segments.map((segment) => ({
                  key: segment.bucket,
                  share: segment.share,
                  className: SEVERITY_BAR_CLASSES[segment.bucket],
                  title: `${bucketLabel(segment.bucket)} · ${segment.count}`,
                }))}
              />
              <div className="txt-mini text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                {mix.segments.map((segment) => (
                  <span key={segment.bucket} className="flex items-center gap-1">
                    <span className={`h-2 w-2 shrink-0 rounded-sm ${SEVERITY_BAR_CLASSES[segment.bucket]}`} />
                    {bucketLabel(segment.bucket)}
                    <Figure>{segment.count}</Figure>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <RankedList
        rows={rows}
        isLoading={data === undefined}
        empty={<Trans>No active finding.</Trans>}
        barClassName="bg-red-600/60 dark:bg-red-400/60"
      />
    </Panel>
  );
};
