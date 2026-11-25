import { TooltipProvider } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { SeverityBand } from '@app/module/client';
import { FINDING_TREND_WINDOW_DAYS, SEVERITY_BANDS } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import type { KpiTileTone } from '../../../components/shared/kpi-icon-tile';
import type { FindingBaselines, FindingsPanelCounts, UniqueFindingsPanelCounts } from '../findings-panel-utils';
import { severityBandLabel } from '../../finding-score/ui/severity-ramp';
import { KpiCard } from '../../../components/shared/kpi-card';
import { formatNumber } from '../../../utils/format-number';
import { formatPanelCount, isCountAbbreviated, resolveUniqueFindingsTrends, toBandCounts } from '../findings-panel-utils';
import { BandTooltip } from './band-tooltip';
import { TrendMark, TrendPill } from './trend-pill';

/**
 * The severity ramp's outline treatment for `low` exists for chips, not tiles, so `low` shares
 * the neutral tile and is told apart by its glyph and its label alone.
 */
const BAND_TILE_TONES: Record<SeverityBand, KpiTileTone> = {
  critical: 'error',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
};

const BAND_TILE_ICONS = {
  critical: 'circle-alert',
  high: 'triangle-alert',
  medium: 'minus',
  low: 'circle-arrow-down',
} as const;

const CARD_COUNT = 3 + SEVERITY_BANDS.length;

/** Long enough that a pointer crossing a card does not open anything, short enough to read as instant. */
const TOOLTIP_DELAY_MS = 150;

const PanelGrid: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  // `md:grid-cols-2` is shipped unlayered by `fds.css` since design system 1.0.0, so it beats the
  // `xl` rule below and pins the row at two cards. The arbitrary form is a name the design system
  // does not generate, so nothing competes for it.
  <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-4">{children}</div>
);

const PanelSkeleton: FunctionComponent = () => (
  <PanelGrid>
    {Array.from({ length: CARD_COUNT }).map((_, index) => (
      <Skeleton key={index} className="h-[138px] w-full rounded-sm" />
    ))}
  </PanelGrid>
);

/** Only the three volume cards need it: their tooltips name a previous stock, never the current one. */
const ExactCountLine: FunctionComponent<{ count: number }> = ({ count }) => {
  if (!isCountAbbreviated(count)) {
    return null;
  }
  const exact = formatNumber(count);
  return <div><Trans>Exact count: {exact}.</Trans></div>;
};

/** With no trend line and an unabbreviated count there is nothing left to say, and an empty tooltip is a control that opens on nothing. */
const volumeTooltip = (trend: ReactNode, count: number): ReactNode => (trend === null && !isCountAbbreviated(count)
  ? null
  : <>{trend}<ExactCountLine count={count} /></>);

/** Shared by both tabs: the assets unique findings span are the ones findings sit on. */
const ImpactedAssetsCard: FunctionComponent<{ counts: FindingsPanelCounts, baselines: FindingBaselines | null }> = ({ counts, baselines }) => {
  const locale = i18n.locale || 'en';
  const days = FINDING_TREND_WINDOW_DAYS;
  const estateAssets = formatNumber(counts.estateAssetCount, locale);
  const assetsDelta = baselines === null ? null : counts.impactedAssets - baselines.impactedAssetsStockBefore;
  const previousAssets = baselines === null ? '' : formatNumber(baselines.impactedAssetsStockBefore, locale);
  return (
    <KpiCard
      label={t`Impacted assets`}
      icon="server"
      tone="info"
      figure={formatPanelCount(counts.impactedAssets, locale)}
      trend={assetsDelta === null ? null : <TrendPill delta={assetsDelta} />}
      subtitle={assetsDelta === null ? <Trans>out of the {estateAssets} assets of this scope</Trans> : null}
      tooltip={volumeTooltip(assetsDelta === null ? null : (
        <div>
          <Trans><TrendMark delta={assetsDelta} signed /> assets with at least one finding over the last {days} days ({previousAssets} previously)</Trans>
        </div>
      ), counts.impactedAssets)}
    />
  );
};

interface FindingsKpiPanelProps {
  counts: FindingsPanelCounts | undefined,
  /**
   * `null` inside a closed risk scope: the daily series the baselines come from is the tenant's, so
   * no comparison over it can be honest about a scope's own estate. The cards then state live
   * counts and no trend, until the per-scope series exists.
   */
  baselines: FindingBaselines | null | undefined,
  isLoading: boolean,
}

/**
 * The five-second state of play, above a findings list this panel never touches.
 */
export const FindingsKpiPanel: FunctionComponent<FindingsKpiPanelProps> = ({ counts, baselines, isLoading }) => {
  if (isLoading || counts === undefined || baselines === undefined) {
    return <PanelSkeleton />;
  }

  const locale = i18n.locale || 'en';
  const days = FINDING_TREND_WINDOW_DAYS;
  const byBand = toBandCounts(counts.bands);
  const estateAssets = formatNumber(counts.estateAssetCount, locale);

  const findingsDelta = baselines === null ? null : counts.findings - baselines.findingsStockBefore;
  const newDelta = baselines === null ? null : counts.newInWindow - baselines.newInPreviousWindow;
  const previousFindings = baselines === null ? '' : formatNumber(baselines.findingsStockBefore, locale);
  const previousNew = baselines === null ? '' : formatNumber(baselines.newInPreviousWindow, locale);

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <PanelGrid>
        <KpiCard
          label={t`Findings`}
          icon="list"
          tone="info"
          figure={formatPanelCount(counts.findings, locale)}
          trend={findingsDelta === null ? null : <TrendPill delta={findingsDelta} />}
          subtitle={findingsDelta === null ? <Trans>out of the {estateAssets} assets of this scope</Trans> : null}
          tooltip={volumeTooltip(findingsDelta === null ? null : (
            <div>
              <Trans><TrendMark delta={findingsDelta} signed /> findings over the last {days} days ({previousFindings} previously)</Trans>
            </div>
          ), counts.findings)}
        />
        <ImpactedAssetsCard counts={counts} baselines={baselines} />
        <KpiCard
          label={t`New, last ${days} days`}
          icon="clock"
          tone="neutral"
          figure={formatPanelCount(counts.newInWindow, locale)}
          trend={newDelta === null ? null : <TrendPill delta={newDelta} />}
          subtitle={newDelta === null ? <Trans>out of the {estateAssets} assets of this scope</Trans> : null}
          tooltip={volumeTooltip(newDelta === null ? null : (
            <div>
              <Trans><TrendMark delta={newDelta} signed /> vs the previous {days} days ({previousNew} then)</Trans>
            </div>
          ), counts.newInWindow)}
        />
        {/* No trend on a band: the score is computed on read, so last week's banding does not exist. */}
        {SEVERITY_BANDS.map((band) => (
          <KpiCard
            key={band}
            label={severityBandLabel(band)}
            icon={BAND_TILE_ICONS[band]}
            tone={BAND_TILE_TONES[band]}
            figure={formatPanelCount(byBand[band].total, locale)}
            subtitle={null}
            tooltip={<BandTooltip band={band} counts={byBand[band]} unit="finding" />}
          />
        ))}
        {counts.pendingVector > 0 && (
          <KpiCard
            label={t`Pending vector`}
            icon="clock"
            tone="neutral"
            figure={formatPanelCount(counts.pendingVector, locale)}
            subtitle={null}
            tooltip={<Trans>Counted in no band: their CVE has no usable CVSS vector, either not scored by NVD yet or with no usable NVD record. The list shows which.</Trans>}
          />
        )}
      </PanelGrid>
    </TooltipProvider>
  );
};

interface UniqueFindingsKpiPanelProps {
  /** The findings panel's own counts, which the impacted assets card and the estate size are read from. */
  counts: FindingsPanelCounts | undefined,
  baselines: FindingBaselines | null | undefined,
  uniqueCounts: UniqueFindingsPanelCounts | undefined,
  isLoading: boolean,
}

/**
 * The findings panel recounted per unique finding, card for card. Its trends come from the unique
 * score's journal, kept per estate, so a closed scope keeps them and the bands carry one too.
 */
export const UniqueFindingsKpiPanel: FunctionComponent<UniqueFindingsKpiPanelProps> = ({ counts, baselines, uniqueCounts, isLoading }) => {
  if (isLoading || counts === undefined || baselines === undefined || uniqueCounts === undefined) {
    return <PanelSkeleton />;
  }

  const locale = i18n.locale || 'en';
  const days = FINDING_TREND_WINDOW_DAYS;
  const byBand = toBandCounts(uniqueCounts.bands);
  const trends = resolveUniqueFindingsTrends(uniqueCounts);
  const estateAssets = formatNumber(counts.estateAssetCount, locale);
  const previousCveGroups = formatNumber(uniqueCounts.baselines?.cveGroupsBefore ?? 0, locale);
  const previousNew = formatNumber(uniqueCounts.baselines?.newInPreviousWindow ?? 0, locale);
  const techniques = formatNumber(uniqueCounts.techniqueGroups, locale);
  const uniqueTooltip = trends.cveGroups === null && uniqueCounts.techniqueGroups === 0 && !isCountAbbreviated(uniqueCounts.uniqueFindings)
    ? null
    : (
      <>
        {trends.cveGroups === null ? null : (
          <div>
            <Trans><TrendMark delta={trends.cveGroups} signed /> CVE unique findings over the last {days} days ({previousCveGroups} previously)</Trans>
          </div>
        )}
        {uniqueCounts.techniqueGroups === 0 ? null : (
          <div className="text-default-secondary"><Trans>Of which {techniques} techniques, with no score and no history.</Trans></div>
        )}
        <ExactCountLine count={uniqueCounts.uniqueFindings} />
      </>
    );

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <PanelGrid>
        <KpiCard
          label={t`Unique findings`}
          icon="list"
          tone="info"
          figure={formatPanelCount(uniqueCounts.uniqueFindings, locale)}
          trend={trends.cveGroups === null ? null : <TrendPill delta={trends.cveGroups} />}
          subtitle={trends.cveGroups === null ? <Trans>out of the {estateAssets} assets of this scope</Trans> : null}
          tooltip={uniqueTooltip}
        />
        <ImpactedAssetsCard counts={counts} baselines={baselines} />
        <KpiCard
          label={t`New, last ${days} days`}
          icon="clock"
          tone="neutral"
          figure={formatPanelCount(uniqueCounts.newInWindow, locale)}
          trend={trends.newInWindow === null ? null : <TrendPill delta={trends.newInWindow} />}
          subtitle={trends.newInWindow === null ? <Trans>out of the {estateAssets} assets of this scope</Trans> : null}
          tooltip={volumeTooltip(trends.newInWindow === null ? null : (
            <div>
              <Trans><TrendMark delta={trends.newInWindow} signed /> vs the previous {days} days ({previousNew} then)</Trans>
            </div>
          ), uniqueCounts.newInWindow)}
        />
        {SEVERITY_BANDS.map((band) => {
          const delta = trends.bands[band];
          return (
            <KpiCard
              key={band}
              label={severityBandLabel(band)}
              icon={BAND_TILE_ICONS[band]}
              tone={BAND_TILE_TONES[band]}
              figure={formatPanelCount(byBand[band].total, locale)}
              trend={delta === null ? null : <TrendPill delta={delta} />}
              subtitle={null}
              tooltip={<BandTooltip band={band} counts={byBand[band]} unit="uniqueFinding" />}
            />
          );
        })}
      </PanelGrid>
    </TooltipProvider>
  );
};
