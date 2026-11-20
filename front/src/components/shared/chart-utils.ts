import { i18n } from '@lingui/core';
import type { ApexOptions } from 'apexcharts';
import { chartLocaleOptions } from './chart-locale-utils';

type ChartMode = 'light' | 'dark';

const CHART_SERIES_COLORS: Record<ChartMode, Array<string>> = {
  light: ['#0015A8', '#7C3AED'],
  dark: ['#0FBCFF', '#A78BFA'],
};

/**
 * The same two series colours ApexCharts is given, for hand-rolled SVG visualizations
 * (the exposure-flow Sankey) that must not drift from the charts beside them.
 */
export const chartSeriesColors = (mode: ChartMode): Array<string> => CHART_SERIES_COLORS[mode];

/** How many hues `categoricalChartColor` alternates before it moves a step toward the card surface. */
export const CATEGORICAL_CHART_HUES = CHART_SERIES_COLORS.light.length;

/** The lightness step of the Nth categorical colour: colours sharing a step differ by hue alone. */
export const categoricalChartStep = (index: number): number => Math.floor(index / CATEGORICAL_CHART_HUES);

/** Which of the hues the Nth categorical colour takes: colours sharing one differ by lightness alone. */
export const categoricalChartHue = (index: number): number => index % CATEGORICAL_CHART_HUES;

/**
 * A fill for the Nth slice of a categorical, non-time-series chart (a pie, a segmented bar): the
 * two chart series hues alternated and ramped toward the card surface with `color-mix`, the same
 * technique the exposure Sankey already ramps a column's nodes with (`nodeColor`), so a new chart
 * never invents a palette of its own.
 */
export const categoricalChartColor = (mode: ChartMode, index: number, count: number): string => {
  const series = CHART_SERIES_COLORS[mode];
  const hue = series[categoricalChartHue(index)];
  const pairIndex = categoricalChartStep(index);
  const steps = Math.max(Math.ceil(count / series.length), 1);
  const ramp = 88 - (pairIndex / Math.max(steps - 1, 1)) * 48;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS colour expression, not copy
  return `color-mix(in srgb, ${hue} ${Math.round(ramp)}%, hsl(var(--card)))`;
};

export type ChartVerdict = 'good' | 'bad' | 'neutral';

/**
 * Colours that state a JUDGEMENT about a series, not its identity. Only ever applied where the
 * direction of the number has an agreed meaning (a shrinking backlog, a projected reduction), so
 * that colour stays a verdict and never becomes decoration.
 *
 * A projection is `good`: it is only ever drawn for an IMPROVEMENT, so it carries the same verdict
 * as a falling exposure delta and must not get a colour of its own.
 */
const CHART_VERDICT_COLORS: Record<ChartMode, Record<ChartVerdict, string>> = {
  light: { good: '#16A34A', bad: '#DC2626', neutral: '#64748B' },
  dark: { good: '#4ADE80', bad: '#F87171', neutral: '#94A3B8' },
};

export const chartVerdictColor = (mode: ChartMode, verdict: ChartVerdict): string =>
  CHART_VERDICT_COLORS[mode][verdict];

/** Neutral wash marking the region that holds projections rather than measurements. */
const CHART_FORECAST_ZONE_COLOR: Record<ChartMode, string> = {
  light: '#64748B',
  dark: '#94A3B8',
};
const CHART_FORECAST_ZONE_OPACITY = 0.09;

const CHART_FORE_COLOR: Record<ChartMode, string> = {
  light: '#7A7C85',
  dark: '#B0B1B5',
};

const CHART_GRID_COLOR: Record<ChartMode, string> = {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  light: 'rgba(0, 0, 0, .1)',
  // eslint-disable-next-line lingui/no-unlocalized-strings
  dark: 'rgba(255, 255, 255, .1)',
};

/**
 * What ApexCharts hands `tooltip.custom`.
 *
 * `seriesIndex` matters as much as `dataPointIndex` and is the half that is easy to forget:
 * ApexCharts resolves the nearest point against the CAPTURED series, so on a chart whose series
 * do not all share one x array the index is relative to whichever series was hit. A caller that
 * indexes a single shared array has to check which series it is being asked about first.
 */
export interface ChartTooltipContext {
  dataPointIndex: number,
  seriesIndex: number,
}

interface BaseChartOptionsParams {
  mode: ChartMode,
  type: 'area' | 'bar' | 'line',
  yFormatter: (value: number) => string,
  /** ApexCharts date format for the tooltip heading. */
  xTooltipFormat: string,
  /**
   * Tracks the x crosshair instead of a marker. Required by any series drawn with `markers.size`
   * 0, which would otherwise leave the whole plot inert. Left unset rather than set to false by
   * charts that never asked: ApexCharts already defaults it to true, and pinning it here would
   * silently turn a working tooltip off.
   */
  sharedTooltip?: true,
  /**
   * Whether x labels are read in UTC. True for series keyed by UTC day, false for series carrying
   * real timestamps, which are read where the viewer is.
   */
  datetimeUTC: boolean,
  yLabelFontSize: string,
  /** Omitted rather than 0 by any chart whose values can legitimately go negative. */
  yMin?: number,
  xMin?: number,
  xMax?: number,
  xLabelFormat?: string,
  customTooltip?: (context: ChartTooltipContext) => string,
}

/**
 * Everything the dashboards' charts agree on: transparent surface, no toolbar or zoom, dashed
 * grid, borderless datetime axis, themed tooltip.
 *
 * The three builders below each restated this block, and had already drifted on details nobody
 * chose: one carried 14px y labels against the others' 12px, and `datetimeUTC` differed with
 * nothing marking it as deliberate. Every legitimate difference is a parameter here, so diverging
 * now means naming the divergence.
 */
const baseChartOptions = ({
  mode, type, yFormatter, xTooltipFormat, sharedTooltip, datetimeUTC, yLabelFontSize,
  yMin, xMin, xMax, xLabelFormat, customTooltip,
}: BaseChartOptionsParams): ApexOptions => ({
  chart: {
    type,
    background: 'transparent',
    foreColor: CHART_FORE_COLOR[mode],
    fontFamily: 'inherit',
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: { enabled: false },
    ...chartLocaleOptions(i18n.locale || 'en'),
  },
  theme: { mode },
  dataLabels: { enabled: false },
  grid: {
    borderColor: CHART_GRID_COLOR[mode],
    strokeDashArray: 3,
  },
  /*
   * `shared` and `intersect` are spread in only when asked for, never emitted as `undefined`.
   * ApexCharts merges options with `Utils.extend`, which iterates `Object.keys` and assigns even
   * an undefined value, so an own key holding `undefined` overwrites the library default rather
   * than leaving it in place.
   */
  tooltip: {
    theme: mode,
    ...(sharedTooltip === undefined ? {} : { shared: sharedTooltip, intersect: false }),
    custom: customTooltip,
    x: { format: xTooltipFormat },
    y: { formatter: yFormatter },
  },
  xaxis: {
    type: 'datetime',
    min: xMin,
    max: xMax,
    labels: { datetimeUTC, format: xLabelFormat, style: { fontSize: '12px' } },
    axisBorder: { show: false },
    axisTicks: { show: false },
    tooltip: { enabled: false },
  },
  yaxis: {
    min: yMin,
    forceNiceScale: true,
    labels: { formatter: yFormatter, style: { fontSize: yLabelFontSize } },
    axisBorder: { show: false },
  },
});

export interface ChartTooltipRow {
  label: string,
  value: string,
  /** The one figure the tooltip exists to state. */
  strong?: boolean,
}

/* eslint-disable lingui/no-unlocalized-strings -- markup and inline style, not copy */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * ApexCharts injects whatever `tooltip.custom` returns with `innerHTML`, so every value that
 * reaches one of these builders is escaped on the way in. Exported because a caller assembling
 * its own block has the same sink and the same obligation: a control name, a scenario name and
 * an asset name are all user-typed.
 */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

/**
 * One label/value line. Exported so a caller can assemble a block the shell knows nothing about
 * (a projection, a footnote) without restating the row's typography.
 */
export const chartTooltipRow = ({ label, value, strong = false }: ChartTooltipRow): string =>
  '<div style="display:flex; justify-content:space-between; gap:20px;">'
  + `<span style="opacity:0.7;">${escapeHtml(label)}</span>`
  + `<span style="font-variant-numeric:tabular-nums; font-weight:${strong ? 700 : 600};">${escapeHtml(value)}</span></div>`;

/**
 * The shell behind every custom tooltip on the dashboards: a date heading over a column of rows.
 *
 * The heading is formatted in UTC because the series it labels are keyed by UTC day. Reading the
 * local date would put the tooltip a day off its own point for anyone west of GMT.
 */
export const buildChartTooltip = ({ timestamp, rows, footer = '' }: {
  timestamp: number,
  rows: Array<ChartTooltipRow>,
  /** Extra markup under the rows, built by the caller with `chartTooltipRow`. */
  footer?: string,
}): string => {
  const heading = new Date(timestamp).toLocaleDateString(i18n.locale || 'en', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return '<div class="txt-sub-content" style="padding:9px 11px; min-width:216px;">'
    + `<div style="font-weight:600; margin-bottom:5px; letter-spacing:0.04em; text-transform:uppercase;">${escapeHtml(heading)}</div>`
    + `${rows.map((row) => chartTooltipRow(row)).join('')}${footer}</div>`;
};
/* eslint-enable lingui/no-unlocalized-strings */

interface TimelineChartOptionsParams {
  mode: ChartMode,
  yFormatter: (value: number) => string,
  xLabelFormat?: string,
  xMin?: number,
  xMax?: number,
  customTooltip?: (context: ChartTooltipContext) => string,
  /** Appends a second, green series for the projection. */
  withForecast?: boolean,
  /** Index of the projection's endpoint within the forecast series, for a permanent marker. */
  forecastMarkerIndex?: number,
  /** Shades everything from here to `xMax` as the projection region. */
  forecastZoneFrom?: number,
}

/**
 * One measured line, and an optional projection drawn after it.
 *
 * `curve: 'straight'`, unlike the area chart's `smooth`: the line is a carry-forward between runs,
 * and a spline through it invents bumps no run produced.
 */
export const buildTimelineChartOptions = ({ mode, yFormatter, xLabelFormat, xMin, xMax, customTooltip, withForecast = false, forecastMarkerIndex = 1, forecastZoneFrom }: TimelineChartOptionsParams): ApexOptions => {
  const [seriesColor] = CHART_SERIES_COLORS[mode];
  const forecastColor = chartVerdictColor(mode, 'good');
  // Every one of these arrays is indexed by series order, so the forecast entry has to be
  // appended to all of them together or the styles shear apart.
  const forecast = <T>(base: Array<T>, extra: T): Array<T> => (withForecast ? [...base, extra] : base);
  return {
    ...baseChartOptions({
      mode,
      type: 'line',
      yFormatter,
      // eslint-disable-next-line lingui/no-unlocalized-strings
      xTooltipFormat: 'dd MMM yyyy',
      /*
       * Shared, and it has to be. A non-shared tooltip captures hover off a MARKER, and these
       * series carry none (`markers.size` is 0), so `shared: false` leaves the whole plot inert.
       * Shared tracks the x crosshair across the plot area instead and needs no marker, which
       * is also why the tooltip is keyed on the date rather than on which series was hit.
       */
      sharedTooltip: true,
      datetimeUTC: true,
      yLabelFontSize: '12px',
      yMin: 0,
      xMin,
      xMax,
      xLabelFormat,
      customTooltip,
    }),
    colors: forecast([seriesColor], forecastColor),
    stroke: {
      curve: 'straight',
      width: forecast([2.5], 2.5),
      dashArray: forecast([0], 5),
    },
    /*
     * `size` MUST stay a scalar 0. An array here breaks `hover.size`, and hover markers are how
     * the chart signals interactivity at all. The projection's permanent endpoint is placed
     * through `discrete`, which marks one point without changing the type of `size`.
     */
    markers: {
      size: 0,
      hover: { size: 5 },
      strokeWidth: 0,
      discrete: withForecast
        ? [{
          seriesIndex: 1,
          dataPointIndex: forecastMarkerIndex,
          fillColor: forecastColor,
          strokeColor: forecastColor,
          size: 5,
          shape: 'circle' as const,
        }]
        : [],
    },
    // Marks the region as "not measured". Drawn whether or not a projection is showing, so the
    // empty right-hand side reads as reserved space rather than as missing data.
    annotations: forecastZoneFrom === undefined || xMax === undefined ? {} : {
      xaxis: [{
        x: forecastZoneFrom,
        x2: xMax,
        fillColor: CHART_FORECAST_ZONE_COLOR[mode],
        opacity: CHART_FORECAST_ZONE_OPACITY,
        borderColor: 'transparent',
      }],
    },
    legend: { show: false },
  };
};

interface MonthlyFlowChartOptionsParams {
  mode: ChartMode,
  yFormatter: (value: number) => string,
  capacity: number,
  capacityLabel: string,
  customTooltip?: (context: ChartTooltipContext) => string,
}

/** The y axis is stretched to hold the capacity: ApexCharts draws an annotation above the highest bar outside the plot. */
export const buildMonthlyFlowChartOptions = ({ mode, yFormatter, capacity, capacityLabel, customTooltip }: MonthlyFlowChartOptionsParams): ApexOptions => {
  const base = baseChartOptions({
    mode,
    type: 'bar',
    yFormatter,
    // eslint-disable-next-line lingui/no-unlocalized-strings
    xTooltipFormat: 'MMM yyyy',
    sharedTooltip: true,
    datetimeUTC: true,
    yLabelFontSize: '12px',
    yMin: 0,
    // eslint-disable-next-line lingui/no-unlocalized-strings
    xLabelFormat: 'MMM yy',
    customTooltip,
  });
  return {
    ...base,
    colors: CHART_SERIES_COLORS[mode],
    plotOptions: { bar: { columnWidth: '60%', borderRadius: 3, borderRadiusApplication: 'end' } },
    legend: { show: true, position: 'top', horizontalAlign: 'left', fontSize: '12px' },
    yaxis: { ...base.yaxis, max: (max: number) => Math.max(max, capacity * 1.1) },
    annotations: {
      yaxis: [{
        y: capacity,
        borderColor: CHART_FORE_COLOR[mode],
        strokeDashArray: 6,
        label: {
          text: capacityLabel,
          position: 'left',
          textAnchor: 'start',
          borderWidth: 0,
          style: { background: 'transparent', color: CHART_FORE_COLOR[mode], fontSize: '12px' },
        },
      }],
    },
  };
};

interface AreaChartOptionsParams {
  mode: ChartMode,
  yFormatter: (value: number) => string,
  markerSize?: number,
  xMin?: number,
  xMax?: number,
  xLabelFormat?: string,
  customTooltip?: (context: ChartTooltipContext) => string,
  seriesCount?: number,
  showLegend?: boolean,
}

export const buildAreaChartOptions = ({ mode, yFormatter, markerSize = 0, xMin, xMax, xLabelFormat, customTooltip, seriesCount = 1, showLegend = false }: AreaChartOptionsParams): ApexOptions => ({
  ...baseChartOptions({
    mode,
    type: 'area',
    yFormatter,
    // eslint-disable-next-line lingui/no-unlocalized-strings
    xTooltipFormat: 'dd MMM yyyy HH:mm',
    datetimeUTC: false,
    yLabelFontSize: '14px',
    yMin: 0,
    xMin,
    xMax,
    xLabelFormat,
    customTooltip,
  }),
  colors: CHART_SERIES_COLORS[mode].slice(0, seriesCount),
  stroke: { curve: 'smooth', width: 2 },
  markers: { size: markerSize, strokeWidth: 0 },
  legend: { show: showLegend },
  fill: {
    type: 'gradient',
    gradient: {
      shade: mode,
      shadeIntensity: 1,
      opacityFrom: 0.7,
      opacityTo: 0.1,
      gradientToColors: CHART_SERIES_COLORS[mode].slice(0, seriesCount),
    },
  },
});
