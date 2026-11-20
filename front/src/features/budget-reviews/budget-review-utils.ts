import type { CoverageBucket, StrengthRung } from '@app/module/client';
import { toCalendarDate } from '../../utils/date-utils';

export type BudgetLineNature = 'build' | 'run';
export type BudgetReviewBasket = 'line' | 'build' | 'run' | 'ensemble';

export interface ControlPosture {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

export interface NamedRef {
  id: string,
  name: string | null,
}

export interface ReviewControl {
  capabilityId: string,
  name: string,
  start: ControlPosture,
  end: ControlPosture,
  moved: boolean,
  buildLine: NamedRef | null,
}

export interface ReviewFigure {
  basket: BudgetReviewBasket,
  lineId: string | null,
}

/** Read in UTC, as the API checks a period start, so no time zone offers a month the API refuses. */
export const reviewYearOptions = (today = new Date(), count = 5): Array<number> =>
  Array.from({ length: count }, (_, index) => today.getUTCFullYear() - index);

/** The months, 1 to 12, a fiscal year of `year` can start on: none after the current month in UTC. */
export const reviewStartMonths = (year: number, today = new Date()): Array<number> =>
  Array.from({ length: year < today.getUTCFullYear() ? 12 : today.getUTCMonth() + 1 }, (_, index) => index + 1);

/** The first day of a month, as `YYYY-MM-DD`, the form the API takes a period start in. */
export const reviewPeriodStart = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}-01`;

export const periodStartParts = (periodStart: string): { year: number, month: number } => {
  const [year, month] = periodStart.split('-').map(Number);
  return { year, month };
};

/** The last day of the twelve months from `periodStart`, as `YYYY-MM-DD`, the day the API ends a review's period on. */
export const reviewPeriodEnd = (periodStart: string): string => {
  const { year, month } = periodStartParts(periodStart);
  return new Date(Date.UTC(year + 1, month - 1, 0)).toISOString().slice(0, 10);
};

/** The years an edit offers: the usual ones, plus the stored period's when it has aged out of them. */
export const editYearOptions = (storedPeriodStart: string, today = new Date()): Array<number> => {
  const years = reviewYearOptions(today);
  const { year } = periodStartParts(storedPeriodStart);
  return years.includes(year) ? years : [...years, year];
};

/** The period start a choice of year and month moves the review to, or `null` when it stays where it is stored. */
export const changedPeriodStart = (storedPeriodStart: string, year: number, month: number): string | null => {
  const chosen = reviewPeriodStart(year, month);
  return chosen === storedPeriodStart ? null : chosen;
};

export interface ReviewEditValues {
  name: string,
  ownerId: string | null,
  context: string | null,
  startYear: number,
  startMonth: number,
}

export const reviewUpdatePayload = (
  storedPeriodStart: string,
  { startYear, startMonth, ...values }: ReviewEditValues,
): { name: string, ownerId: string | null, context: string | null, periodStart?: string } => {
  const periodStart = changedPeriodStart(storedPeriodStart, startYear, startMonth);
  return periodStart === null ? values : { ...values, periodStart };
};

/** How a fiscal year is named: its year when it starts in January, both years it spans otherwise. */
export const fiscalYearLabel = (periodStart: string): string => {
  const { year, month } = periodStartParts(periodStart);
  return month === 1 ? String(year) : `${year}-${year + 1}`;
};

/** A review's period as far as it has run: it ends today while it runs, which is where its posture is read. */
export const reviewPeriod = (periodStart: string, periodEnd: string, today = new Date()): { from: string, to: string } => {
  const todayKey = toCalendarDate(today);
  return { from: periodStart, to: periodEnd < todayKey ? periodEnd : todayKey };
};

/** A `YYYY-MM-DD` day as the UTC midnight the run history keys it by. */
export const dayTimestamp = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

export interface AlePoint {
  date: string,
  ale: number,
}

export interface BuildFigure {
  aleReductionMean: number | null,
  aleReductionP10: number | null,
  aleReductionP90: number | null,
}

export interface ValueSpread {
  low: number,
  high: number,
}

export interface RiskPoint extends AlePoint {
  /** The scope without the period's build work. Null when no scenario carries a build history. */
  without: number | null,
}

export interface WithoutBuildGap {
  date: string,
  current: number,
  without: number,
  reduction: number,
  /** The build figure's p10 to p90 scaled from its mean to the gap drawn, null without a spread. */
  reductionSpread: ValueSpread | null,
  withoutSpread: ValueSpread | null,
}

/**
 * The gap between the curve and the scope without the build work on the curve's last day. Nothing
 * when it is zero. `withoutSpread` is floored at zero, where an exposure ends, while
 * `reductionSpread` keeps the spread as priced.
 */
export const withoutBuildGap = (points: ReadonlyArray<RiskPoint>, build: BuildFigure | null): WithoutBuildGap | null => {
  const last = points.at(-1);
  if (last === undefined || last.without === null || last.without === last.ale) {
    return null;
  }
  const reduction = last.without - last.ale;
  const mean = build?.aleReductionMean ?? null;
  const p10 = build?.aleReductionP10 ?? null;
  const p90 = build?.aleReductionP90 ?? null;
  const scale = mean === null || mean === 0 ? null : reduction / mean;
  const reductionSpread = scale === null || p10 === null || p90 === null ? null : { low: p10 * scale, high: p90 * scale };
  return {
    date: last.date,
    current: last.ale,
    without: last.without,
    reduction,
    reductionSpread,
    withoutSpread: reductionSpread === null
      ? null
      : { low: Math.max(0, last.ale + reductionSpread.low), high: Math.max(0, last.ale + reductionSpread.high) },
  };
};

export interface BuildMoveLine {
  lineName: string,
  controlNames: Array<string>,
  /** No later day moved a control of the line. */
  finished: boolean,
}

export interface BuildMove {
  date: string,
  lines: Array<BuildMoveLine>,
}

/**
 * The days from `from` to `to` a build line's control moved on, by name. A line or a control the
 * review no longer holds is left out, and a day left with no line with it.
 */
export const buildMovesWithin = (
  moves: ReadonlyArray<{ date: string, lines: ReadonlyArray<{ lineId: string, capabilityIds: ReadonlyArray<string>, finished: boolean }> }>,
  lines: ReadonlyArray<{ id: string, name: string }>,
  controls: ReadonlyArray<{ capabilityId: string, name: string }>,
  from: string,
  to: string,
): Array<BuildMove> => {
  const lineNameById = new Map(lines.map((line) => [line.id, line.name]));
  const controlNameById = new Map(controls.map((control) => [control.capabilityId, control.name]));
  return moves.flatMap(({ date, lines: moved }) => {
    const named = moved.flatMap(({ lineId, capabilityIds, finished }) => {
      const lineName = lineNameById.get(lineId);
      return lineName === undefined
        ? []
        : [{ lineName, controlNames: capabilityIds.flatMap((capabilityId) => controlNameById.get(capabilityId) ?? []), finished }];
    });
    return date < from || date > to || named.length === 0 ? [] : [{ date, lines: named }];
  });
};

/**
 * The row each label goes on, the lowest one where it starts after the previous label of that row ends.
 * Labels come in order of `start`, and both `start` and `width` are in the same unit.
 */
export const labelRows = (labels: ReadonlyArray<{ start: number, width: number }>): Array<number> => {
  const rowEnds: Array<number> = [];
  return labels.map(({ start, width }) => {
    const free = rowEnds.findIndex((end) => end <= start);
    const row = free === -1 ? rowEnds.length : free;
    rowEnds[row] = start + width;
    return row;
  });
};

/**
 * The scale of a timeline `plotPx` wide that keeps `marginPx` free right of its last day, `spanMs`
 * after its first. The margin takes at most 40 % of the plot, so a narrow chart squeezes it before the curve.
 */
export const timelineMargin = (spanMs: number, plotPx: number, marginPx: number): { msPerPx: number, marginMs: number } => {
  const kept = Math.min(marginPx, plotPx * 0.4);
  const msPerPx = spanMs / (plotPx - kept);
  return { msPerPx, marginMs: kept * msPerPx };
};

/** Whole months from the day after `periodEnd` to `at`, zero when `at` falls within the period. */
export const monthsAfterPeriod = (periodEnd: string, at: Date): number => {
  const [year, month, day] = periodEnd.split('-').map(Number);
  const months = (at.getUTCFullYear() - year) * 12 + at.getUTCMonth() - (month - 1) - (at.getUTCDate() <= day ? 1 : 0);
  return Math.max(0, months);
};

/**
 * A value label right of its point when the point sits on the plot's left edge, where one ending at
 * the point would spill over the y axis; left of it otherwise.
 */
export const pointLabelSide = (x: number, xMin: number): { textAnchor: 'start' | 'end', offsetX: number } =>
  (x <= xMin ? { textAnchor: 'start', offsetX: 8 } : { textAnchor: 'end', offsetX: -8 });

export const figureOf = <T extends ReviewFigure>(figures: ReadonlyArray<T>, basket: BudgetReviewBasket, lineId?: string): T | undefined =>
  figures.find((figure) => figure.basket === basket && (basket !== 'line' || figure.lineId === lineId));

/**
 * The return the figure would show if its loss avoided were the p10 instead of the mean, on the
 * server's own formula. Null without a p10 or a spend, as the main return is.
 */
export const prudentReturnPercent = (figure: { aleReductionP10: number | null, spent: number }): number | null =>
  (figure.aleReductionP10 === null || !(figure.spent > 0) ? null : ((figure.aleReductionP10 - figure.spent) / figure.spent) * 100);

/** Whether a figure holds an amortized build line, the only case its amortized return differs. */
export const isAmortized = (figure: { spent: number, annualSpent: number }): boolean => figure.annualSpent < figure.spent;

export const DEFAULT_AMORTIZATION_YEARS = 3;

export const movedWithoutBuildLine = <T extends ReviewControl>(controls: ReadonlyArray<T>): Array<T> =>
  controls.filter((control) => control.moved && control.buildLine === null);

export interface BuildLineChoice<T extends ReviewControl> {
  control: T,
  /** The other build line holding the control's move, which a move belongs to at most once. */
  heldBy: NamedRef | null,
}

/**
 * What a build line can fund: every control that moved during the period, plus any the line already
 * holds, so a control whose move was later undone is still shown, and can be dropped.
 */
export const buildLineChoices = <T extends ReviewControl>(
  controls: ReadonlyArray<T>,
  lineId: string | null,
  selected: ReadonlyArray<string>,
): Array<BuildLineChoice<T>> => controls
  .filter((control) => control.moved || selected.includes(control.capabilityId))
  .map((control) => ({
    control,
    heldBy: control.buildLine !== null && control.buildLine.id !== lineId ? control.buildLine : null,
  }))
  .sort((a, b) => Number(a.heldBy !== null) - Number(b.heldBy !== null) || a.control.name.localeCompare(b.control.name));

/** A build line drops what another build line holds: the API refuses a move counted twice. */
export const linePayloadControls = <T extends ReviewControl>(
  nature: BudgetLineNature,
  selected: ReadonlyArray<string>,
  choices: ReadonlyArray<BuildLineChoice<T>>,
): Array<string> => {
  if (nature === 'run') {
    return [...selected];
  }
  const held = new Set(choices.filter((choice) => choice.heldBy !== null).map((choice) => choice.control.capabilityId));
  return selected.filter((id) => !held.has(id));
};

export const sameControls = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

export const lineCountByNature = (lines: ReadonlyArray<{ nature: BudgetLineNature }>): Record<BudgetLineNature, number> => ({
  build: lines.filter((line) => line.nature === 'build').length,
  run: lines.filter((line) => line.nature === 'run').length,
});

interface ReviewFigureStates {
  figures: ReadonlyArray<{ state: 'priced' | 'expired' | 'not-priced' }>,
  olderThanHeadlineNames: ReadonlyArray<string>,
}

export type CloseBlocker = 'no-line' | 'unpriced' | 'outdated';

/**
 * Closing stores the figures as they stand and the review is never priced again, so a figure that is
 * expired, missing or older than its scenario's ALE would be frozen for good: every scenario has to be
 * priced again first, and a review with no line has nothing to freeze.
 */
export const closeBlocker = (lineCount: number, figures: ReviewFigureStates | null | undefined): CloseBlocker | null => {
  if (lineCount === 0) {
    return 'no-line';
  }
  const priced = figures != null && figures.figures.length > 0 && figures.figures.every((figure) => figure.state === 'priced');
  if (!priced) {
    return 'unpriced';
  }
  return figures.olderThanHeadlineNames.length > 0 ? 'outdated' : null;
};

const MAX_SHOWN = 3;

export const firstAndMore = <T>(items: ReadonlyArray<T>): { shown: Array<T>, more: number } => ({
  shown: items.slice(0, MAX_SHOWN),
  more: Math.max(0, items.length - MAX_SHOWN),
});

/** A line's controls in its own order. One the review no longer reads, a capability since deleted, is left out. */
export const lineControls = <T extends { capabilityId: string }>(capabilityIds: ReadonlyArray<string>, controls: ReadonlyArray<T>): Array<T> => {
  const byId = new Map(controls.map((control) => [control.capabilityId, control]));
  return capabilityIds.flatMap((id) => byId.get(id) ?? []);
};

export type ScaleStep = 'kept' | 'gained' | 'lost' | 'empty';

/**
 * One step per level above the lowest, `levels` ordered lowest first: a step reached at both ends
 * is kept, at the end only gained, at the start only lost.
 */
export const scaleSteps = <T extends string>(levels: ReadonlyArray<T>, start: T, end: T): Array<ScaleStep> => {
  const from = levels.indexOf(start);
  const to = levels.indexOf(end);
  return levels.slice(1).map((_, index): ScaleStep => {
    const step = index + 1;
    if (step <= Math.min(from, to)) {
      return 'kept';
    }
    if (step <= to) {
      return 'gained';
    }
    return step <= from ? 'lost' : 'empty';
  });
};
