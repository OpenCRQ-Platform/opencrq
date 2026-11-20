import type { ChangeCategoryKey, ChangeDirection, ChangeEvent, ChangeTab } from '@app/module/client';
import { toPercentPoints } from '@app/utils/decimals';
import { toCalendarDate } from '../../../../utils/date-utils';

/** One point of `aleChangeExplain.getRunCurve`: what each tab plots, `susceptibility` as a fraction. */
export interface ChangesRun {
  id: string,
  createdAt: Date | string,
  ale: number | null,
  tef: number | null,
  susceptibility: number | null,
  magnitude: number | null,
}

export const TAB_VALUE: Record<ChangeTab, (run: ChangesRun) => number | null> = {
  ale: (run) => run.ale,
  tef: (run) => run.tef,
  susceptibility: (run) => (run.susceptibility === null ? null : toPercentPoints(run.susceptibility)),
  magnitude: (run) => run.magnitude,
};

export const CHANGE_PERIODS = ['previous', '7d', '30d', '90d', '1y'] as const;
export type ChangePeriod = (typeof CHANGE_PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<ChangePeriod, 'previous'>, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
const DAY_MS = 86_400_000;
const DEFAULT_PERIOD = '7d';

const createdTime = (run: ChangesRun): number => new Date(run.createdAt).getTime();

/**
 * `runs` is newest first. The two ids are taken when both name distinct runs of the list, the
 * default period otherwise: the latest run against the last one at least seven days older, the
 * oldest when the history is shorter. `null` with fewer than two runs.
 */
export const resolveComparedPair = <Run extends ChangesRun>(
  runs: ReadonlyArray<Run>,
  firstId: string | undefined,
  secondId: string | undefined,
): { before: Run, after: Run } | null => {
  const first = runs.find((run) => run.id === firstId);
  const second = runs.find((run) => run.id === secondId);
  if (first !== undefined && second !== undefined && first.id !== second.id) {
    return createdTime(first) <= createdTime(second) ? { before: first, after: second } : { before: second, after: first };
  }
  const [latest] = runs;
  if (latest === undefined || runs.length < 2) {
    return null;
  }
  const limit = createdTime(latest) - PERIOD_DAYS[DEFAULT_PERIOD] * DAY_MS;
  const before = runs.find((run, index) => index > 0 && createdTime(run) <= limit) ?? runs[runs.length - 1];
  return { before, after: latest };
};

/**
 * The pair `changes` was read for, which lags `compared` while the next pair loads, `compared`
 * itself when either run has left `runs`.
 */
export const pairOfChanges = <Run extends ChangesRun>(
  runs: ReadonlyArray<Run>,
  changes: { before: { id: string }, after: { id: string } },
  compared: { before: Run, after: Run },
): { before: Run, after: Run } => {
  const before = runs.find((run) => run.id === changes.before.id);
  const after = runs.find((run) => run.id === changes.after.id);
  return before === undefined || after === undefined ? compared : { before, after };
};

export interface CurvePoint {
  runId: string,
  at: Date,
  value: number | null,
}

/** Every run of the scenario, oldest first. */
export const buildCurve = (runs: ReadonlyArray<ChangesRun>, tab: ChangeTab): Array<CurvePoint> => runs
  .toReversed()
  .map((run) => ({ runId: run.id, at: new Date(run.createdAt), value: TAB_VALUE[tab](run) }));

export const curveXs = (points: ReadonlyArray<CurvePoint>): Array<number> => {
  const first = points.at(0)?.at.getTime() ?? 0;
  const span = (points.at(-1)?.at.getTime() ?? 0) - first;
  return points.map((point, index) => {
    if (span > 0) {
      return (point.at.getTime() - first) / span;
    }
    return points.length < 2 ? 1 : index / (points.length - 1);
  });
};

/** The compared stretch of the curve: indexes of the earlier and the later run, the earlier first. */
export type CurveRange = readonly [number, number];

export const easeInOut = (progress: number): number =>
  (progress < 0.5 ? 2 * progress * progress : 1 - 2 * (1 - progress) * (1 - progress));

export const between = (from: number, to: number, share: number): number => from + (to - from) * share;

/** `from` moved toward `to` by `elapsed` milliseconds, at a pace crossing 0 to 1 in `duration`, never past `to`. */
export const stepToward = (from: number, to: number, elapsed: number, duration: number): number => {
  const step = duration <= 0 ? Infinity : elapsed / duration;
  return from < to ? Math.min(from + step, to) : Math.max(from - step, to);
};

const ZOOM_MARGIN = 0.04;

/**
 * The stretch of `xs` the curve shows: the whole history at `zoom` 0, the compared range at 1,
 * padded on each side so its two ends never sit on the frame.
 */
export const curveView = (xs: ReadonlyArray<number>, range: CurveRange, zoom: number): { from: number, to: number } => {
  const start = xs[range[0]] ?? 0;
  const end = xs[range[1]] ?? 1;
  const margin = Math.max(end - start, Number.EPSILON) * ZOOM_MARGIN;
  return { from: between(0, start - margin, zoom), to: between(1, end + margin, zoom) };
};

/**
 * `points` holds at least two runs, oldest first. The latest run against the previous one, or
 * against the last run at least the period older, the oldest when the history is shorter.
 */
export const periodRange = (points: ReadonlyArray<CurvePoint>, period: ChangePeriod): CurveRange => {
  const last = points.length - 1;
  if (period === 'previous') {
    return [last - 1, last];
  }
  const limit = points[last].at.getTime() - PERIOD_DAYS[period] * DAY_MS;
  const from = points.findLastIndex((point, index) => index < last && point.at.getTime() <= limit);
  return [Math.max(from, 0), last];
};

/** The first period whose range is the one compared, null for a range picked on the curve. */
export const matchingPeriod = (points: ReadonlyArray<CurvePoint>, range: CurveRange): ChangePeriod | null =>
  CHANGE_PERIODS.find((period) => {
    const candidate = periodRange(points, period);
    return candidate[0] === range[0] && candidate[1] === range[1];
  }) ?? null;

export type RangeEnd = 'before' | 'after';

/** One end moved to `index`, never onto or past the other end. */
export const moveRangeEnd = (range: CurveRange, end: RangeEnd, index: number): CurveRange =>
  (end === 'before' ? [Math.min(index, range[1] - 1), range[1]] : [range[0], Math.max(index, range[0] + 1)]);

/** A click moves the nearer end onto the clicked run; a click on an end changes nothing. */
export const clickRange = (range: CurveRange, index: number): CurveRange => {
  if (index === range[0] || index === range[1]) {
    return range;
  }
  if (index < range[0] || (index < range[1] && index - range[0] <= range[1] - index)) {
    return [index, range[1]];
  }
  return [range[0], index];
};

export const steppedIndex = (key: string, index: number, last: number): number | null => {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(index - 1, 0);
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(index + 1, last);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
};

/** The range a drag from `start` to `index` spans, null while it has not left its run. */
export const spanRange = (start: number, index: number): CurveRange | null =>
  (start === index ? null : [Math.min(start, index), Math.max(start, index)]);

export type CurveDrag = { kind: 'end', end: RangeEnd } | { kind: 'span', start: number };

/** The range a drag gives with the pointer on `index`, null while a span has not left its run. */
export const draggedRange = (range: CurveRange, drag: CurveDrag, index: number): CurveRange | null =>
  (drag.kind === 'end' ? moveRangeEnd(range, drag.end, index) : spanRange(drag.start, index));

export interface TileReading {
  key: ChangeCategoryKey,
  up: number,
  down: number,
  neutral: number,
}

const COUNTED: Record<ChangeDirection, keyof Omit<TileReading, 'key'>> = { up: 'up', down: 'down', none: 'neutral' };

export const readTiles = (
  categories: ReadonlyArray<{ key: ChangeCategoryKey, tabs: ReadonlyArray<ChangeTab> }>,
  events: ReadonlyArray<ChangeEvent>,
  tab: ChangeTab,
): Array<TileReading> => categories
  .filter((category) => category.tabs.includes(tab))
  .map((category) => {
    const reading: TileReading = { key: category.key, up: 0, down: 0, neutral: 0 };
    for (const event of events) {
      if (event.category !== category.key) {
        continue;
      }
      const { group } = event;
      if (group === undefined) {
        reading[COUNTED[event.direction]] += 1;
      } else {
        reading.up += group.up;
        reading.down += group.down;
        reading.neutral += group.bands.reduce((sum, band) => sum + band.count, 0) - group.up - group.down;
      }
    }
    return reading;
  });

/** Where a hovered chronology row sits on the curve: on a run, at a time, or across a local day. */
export type CurveMarker =
  | { kind: 'run', runId: string, at: Date }
  | { kind: 'moment', at: Date }
  | { kind: 'day', at: Date };

/** `withTime` when another stop of the chronology falls on the same local day. */
export interface ChronologyStop {
  at: Date,
  withTime: boolean,
}

export interface ChronologyNode extends ChronologyStop {
  kind: 'recorded' | 'run',
  marker: CurveMarker,
  events: Array<ChangeEvent>,
}

export interface Chronology {
  before: ChronologyStop,
  /** Between the two ends, oldest first: recorded changes grouped by local day, and runs. */
  nodes: Array<ChronologyNode>,
  /** What took its final state on the later run, listed above the balance. */
  after: ChronologyNode,
  balance: Array<ChangeEvent>,
}

interface ChronologyRun {
  id: string,
  readAt: Date | string,
}

/** `events` ordered by moment, as the API returns them. Times arrive over the wire as ISO strings. */
export interface ChronologyInput {
  before: ChronologyRun,
  after: ChronologyRun,
  runs: ReadonlyArray<ChronologyRun>,
  events: ReadonlyArray<ChangeEvent>,
}

type Gathered = Omit<ChronologyNode, 'withTime' | 'marker'> & { runId: string | null };

/**
 * Two groups of one kind meet in a node when the run the server split them at is filtered out by the
 * tab or the tile. They stay apart around rows of their category listed between them, which a joined
 * group's span would page a second time.
 */
const joinGroup = (events: Array<ChangeEvent>, event: ChangeEvent): void => {
  const { group } = event;
  const index = group === undefined
    ? -1
    : events.findIndex((candidate) => candidate.category === event.category && candidate.group?.kind === group.kind);
  const joined = events[index]?.group;
  const interleaved = events.slice(index + 1).some((candidate) => candidate.category === event.category && candidate.group === undefined);
  if (group === undefined || joined === undefined || interleaved) {
    events.push(event);
    return;
  }
  const bands = joined.bands.map((band) => ({ ...band }));
  for (const band of group.bands) {
    const same = bands.find((candidate) => candidate.from === band.from && candidate.to === band.to);
    if (same === undefined) {
      bands.push({ ...band });
    } else {
      same.count += band.count;
    }
  }
  const up = joined.up + group.up;
  const down = joined.down + group.down;
  events[index] = {
    ...events[index],
    direction: up + down === 0 ? 'none' : (up >= down ? 'up' : 'down'),
    group: { ...joined, to: group.to, up, down, bands: bands.toSorted((a, b) => b.count - a.count) },
  };
};

const markerOf = (node: Gathered, withTime: boolean): CurveMarker => {
  if (node.runId !== null) {
    return { kind: 'run', runId: node.runId, at: node.at };
  }
  return { kind: withTime ? 'moment' : 'day', at: node.at };
};

/**
 * A recorded change joins the node before it when that node holds recorded changes of the same
 * local day, so a run of that day splits them into what it read and what came after.
 */
export const buildChronology = (
  changes: ChronologyInput,
  tiles: ReadonlyArray<TileReading>,
  filter: ReadonlyArray<ChangeCategoryKey>,
): Chronology => {
  const shown = new Set(tiles.map((tile) => tile.key));
  const kept = changes.events.filter((event) => shown.has(event.category) && (filter.length === 0 || filter.includes(event.category)));
  const afterAt = new Date(changes.after.readAt);
  const runAt = new Map(changes.runs.map((run) => [run.id, new Date(run.readAt)]));

  const gathered: Array<Gathered> = [];
  const atAfter: Gathered = { kind: 'run', runId: changes.after.id, at: afterAt, events: [] };
  const balance: Array<ChangeEvent> = [];
  for (const event of kept) {
    const { moment } = event;
    const last = gathered.at(-1);
    if (moment.kind === 'balance') {
      balance.push(event);
    } else if (moment.kind === 'run' && moment.runId === changes.after.id) {
      atAfter.events.push(event);
    } else if (moment.kind === 'run') {
      if (last?.runId === moment.runId) {
        last.events.push(event);
      } else {
        gathered.push({ kind: 'run', runId: moment.runId, at: runAt.get(moment.runId) ?? afterAt, events: [event] });
      }
    } else {
      const at = new Date(moment.at);
      if (last?.kind === 'recorded' && toCalendarDate(last.at) === toCalendarDate(at)) {
        joinGroup(last.events, event);
      } else {
        gathered.push({ kind: 'recorded', runId: null, at, events: [event] });
      }
    }
  }

  const beforeAt = new Date(changes.before.readAt);
  const stopsByDay = new Map<string, number>();
  for (const at of [beforeAt, ...gathered.map((node) => node.at), afterAt]) {
    const day = toCalendarDate(at);
    stopsByDay.set(day, (stopsByDay.get(day) ?? 0) + 1);
  }
  const shared = (at: Date): boolean => (stopsByDay.get(toCalendarDate(at)) ?? 0) > 1;
  const settle = (node: Gathered): ChronologyNode => {
    const withTime = shared(node.at);
    return { kind: node.kind, at: node.at, withTime, marker: markerOf(node, withTime), events: node.events };
  };

  return {
    before: { at: beforeAt, withTime: shared(beforeAt) },
    nodes: gathered.map(settle),
    after: settle(atAfter),
    balance,
  };
};

/** Where a time falls along the curve, from 0 at its first run to 1 at its last, clamped. */
export const timeX = (points: ReadonlyArray<CurvePoint>, at: Date): number => {
  const first = points.at(0)?.at.getTime() ?? 0;
  const span = (points.at(-1)?.at.getTime() ?? 0) - first;
  if (span <= 0) {
    return 1;
  }
  return Math.min(Math.max((at.getTime() - first) / span, 0), 1);
};

/** The time `x` stands for on the curve's axis, outside the history too, where a zoomed view's edges can fall. */
export const timeAtX = (points: ReadonlyArray<CurvePoint>, x: number): Date => {
  const first = points.at(0)?.at.getTime() ?? 0;
  const span = (points.at(-1)?.at.getTime() ?? 0) - first;
  return new Date(first + Math.max(span, 0) * x);
};

/** The local day `at` falls on, as the times its midnight and the next one. */
export const localDayBounds = (at: Date): readonly [Date, Date] => [
  new Date(at.getFullYear(), at.getMonth(), at.getDate()),
  new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1),
];
