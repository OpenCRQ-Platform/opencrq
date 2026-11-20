import type { LifelineDirection } from '../../components/shared/lifeline-utils';
import type { PeriodWindowId } from '../../components/shared/period-window';
import { periodWindowDays } from '../../components/shared/period-window';

export interface DailyCount {
  /** A calendar day, `YYYY-MM-DD`, in the reader's zone. */
  day: string,
  count: number,
}

export interface CountMark {
  day: string,
  count: number,
  previous: number,
  /** From 0 to 1 across the plot. */
  x: number,
  /** Its point in `values`. */
  pointIndex: number,
}

export interface ApplicableFindingsLifeline {
  /** Stepped: a move is two points at the same `xs`, the count held then the new one. */
  values: Array<number>,
  xs: Array<number>,
  marks: Array<CountMark>,
  oldest: DailyCount,
  latest: DailyCount,
  change: number,
}

/** Any move of a count is news, however small against the backlog. */
export const countDirection = (change: number): LifelineDirection => {
  if (change === 0) {
    return 'flat';
  }
  return change > 0 ? 'up' : 'down';
};

/** The window's last days of the series: a window longer than the series reads all of it. Null when it is empty. */
export const buildApplicableFindingsLifeline = (
  series: ReadonlyArray<DailyCount>,
  windowId: PeriodWindowId,
): ApplicableFindingsLifeline | null => {
  const days = series.toSorted((a, b) => a.day.localeCompare(b.day)).slice(-periodWindowDays(windowId));
  const oldest = days.at(0);
  const latest = days.at(-1);
  if (oldest === undefined || latest === undefined) {
    return null;
  }

  const xOf = (index: number): number => (days.length === 1 ? 1 : index / (days.length - 1));
  const values = [oldest.count];
  const xs = [0];
  const marks: Array<CountMark> = [];
  days.slice(1).forEach((current, offset) => {
    const previous = days[offset].count;
    if (current.count === previous) {
      return;
    }
    const x = xOf(offset + 1);
    values.push(previous, current.count);
    xs.push(x, x);
    marks.push({ day: current.day, count: current.count, previous, x, pointIndex: values.length - 1 });
  });
  if (xs.at(-1) !== 1) {
    values.push(latest.count);
    xs.push(1);
  }

  return { values, xs, marks, oldest, latest, change: latest.count - oldest.count };
};
