import type { LifelineDirection } from '../../components/shared/lifeline-utils';
import { directionBetween } from '../../components/shared/lifeline-utils';
import { utcDayToTimestamp } from './dashboard-utils';

const DAY_MS = 86_400_000;

export type ScenarioTrendMetric = 'likelihood' | 'aleMean';

export interface ScenarioTrendPointLike {
  date: string,
  likelihood: number | null,
  likelihoodP10: number | null,
  likelihoodP90: number | null,
  aleMean: number | null,
}

export interface ScenarioTrendReading {
  values: Array<number>,
  /** Each value's place on the window, from 0 on its first day to 1 on `today`. */
  xs: Array<number>,
  /** The day of the first value, null when there is none. */
  firstDate: string | null,
  current: number | null,
  change: number | null,
  direction: LifelineDirection,
  currentBand: { p10: number, p90: number } | null,
}

/** A day without a reading of the metric is skipped rather than drawn as a gap, so the curve runs on between its neighbours. */
export const readScenarioTrend = (
  points: ReadonlyArray<ScenarioTrendPointLike>,
  metric: ScenarioTrendMetric,
  today: string,
  windowDays: number,
): ScenarioTrendReading => {
  const end = utcDayToTimestamp(today);
  const span = (windowDays - 1) * DAY_MS;
  const measured = points.flatMap((point) => {
    const value = point[metric];
    return value === null ? [] : [{ point, value }];
  });
  const values = measured.map(({ value }) => value);
  const xs = measured.map(({ point }) => (span === 0 ? 1 : Math.min(Math.max(1 - (end - utcDayToTimestamp(point.date)) / span, 0), 1)));
  const firstDate = measured.at(0)?.point.date ?? null;
  const latest = measured.at(-1);
  const currentBand = metric === 'likelihood' && latest !== undefined && latest.point.likelihoodP10 !== null && latest.point.likelihoodP90 !== null
    ? { p10: latest.point.likelihoodP10, p90: latest.point.likelihoodP90 }
    : null;
  const first = values.at(0);
  const current = values.at(-1) ?? null;
  if (first === undefined || current === null || values.length < 2) {
    return { values, xs, firstDate, current, change: null, direction: 'flat', currentBand };
  }
  return { values, xs, firstDate, current, change: current - first, direction: directionBetween(first, current), currentBand };
};

export const scenarioTrendWindow = (today: string, windowDays: number): { start: number, end: number } => {
  const end = utcDayToTimestamp(today);
  return { start: end - (windowDays - 1) * DAY_MS, end };
};
