import type { LifelineDirection } from '../../components/shared/lifeline-utils';
import { directionBetween } from '../../components/shared/lifeline-utils';
import { utcDayToTimestamp } from './dashboard-utils';

export const AGGREGATE_RISK_WINDOW_DAYS = 365;

export type AggregateRiskMetric = 'likelihood' | 'magnitude' | 'ale';

export interface AggregateRiskPointLike {
  date: string,
  ale: number | null,
  likelihood: number | null,
  magnitude: number | null,
}

export interface AggregateRiskReading {
  values: Array<number | null>,
  /** The day of the first reading, null when there is none. */
  firstDate: string | null,
  current: number | null,
  /** Null until the series holds two readings. */
  change: number | null,
  direction: LifelineDirection,
}

/** The change spans the first reading to the last, the stretch the curve draws. */
export const readAggregateRisk = (points: ReadonlyArray<AggregateRiskPointLike>, metric: AggregateRiskMetric): AggregateRiskReading => {
  const values = points.map((point) => point[metric]);
  const measured = values.filter((value): value is number => value !== null);
  const first = measured.at(0);
  const firstDate = points.find((point) => point[metric] !== null)?.date ?? null;
  const current = measured.at(-1) ?? null;
  if (first === undefined || current === null || measured.length < 2) {
    return { values, firstDate, current, change: null, direction: 'flat' };
  }
  return { values, firstDate, current, change: current - first, direction: directionBetween(first, current) };
};

/** The window ends on the server's today and opens a year before, though the series starts at its first reading when no run predates it. */
export const aggregateRiskWindow = (points: ReadonlyArray<AggregateRiskPointLike>): { start: number, end: number } | null => {
  const last = points.at(-1);
  if (last === undefined) {
    return null;
  }
  const end = utcDayToTimestamp(last.date);
  return { start: end - (AGGREGATE_RISK_WINDOW_DAYS - 1) * 86_400_000, end };
};

/** The window's first day as a UTC day key, read from the server's own today so no browser clock enters it. */
export const aggregateRiskWindowStartDay = (points: ReadonlyArray<AggregateRiskPointLike>): string | null => {
  const window = aggregateRiskWindow(points);
  return window === null ? null : new Date(window.start).toISOString().slice(0, 10);
};
