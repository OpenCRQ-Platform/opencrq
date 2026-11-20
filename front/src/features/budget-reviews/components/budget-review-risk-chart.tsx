import { Paper } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ApexOptions } from 'apexcharts';
import type { FunctionComponent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BuildFigure, BuildMove, BuildMoveLine, RiskPoint, WithoutBuildGap } from '../budget-review-utils';
import { MetricInfo } from '../../../components/shared';
import { ApexChart } from '../../../components/shared/apex-chart';
import { buildChartTooltip, buildTimelineChartOptions, chartSeriesColors, chartVerdictColor } from '../../../components/shared/chart-utils';
import { useTRPC } from '../../../lib';
import { useTheme } from '../../../providers';
import { formatDate } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { LegendSwatch } from '../ui/legend-swatch';
import {
  buildMovesWithin,
  dayTimestamp,
  labelRows,
  monthsAfterPeriod,
  pointLabelSide,
  reviewPeriod,
  timelineMargin,
  withoutBuildGap,
} from '../budget-review-utils';

type ChartAnnotations = NonNullable<ApexOptions['annotations']>;
type PointAnnotations = NonNullable<ChartAnnotations['points']>[number];
type XAxisAnnotations = NonNullable<ChartAnnotations['xaxis']>[number];

const CHART_HEIGHT = 260;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Pixels right of the last day: the bracket, then its labels, their width guessed from a generous
 * glyph width per font size.
 */
const GAP_LAYOUT = { bracketFrom: 8, bracketTo: 16, labels: 24, end: 8, titleCharPx: 7.5, noteCharPx: 5.5 };
/** Hundredths of the period drawn right of the last day when no bracket needs the room. */
const PLAIN_MARGIN = 3;
/** The plot is the chart's measured width less its y axis, a common width until it is measured. */
const PLOT_LAYOUT = { yAxisPx: 64, defaultPx: 720 };
const VALUE_LABEL_SIZE = 12;
/** The move labels stack upward from just above the approximation label, their width guessed from a generous glyph width. */
const MOVE_LABEL_LAYOUT = { baseOffsetY: -18, rowHeight: 14, charPx: 6.5, gapPx: 12 };
/**
 * The marker groups of the p10 to p90 band and of the bracket, series 2 and 3: drawings carried as
 * series, which ApexCharts would give a hover dot like any data with no option to spare them.
 */
const DRAWING_MARKERS = [2, 3].map((index) => `.apexcharts-series-markers-wrap[data\\:realIndex='${index}']`).join(', ');
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector, not copy
const ALE_LINE = '.apexcharts-series[data\\:realIndex="0"] path';

/** ApexCharts takes no opacity per line series, so a translucent one is given an `rgba()` colour. */
const withAlpha = (hex: string, alpha: number): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS colour expression, not copy
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

interface LabelOptions {
  color: string,
  textAnchor: 'start' | 'end',
  offsetX?: number,
  offsetY?: number,
  fontSize?: number,
  fontWeight?: number,
  marker?: number,
}

const pointLabel = (
  x: number,
  y: number,
  text: string,
  { color, textAnchor, offsetX = 0, offsetY = 0, fontSize = VALUE_LABEL_SIZE, fontWeight = 500, marker = 0 }: LabelOptions,
): PointAnnotations => ({
  x,
  y,
  marker: { size: marker, fillColor: color, strokeColor: color, strokeWidth: 0 },
  label: {
    text,
    textAnchor,
    offsetX,
    offsetY,
    borderWidth: 0,
    style: { background: 'transparent', color, fontSize: `${fontSize}px`, fontWeight, padding: { left: 0, right: 0, top: 0, bottom: 0 } },
  },
});

const approximationLabel = (pricedAt: Date, periodEnd: string): string => {
  const model = formatDate(pricedAt);
  const months = monthsAfterPeriod(periodEnd, pricedAt);
  if (months === 0) {
    return t`Approximated, on the model of ${model}`;
  }
  const drift = plural(months, { one: '# month', other: '# months' });
  return t`Approximated, on the model of ${model}: ${drift} after the fiscal year's end`;
};

const moveLabel = (lines: ReadonlyArray<BuildMoveLine>): string =>
  (lines.length === 1 ? lines[0].lineName : plural(lines.length, { one: '# build line', other: '# build lines' }));

const moveValue = ({ lineName, controlNames }: BuildMoveLine): string =>
  (controlNames.length === 0 ? lineName : `${lineName} (${controlNames.join(', ')})`);

interface RiskChartProps {
  points: Array<RiskPoint>,
  gap: WithoutBuildGap | null,
  moves: Array<BuildMove>,
  periodStart: string,
  periodEnd: string,
  approximatedOn: Date | null,
}

const RiskChart: FunctionComponent<RiskChartProps> = ({ points, gap, moves, periodStart, periodEnd, approximatedOn }) => {
  const { effectiveTheme } = useTheme();
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) {
      return;
    }
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        setChartWidth(chart.clientWidth);
      });
    });
    observer.observe(chart);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
  /*
   * Both events fire once the tooltip has drawn its dots. The months right of the curve's end lie
   * past the period, under the bracket's labels, and ApexCharts' time axis takes no label formatter.
   */
  const tidyDrawing = (): void => {
    const chart = chartRef.current;
    chart?.querySelectorAll(DRAWING_MARKERS).forEach((group) => group.remove());
    const end = chart?.querySelector(ALE_LINE)?.getBoundingClientRect().right;
    if (chart === null || end === undefined) {
      return;
    }
    chart.querySelectorAll<SVGTextElement>('.apexcharts-xaxis-label').forEach((label) => {
      label.style.visibility = label.getBoundingClientRect().left > end ? 'hidden' : '';
    });
  };
  const [lineColor] = chartSeriesColors(effectiveTheme);
  const counterfactualColor = chartVerdictColor(effectiveTheme, 'bad');
  const mutedColor = chartVerdictColor(effectiveTheme, 'neutral');
  const first = points[0];
  const last = points[points.length - 1];
  const xMin = dayTimestamp(periodStart);
  const firstX = dayTimestamp(first.date);
  const lastX = dayTimestamp(last.date);
  const spanMs = Math.max(lastX - xMin, 30 * DAY_MS);
  const plotPx = chartWidth > 0 ? chartWidth - PLOT_LAYOUT.yAxisPx : PLOT_LAYOUT.defaultPx;
  // A gap that raises the exposure puts the scope without the work under the curve's end, and the labels swap sides.
  const falls = gap === null || gap.reduction > 0;
  const arrow = falls ? '↓' : '↑';
  const amount = gap === null ? '' : formatDollar(Math.abs(gap.reduction));
  const spread = gap?.reductionSpread ?? null;
  const low = spread === null ? '' : formatDollar(spread.low);
  const high = spread === null ? '' : formatDollar(spread.high);
  const gapTitle = t`≈ ${arrow} ${amount} / year`;
  const gapNote = t`Build work of the period`;
  const gapSpread = spread === null ? null : t`${low} to ${high}`;
  const gapLabelPx = Math.max(
    gapTitle.length * GAP_LAYOUT.titleCharPx,
    gapNote.length * GAP_LAYOUT.noteCharPx,
    (gapSpread ?? '').length * GAP_LAYOUT.noteCharPx,
  );
  const { msPerPx, marginMs } = gap === null
    ? { msPerPx: 0, marginMs: (spanMs * PLAIN_MARGIN) / 100 }
    : timelineMargin(spanMs, plotPx, GAP_LAYOUT.labels + gapLabelPx + GAP_LAYOUT.end);
  const xMax = lastX + marginMs;

  /*
   * A series holds only its own days, never null padding: on series of unequal dates ApexCharts
   * drops the null values but not their dates before pairing them, which shears the hover onto
   * the wrong day. So the tooltip reads its point from the series it hit, by that series' index.
   */
  const pointsBySeries = [points, points.filter((point) => point.without !== null)];
  // A move day the curve has no point on shows on the next point it has.
  const movedBy = (series: ReadonlyArray<RiskPoint>, index: number): Array<BuildMoveLine> => {
    const after = series[index - 1]?.date ?? '';
    return moves.flatMap(({ date, lines }) => (date > after && date <= series[index].date ? lines : []));
  };

  const base = buildTimelineChartOptions({
    mode: effectiveTheme,
    yFormatter: formatDollar,
    xLabelFormat: 'MMM',
    xMin,
    xMax,
    customTooltip: ({ dataPointIndex, seriesIndex }) => {
      const series = pointsBySeries[seriesIndex];
      const point = series?.[dataPointIndex] ?? last;
      const { without } = point;
      const moved = series?.[dataPointIndex] === undefined ? [] : movedBy(series, dataPointIndex);
      return buildChartTooltip({
        timestamp: dayTimestamp(point.date),
        rows: [
          { label: t`Simulated ALE`, value: formatDollar(point.ale), strong: without === null },
          ...(without === null
            ? []
            : [{ label: t`Without the period's work`, value: formatDollar(without), strong: true }]),
          ...moved.map((line) => ({ label: line.finished ? t`Build line finished` : t`Build work`, value: moveValue(line) })),
        ],
      });
    },
  });

  const valueLabels: Array<PointAnnotations> = [
    pointLabel(firstX, first.ale, formatDollar(first.ale), { color: lineColor, textAnchor: 'start', offsetX: 6, marker: 4 }),
    ...(points.length > 1
      ? [pointLabel(lastX, last.ale, formatDollar(last.ale), { color: lineColor, textAnchor: 'end', offsetX: -8, offsetY: falls ? 30 : 0, marker: 4 })]
      : []),
  ];
  const aleSeries = { name: t`Simulated ALE`, type: 'line', data: points.map((point) => [dayTimestamp(point.date), point.ale]) };

  if (gap === null) {
    return (
      <div ref={chartRef}>
        <ApexChart
          type="line"
          height={CHART_HEIGHT}
          width="100%"
          options={{ ...base, colors: [lineColor], annotations: { points: valueLabels } }}
          series={[aleSeries]}
        />
      </div>
    );
  }

  const [, withoutPoints] = pointsBySeries;
  const zone: Array<XAxisAnnotations> = approximatedOn === null
    ? []
    : [{
      x: xMin,
      x2: lastX,
      fillColor: 'transparent',
      opacity: 0,
      borderColor: 'transparent',
      label: {
        text: approximationLabel(approximatedOn, periodEnd),
        orientation: 'horizontal',
        position: 'bottom',
        textAnchor: 'start',
        offsetX: 4,
        borderWidth: 0,
        style: { background: 'transparent', color: mutedColor, fontSize: '11px' },
      },
    }];
  const moveRows = labelRows(moves.map(({ date, lines }) => ({
    start: dayTimestamp(date),
    width: (moveLabel(lines).length * MOVE_LABEL_LAYOUT.charPx + MOVE_LABEL_LAYOUT.gapPx) * msPerPx,
  })));
  const moveMarkers: Array<XAxisAnnotations> = moves.map(({ date, lines }, index) => ({
    x: dayTimestamp(date),
    borderColor: mutedColor,
    strokeDashArray: 3,
    label: {
      text: moveLabel(lines),
      orientation: 'horizontal',
      position: 'bottom',
      textAnchor: 'start',
      offsetX: 4,
      offsetY: MOVE_LABEL_LAYOUT.baseOffsetY - moveRows[index] * MOVE_LABEL_LAYOUT.rowHeight,
      borderWidth: 0,
      style: { background: 'transparent', color: mutedColor, fontSize: '11px' },
    },
  }));
  const moveDots = moves.flatMap(({ date }): Array<PointAnnotations> => {
    const without = withoutPoints.find((point) => point.date >= date)?.without ?? null;
    return without === null ? [] : [pointLabel(dayTimestamp(date), without, '', { color: mutedColor, textAnchor: 'start', marker: 3 })];
  });

  const gapColor = chartVerdictColor(effectiveTheme, falls ? 'good' : 'bad');
  const bracketFrom = lastX + msPerPx * GAP_LAYOUT.bracketFrom;
  const bracketTo = lastX + msPerPx * GAP_LAYOUT.bracketTo;
  const labelX = lastX + msPerPx * GAP_LAYOUT.labels;
  const middle = (gap.current + gap.without) / 2;
  const withoutSpread = gap.withoutSpread;

  const options = {
    ...base,
    colors: [lineColor, counterfactualColor, withAlpha(counterfactualColor, 0.18), gapColor],
    stroke: { curve: 'straight' as const, width: [2.5, 2, 12, 1.5], dashArray: [0, 5, 0, 3] },
    chart: { ...base.chart, events: { ...base.chart?.events, mounted: tidyDrawing, updated: tidyDrawing } },
    annotations: {
      xaxis: [...zone, ...moveMarkers],
      points: [
        ...valueLabels,
        ...moveDots,
        pointLabel(lastX, gap.without, formatDollar(gap.without), {
          color: counterfactualColor,
          ...pointLabelSide(lastX, xMin),
          offsetY: falls ? 0 : 30,
          marker: 4,
        }),
        pointLabel(labelX, middle, gapTitle, {
          color: gapColor,
          textAnchor: 'start',
          offsetY: -6,
          fontSize: 14,
          fontWeight: 600,
        }),
        pointLabel(labelX, middle, gapNote, {
          color: mutedColor,
          textAnchor: 'start',
          offsetY: 9,
          fontSize: 11,
          fontWeight: 400,
        }),
        ...(gapSpread === null
          ? []
          : [pointLabel(labelX, middle, gapSpread, { color: mutedColor, textAnchor: 'start', offsetY: 23, fontSize: 11, fontWeight: 400 })]),
      ],
    },
  };

  return (
    <div ref={chartRef}>
      <ApexChart
        type="line"
        height={CHART_HEIGHT}
        width="100%"
        options={options}
        series={[
          aleSeries,
          { name: t`Without the period's work`, type: 'line', data: withoutPoints.map((point): [number, number | null] => [dayTimestamp(point.date), point.without]) },
          {
            name: t`Without the period's work, p10 to p90`,
            type: 'line',
            data: withoutSpread === null ? [] : [[lastX, withoutSpread.low], [lastX, withoutSpread.high]],
          },
          {
            name: t`Build work of the period`,
            type: 'line',
            data: [[bracketFrom, gap.current], [bracketTo, gap.current], [bracketTo, gap.without], [bracketFrom, gap.without]],
          },
        ]}
      />
    </div>
  );
};

const WithoutBuildInfo: FunctionComponent = () => (
  <MetricInfo
    title={t`Without the period's work`}
    what={t`The build work's effect applied to each day's ALE. Each move of a build line's control counts from its day.`}
    how={t`On each of those days, the latest simulation prices the scope at that day's posture, with and without the build work done by then, and the gap is read as a share of that day's ALE. From the last of those days on, the share is the build figure's.`}
    caveat={t`Past threats, assets and loss estimates are not kept, only postures are, so every day is priced on the latest simulation's model. The further that model is from the fiscal year's end, the less precise the curve.`}
  />
);

interface BudgetReviewRiskChartProps {
  reviewId: string,
  periodStart: string,
  periodEnd: string,
  /** The build lines' figure together, null with no build line. */
  buildFigure: BuildFigure | null,
  lines: ReadonlyArray<{ id: string, name: string }>,
  controls: ReadonlyArray<{ capabilityId: string, name: string }>,
}

const MoveSwatch: FunctionComponent<{ color: string }> = ({ color }) => (
  <span className="inline-flex items-center gap-2 txt-sub-content text-default-secondary">
    <span aria-hidden="true" className="inline-block h-3" style={{ borderLeft: `1.5px dashed ${color}` }} />
    <Trans>A build line's work</Trans>
  </span>
);

/**
 * The scope's real ALE over the period, as context only: it mixes the controls with the threat, the
 * assets and the estimates, which is why the review's figures are counterfactuals rather than a
 * reading of this curve.
 */
export const BudgetReviewRiskChart: FunctionComponent<BudgetReviewRiskChartProps> = ({ reviewId, periodStart, periodEnd, buildFigure, lines, controls }) => {
  const trpc = useTRPC();
  const { effectiveTheme: theme } = useTheme();
  const { data, isLoading } = useQuery(trpc.budgetReviews.getBudgetReviewRiskSeries.queryOptions({ reviewId }));
  const period = reviewPeriod(periodStart, periodEnd);
  const series = data?.points ?? [];
  // The counterfactual is the build lines' figure drawn on the curve: with none, only the real ALE is.
  const points = buildFigure === null ? series.map((point) => ({ ...point, without: null })) : series;
  const gap = withoutBuildGap(points, buildFigure);
  const moves = gap === null ? [] : buildMovesWithin(data?.moves ?? [], lines, controls, period.from, gap.date);
  const approximatedOn = buildFigure === null || data?.pricedAt == null ? null : new Date(data.pricedAt);
  const counterfactualColor = chartVerdictColor(theme, 'bad');

  return (
    <Paper elevation={2} padding={16} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 txt-body2 font-medium">
          <Trans>Risk over the period</Trans>
          {gap !== null && <WithoutBuildInfo />}
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendSwatch color={chartSeriesColors(theme)[0]} dashed={false} label={t`Simulated ALE`} />
          {gap !== null && <LegendSwatch color={counterfactualColor} dashed label={t`Without the period's work`} />}
          {moves.length > 0 && <MoveSwatch color={chartVerdictColor(theme, 'neutral')} />}
        </span>
      </div>
      {points.length === 0
        ? (
          <p className="txt-sub-content text-default-secondary">
            {isLoading ? <Trans>Loading...</Trans> : <Trans>No simulation of this scope's scenarios falls within this period.</Trans>}
          </p>
        )
        : (
          <RiskChart points={points} gap={gap} moves={moves} periodStart={periodStart} periodEnd={periodEnd} approximatedOn={approximatedOn} />
        )}
    </Paper>
  );
};
