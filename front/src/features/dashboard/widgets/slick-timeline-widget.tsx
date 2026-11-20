import { Activity, DollarSign } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Skeleton } from '@filigran/ui';
import type { FunctionComponent } from 'react';
import { lazy, Suspense, useState } from 'react';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import type { BandMetric, BandWindowId, PlottedBandPoint } from '../exposure-band-utils';
import { MetricInfo } from '../../../components/shared';
import { buildChartTooltip, chartSeriesColors, chartTooltipRow, chartVerdictColor, escapeHtml } from '../../../components/shared/chart-utils';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { useTheme } from '../../../providers';
import { bandFormatters, DEFAULT_BAND_WINDOW, toBandChartSeries } from '../exposure-band-utils';
import { BandWindowSelect } from '../components/band-window-select';
import { Caption, Figure, MetaChip, Panel } from '../components/slick-primitives';
import { useExposureBandData } from '../use-exposure-band-data';

export interface BandForecast {
  /** What is being projected, e.g. a control name. */
  moveLabel: string,
  /** Projected total once it lands. */
  mean: number,
  /**
   * What kind of bound this is, in one sentence. Supplied by whoever computed the projection,
   * because only they know how it was derived.
   */
  note: string,
}

const LazyExposureBandChart = lazy(() =>
  import('../components/exposure-band-chart').then((m) => ({ default: m.ExposureBandChart })));

const CHART_HEIGHT = 340;

/*
 * The move label is a user-typed control name and this string goes to ApexCharts' `innerHTML`
 * sink, so it is escaped here rather than trusted. The note is ours, but it goes through the same
 * escape so nothing in this block depends on knowing which half is which.
 */
/* eslint-disable lingui/no-unlocalized-strings -- markup and inline style, not copy */
const forecastBlock = (projection: BandForecast | null, format: (value: number) => string, accentColor: string): string =>
  (projection === null ? '' : '<div style="margin-top:6px; padding-top:6px; border-top:1px solid currentColor;">'
    + `<div style="font-weight:600; color:${accentColor}; margin-bottom:2px;">${escapeHtml(projection.moveLabel)}</div>${
      chartTooltipRow({ label: t`Projected`, value: format(projection.mean), strong: true })
    }<div style="margin-top:3px; opacity:0.65;">${escapeHtml(projection.note)}</div></div>`);
/* eslint-enable lingui/no-unlocalized-strings */

const buildTooltip = ({ point, format, formatChange, projection, accentColor }: {
  point: PlottedBandPoint,
  format: (value: number) => string,
  formatChange: (value: number) => string,
  projection: BandForecast | null,
  accentColor: string,
}): string => buildChartTooltip({
  timestamp: point.x,
  rows: [
    { label: t`Expected`, value: format(point.mean), strong: true },
    ...(point.delta === null ? [] : [{ label: t`Change`, value: formatChange(point.delta) }]),
  ],
  // Ruled off from the measurements above it, because it is the one block in here that was
  // never observed.
  footer: forecastBlock(projection, format, accentColor),
});

interface SlickTimelineWidgetProps {
  organizationId?: string,
  forecast?: BandForecast | null,
}

/**
 * The timeline, restyled: figures on one aligned row above the chart, controls in the header, and
 * a legend built from swatches rather than left to ApexCharts.
 *
 * Wiring is untouched: same `useExposureBandData`, same `ExposureBandChart`. Everything here is
 * presentation.
 */
export const SlickTimelineWidget: FunctionComponent<SlickTimelineWidgetProps> = ({ organizationId, forecast }) => {
  const [windowId, setWindowId] = useState<BandWindowId>(DEFAULT_BAND_WINDOW);
  const [metric, setMetric] = useState<BandMetric>('ale');
  const data = useExposureBandData(organizationId, windowId, metric);
  const { effectiveTheme } = useTheme();
  const [seriesColor] = chartSeriesColors(effectiveTheme);
  // A projection is only ever drawn for an improvement, so it carries the `good` verdict rather
  // than a colour of its own.
  const forecastColor = chartVerdictColor(effectiveTheme, 'good');

  const series = toBandChartSeries(data.points);
  const latest = series.points.at(-1);
  const isMoney = metric === 'ale';
  const { formatValue, formatChange } = bandFormatters(metric);
  const projection = isMoney ? forecast ?? null : null;

  const metricItems: Array<IconButtonGroupItem<BandMetric>> = [
    { value: 'ale', icon: <DollarSign className="h-4 w-4" />, tooltip: t`Annual loss exposure, in money` },
    { value: 'lef', icon: <Activity className="h-4 w-4" />, tooltip: t`Loss events per year` },
  ];

  const seriesNames = {
    line: t`Expected`,
    forecast: t`Projected`,
  };

  const figures = latest === undefined ? [] : [
    { key: 'mean', caption: t`Expected`, value: formatValue(latest.mean), strong: true },
    ...(latest.delta === null
      ? []
      : [{ key: 'delta', caption: t`Change over the window`, value: formatChange(latest.delta), strong: false }]),
  ];

  return (
    <Panel
      title={isMoney ? <Trans>Exposure over time</Trans> : <Trans>Likelihood over time</Trans>}
      info={
        <MetricInfo
          title={isMoney ? t`Exposure over time` : t`Likelihood over time`}
          what={isMoney
            ? <Trans>Where exposure sits today and how it moved over the window you pick.</Trans>
            : <Trans>How often a year these scenarios are expected to become actual losses.</Trans>}
          how={
            <Trans>
              The line is the expected value on each sampled date: every scenario's most recent
              simulation as of that date, its mean, added up. It is flat between runs rather than
              interpolated. The shaded right-hand region is reserved for projections.
            </Trans>
          }
          caveat={
            <Trans>
              The total carries no band. Adding each scenario's p10 and p90 would assume every
              scenario has its extreme year at once, which is a stress bound, not an interval on
              the total. Each scenario's own band is on its page.
            </Trans>
          }
        />
      }
      action={
        <>
          <IconButtonGroup items={metricItems} value={metric} onChange={setMetric} />
          <BandWindowSelect value={windowId} onChange={setWindowId} />
        </>
      }
    >
      {data.isLoading ? (
        <Skeleton className="h-[340px] w-full" />
      ) : latest === undefined ? (
        // An empty series has two causes that look identical on screen, and only one of them is
        // good news. Say which it is.
        <p className={`txt-sub-content py-16 text-center ${data.hasError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {data.hasError
            ? <Trans>Run history could not be loaded.</Trans>
            : <Trans>No simulation on file yet.</Trans>}
        </p>
      ) : (
        <>
          {/* Figures on a fixed grid, so captions and values each hold one baseline. */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              {figures.map((figure) => (
                <div key={figure.key} className="flex flex-col gap-0.5">
                  <Caption>{figure.caption}</Caption>
                  <Figure className={figure.strong ? 'txt-title' : 'txt-body2 text-muted-foreground'}>
                    {figure.value}
                  </Figure>
                </div>
              ))}
            </div>

            <div className="txt-sub-content text-muted-foreground flex shrink-0 items-center gap-3 whitespace-nowrap">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: seriesColor }} />
                {seriesNames.line}
              </span>
              <span
                className={`flex items-center gap-1.5 transition-opacity ${projection === null ? 'opacity-0' : ''}`}
                style={{ color: forecastColor }}
                aria-hidden={projection === null}
              >
                <span className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: forecastColor }} />
                {seriesNames.forecast}
              </span>
            </div>
          </div>

          <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
            <LazyExposureBandChart
              series={series}
              yFormatter={formatValue}
              seriesNames={seriesNames}
              renderTooltip={(dataPointIndex) => {
                const point = series.points[dataPointIndex];
                return point === undefined
                  ? ''
                  : buildTooltip({ point, format: formatValue, formatChange, projection, accentColor: forecastColor });
              }}
              forecastMean={projection?.mean ?? null}
              ariaLabel={isMoney
                ? t`Expected annual loss exposure over the selected window`
                : t`Expected loss event frequency over the selected window`}
              height={CHART_HEIGHT}
            />
          </Suspense>

          <div className="txt-sub-content text-muted-foreground flex flex-wrap items-center gap-2 border-t pt-2.5">
            <MetaChip>{isMoney ? t`USD` : t`events / year`}</MetaChip>
            {/* An errored history reduces to a portfolio with no runs, which draws exactly like a
                portfolio that was never simulated. The failure has to be stated. */}
            {data.hasError && (
              <span className="text-destructive">
                <Trans>Run history could not be loaded, so this curve is incomplete.</Trans>
              </span>
            )}
          </div>
        </>
      )}
    </Panel>
  );
};
