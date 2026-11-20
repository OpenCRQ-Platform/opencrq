import { i18n } from '@lingui/core';

export const WEEKS = 52;
export const DAYS_PER_WEEK = 7;
export const CELL_SIZE = 11;
export const GAP = 2;
export const STEP = CELL_SIZE + GAP;
export const DAY_LABEL_WIDTH = 26;

export const CHART_WIDTH = DAY_LABEL_WIDTH + WEEKS * STEP - GAP;
export const LABEL_HEIGHT = 14;
export const SVG_HEIGHT = LABEL_HEIGHT + (DAYS_PER_WEEK * STEP - GAP);

const MIN_LABEL_GAP_WEEKS = 3;

// Use local date components to avoid UTC timezone shifts
// (toISOString returns UTC which can be J-1 for users east of UTC+0)
export const toDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

export const buildChartDateRange = (): { today: Date, startDay: Date } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToMonday = (today.getDay() + 6) % 7;
  const currentWeekMonday = addDays(today, -daysToMonday);
  const startDay = addDays(currentWeekMonday, -(WEEKS - 1) * DAYS_PER_WEEK);
  return { today, startDay };
};

export const buildMonthLabels = (
  cells: Array<{ date: Date }>,
): Array<{ week: number, label: string }> => {
  const allMonthStarts: Array<{ week: number, label: string }> = [];
  let lastMonth = -1;
  for (let week = 0; week < WEEKS; week++) {
    const firstDayOfWeek = cells[week * DAYS_PER_WEEK];
    if (firstDayOfWeek === undefined) {
      break;
    }
    const month = firstDayOfWeek.date.getMonth();
    if (month !== lastMonth) {
      allMonthStarts.push({
        week,
        label: firstDayOfWeek.date.toLocaleDateString(i18n.locale || 'en', { month: 'short' }),
      });
      lastMonth = month;
    }
  }
  return allMonthStarts.filter((entry, i) => {
    const next = allMonthStarts[i + 1];
    return next === undefined || next.week - entry.week >= MIN_LABEL_GAP_WEEKS;
  });
};

export interface StateChangeEntry {
  entityId: string,
  state: string,
  stateChangedAt: Date | string,
}

/**
 * How many entities stand applicable on each day from `startDay` to `today`, by `toDateKey`. An
 * entity's state on a day is its last change by the end of it, and one with no change yet is not
 * counted. `entries` must be in chronological order.
 */
export const countApplicableByDay = (entries: ReadonlyArray<StateChangeEntry>, startDay: Date, today: Date): Map<string, number> => {
  const byEntity = new Map<string, Array<StateChangeEntry>>();
  for (const entry of entries) {
    const list = byEntity.get(entry.entityId) ?? [];
    list.push(entry);
    byEntity.set(entry.entityId, list);
  }
  // Each entity keeps a cursor that only moves forward as the days do, so each change is read once.
  const cursors = [...byEntity.values()].map((changes) => ({ changes, cursor: 0, state: null as string | null }));
  const counts = new Map<string, number>();
  for (let date = startDay; date <= today; date = addDays(date, 1)) {
    const dateKey = toDateKey(date);
    let applicable = 0;
    for (const c of cursors) {
      while (c.cursor < c.changes.length && toDateKey(new Date(c.changes[c.cursor].stateChangedAt)) <= dateKey) {
        c.state = c.changes[c.cursor].state;
        c.cursor++;
      }
      if (c.state === 'applicable') {
        applicable++;
      }
    }
    counts.set(dateKey, applicable);
  }
  return counts;
};

/** A daily series the server counted, keyed for the heatmap: its days are already `toDateKey`s in the viewer's zone. */
export const countsByDayOf = (series: ReadonlyArray<{ day: string, count: number }> | undefined): Map<string, number> =>
  new Map((series ?? []).map((point) => [point.day, point.count]));
