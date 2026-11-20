import { formatDollar, formatDollarChange, formatFixed, formatSignedNumber } from '../../utils';
import { utcDayToTimestamp } from './dashboard-utils';

/**
 * Which quantity the band plots.
 *
 * `ale` is money; `lef` is loss events per year. They are the two halves of `ALE = LEF × SLE`,
 * and only `lef` responds to control work: resistance μ enters vulnerability, and vulnerability
 * only enters LEF. So the choice is not cosmetic: one chart tracks the bill, the other tracks
 * whether defending is working.
 */
export type BandMetric = 'ale' | 'lef';

export interface ExposureBandPoint {
  /** UTC day key, `YYYY-MM-DD`. One of the sampled days of the axis, not necessarily every day. */
  date: string,
  mean: number | null,
}

export const toExposureBandPoints = (
  rows: ReadonlyArray<{ date: string, aleMean: number | null, lefMean: number | null }>,
  metric: BandMetric,
): Array<ExposureBandPoint> => rows.map(({ date, aleMean, lefMean }) => ({ date, mean: metric === 'ale' ? aleMean : lefMean }));

/** Ids only, never labels: a pure util must not return translated text. */
export type BandWindowId = '30d' | '90d' | '6m' | '12m' | 'all';

/** `days: null` means every run on file. */
export const BAND_WINDOWS: Array<{ id: BandWindowId, days: number | null }> = [
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
  { id: '6m', days: 183 },
  { id: '12m', days: 365 },
  { id: 'all', days: null },
];

export const DEFAULT_BAND_WINDOW: BandWindowId = '90d';

export const isBandWindowId = (value: string): value is BandWindowId =>
  BAND_WINDOWS.some((window) => window.id === value);

export const bandWindowDays = (id: BandWindowId): number | null =>
  BAND_WINDOWS.find((window) => window.id === id)?.days ?? null;

const DAY_MS = 86_400_000;

/** One plotted day, with every figure the header and the tooltip both need. */
export interface PlottedBandPoint {
  /** Epoch ms at UTC midnight of the day. */
  x: number,
  date: string,
  mean: number,
  /** Change against the first plotted day. Null on that first day. */
  delta: number | null,
}

export interface BandChartSeries {
  /** The plotted days, which the line shares index for index so a tooltip reads straight back. */
  points: Array<PlottedBandPoint>,
  line: Array<{ x: number, y: number }>,
}

export const toBandChartSeries = (points: Array<ExposureBandPoint>): BandChartSeries => {
  const priced = points.flatMap((point) => (point.mean === null ? [] : [{ date: point.date, mean: point.mean }]));
  const first = priced.at(0)?.mean ?? null;

  const plotted: Array<PlottedBandPoint> = priced.map((point, index) => ({
    x: utcDayToTimestamp(point.date),
    date: point.date,
    mean: point.mean,
    delta: first === null || index === 0 ? null : point.mean - first,
  }));

  return {
    points: plotted,
    line: plotted.map((point) => ({ x: point.x, y: point.mean })),
  };
};

export interface BandFormatters {
  formatValue: (value: number) => string,
  formatChange: (value: number) => string,
}

/** How a metric prints its level and its change: money as compact dollars, the event rate at two decimals. */
export const bandFormatters = (metric: BandMetric): BandFormatters => (metric === 'ale'
  ? { formatValue: formatDollar, formatChange: formatDollarChange }
  : { formatValue: (value) => formatFixed(value, 2), formatChange: (value) => formatSignedNumber(value, 2) });

export interface BandAxisWindow {
  min: number,
  max: number,
}

/** Pads out an axis that would otherwise be a single point wide. */
const SINGLE_POINT_PAD_DAYS = 30;

/**
 * How far into the reserved region the projected point sits, as a share of that region. Half way
 * keeps it clear of the last real point (a projection drawn tight against history reads as the
 * next measurement rather than as a hypothetical) while leaving margin before the right edge.
 */
const FORECAST_POINT_RATIO = 0.5;

/**
 * The two points of the projection line: today's actual, and the same quantity after the move.
 *
 * Drawn as a segment rather than a lone dot so the DROP is what you see. The x of the second
 * point is a layout convention, not a date: the move has no scheduled time.
 */
export const buildForecastSegment = (
  points: Array<PlottedBandPoint>,
  window: BandAxisWindow | null,
  forecastMean: number,
): Array<{ x: number, y: number }> => {
  const last = points.at(-1);
  if (last === undefined || window === null) {
    return [];
  }
  const x = last.x + (window.max - last.x) * FORECAST_POINT_RATIO;
  return [{ x: last.x, y: last.mean }, { x, y: forecastMean }];
};

/**
 * Widens the x axis so the last real day sits at `fillRatio` of the width, reserving the rest
 * for forecast. Nothing is drawn there yet: the empty right-hand side IS the affordance, and
 * it keeps the history from reflowing horizontally once a projection lands beside it.
 */
export const bandAxisWindow = (points: Array<PlottedBandPoint>, fillRatio: number): BandAxisWindow | null => {
  const first = points.at(0);
  const last = points.at(-1);
  if (first === undefined || last === undefined || fillRatio <= 0) {
    return null;
  }
  const span = last.x - first.x;
  if (span <= 0) {
    return { min: first.x, max: first.x + SINGLE_POINT_PAD_DAYS * DAY_MS };
  }
  return { min: first.x, max: first.x + span / fillRatio };
};
