import type { LifelineDirection } from '../../components/shared/lifeline-utils';
import { directionBetween } from '../../components/shared/lifeline-utils';
import { utcDayToTimestamp } from './dashboard-utils';

const DAY_MS = 86_400_000;

export interface ExceedanceHistoryPointLike {
  date: string,
  exceedance: number | null,
}

export interface ExceedanceHistoryPoint {
  date: string,
  /** From 0 on the window's first day to 1 on `today`. */
  x: number,
  probability: number,
}

export type ToleranceSince =
  | { status: 'outside' | 'back', date: string }
  /** Outside on every reading, the first dated on or before the window's first day. */
  | { status: 'outsideThroughout' };

export interface ExceedanceHistory {
  points: Array<ExceedanceHistoryPoint>,
  /** The latest reading minus the first, null until the window holds two. */
  change: number | null,
  direction: LifelineDirection,
  /** Each stretch above the maximum, opened and closed where the line crosses it. */
  aboveStretches: Array<Array<{ x: number, probability: number }>>,
  since: ToleranceSince | null,
}

const aboveStretches = (points: ReadonlyArray<ExceedanceHistoryPoint>, max: number): Array<Array<{ x: number, probability: number }>> => {
  const stretches: Array<Array<{ x: number, probability: number }>> = [];
  let current: Array<{ x: number, probability: number }> | null = null;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from.probability <= max && to.probability <= max) {
      current = null;
      continue;
    }
    const crossing = { x: from.x + ((max - from.probability) / (to.probability - from.probability)) * (to.x - from.x), probability: max };
    if (current === null) {
      current = [from.probability > max ? { x: from.x, probability: from.probability } : crossing];
      stretches.push(current);
    }
    current.push(to.probability > max ? { x: to.x, probability: to.probability } : crossing);
    if (to.probability <= max) {
      current = null;
    }
  }
  return stretches;
};

const readSince = (points: ReadonlyArray<ExceedanceHistoryPoint>, max: number, windowStart: string): ToleranceSince | null => {
  const latest = points.at(-1);
  if (latest === undefined) {
    return null;
  }
  const lastFlip = points.findLastIndex((point) => (point.probability > max) !== (latest.probability > max));
  if (latest.probability > max) {
    return lastFlip === -1 && points[0].date <= windowStart
      ? { status: 'outsideThroughout' }
      : { status: 'outside', date: points[lastFlip + 1].date };
  }
  return lastFlip === -1 ? null : { status: 'back', date: points[lastFlip + 1].date };
};

/**
 * A day whose run kept no distribution is skipped. A probability equal to the maximum is within it.
 * `windowStart` is the server's: the day a run from before the window is carried in on, whatever day
 * `today` is on the reader's clock.
 */
export const readExceedanceHistory = (
  series: ReadonlyArray<ExceedanceHistoryPointLike>,
  maxExceedanceProbability: number,
  today: string,
  windowDays: number,
  windowStart: string,
): ExceedanceHistory => {
  const end = utcDayToTimestamp(today);
  const span = (windowDays - 1) * DAY_MS;
  const points = series.flatMap(({ date, exceedance }) => (exceedance === null
    ? []
    : [{ date, probability: exceedance, x: span === 0 ? 1 : Math.min(Math.max(1 - (end - utcDayToTimestamp(date)) / span, 0), 1) }]));
  const first = points.at(0);
  const latest = points.at(-1);
  const comparable = first !== undefined && latest !== undefined && points.length > 1;
  return {
    points,
    change: comparable ? latest.probability - first.probability : null,
    direction: comparable ? directionBetween(first.probability, latest.probability) : 'flat',
    aboveStretches: aboveStretches(points, maxExceedanceProbability),
    since: readSince(points, maxExceedanceProbability, windowStart),
  };
};

/** The window spans thirteen calendar months, so only today's month needs its year to say which one it is. */
export const sinceNeedsYear = (date: string, today: string): boolean =>
  date.slice(5, 7) === today.slice(5, 7) && date.slice(0, 4) !== today.slice(0, 4);
