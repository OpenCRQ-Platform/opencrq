import type { PeriodWindowId } from './period-window';
import { MINUS_SIGN } from '../../utils';
import { periodWindowDays } from './period-window';

export type LifelineDirection = 'up' | 'down' | 'flat';

export interface LifelineGeometry {
  /**
   * Series polyline in viewBox units, one subpath per unbroken stretch. Empty when a single point
   * cannot describe a line.
   */
  linePath: string,
  /** The same subpaths each closed down to the floor of the box, for the area fill. */
  areaPath: string | null,
  /**
   * Where the end marker goes, as fractions of the box from its left and top edges. Null when the
   * series ends in a gap, since its last value is no longer the current one.
   */
  endX: number | null,
  endY: number | null,
  /** Height of the oldest point, as a fraction from the top: where the reference line sits. */
  startY: number,
  direction: LifelineDirection,
  /** Each value's point as fractions of the box, null on a gap. */
  points: Array<{ x: number, y: number } | null>,
  /** The lowest and highest values held, unpadded, at their heights in the padded frame. */
  min: number,
  max: number,
  minY: number,
  maxY: number,
}

export interface LifelineShape {
  /** Each value's position from 0 to 1, ascending. Evenly spaced when omitted. */
  xs?: ReadonlyArray<number>,
  /** `monotone` bends through the points without ever passing a value the series does not hold. */
  curve?: 'linear' | 'monotone',
  /**
   * The lowest and highest values the scale must hold, for series drawn on one scale with another.
   * The printed `min` and `max` are then the domain's.
   */
  domain?: { min: number, max: number },
}

/** What a rise of the series means: bad news for an exposure, good news for a posture. */
export type LifelineRise = 'bad' | 'good';

/**
 * The tone a direction takes, shared by every surface that draws a series: one map, so a card and
 * the header beside it can never disagree on what red means.
 */
export const LIFELINE_TONE_CLASS: Record<LifelineRise, Record<LifelineDirection, string>> = {
  bad: {
    up: 'text-feedback-error-primary',
    down: 'text-feedback-success-primary',
    flat: 'text-muted-foreground',
  },
  good: {
    up: 'text-feedback-success-primary',
    down: 'text-feedback-error-primary',
    flat: 'text-muted-foreground',
  },
};

export const LIFELINE_VIEWBOX_WIDTH = 100;
export const LIFELINE_VIEWBOX_HEIGHT = 100;

/** Vertical breathing room, so the extreme points never sit on the frame. */
const DOMAIN_PADDING = 0.08;

/**
 * Smallest range the vertical scale will show, relative to the level of the series. Without a floor,
 * tight scaling turns a half-percent wobble into a cliff; with it, only a move worth this much of
 * the scenario's own exposure fills the frame.
 */
const MIN_RELATIVE_SPAN = 0.1;

/** Below this relative move, the series reads as flat rather than as a direction. */
const FLAT_THRESHOLD = 0.01;

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * The direction a relative move reads as, and so the tone it takes.
 *
 * Every surface that tints a scenario's exposure movement goes through this, the sparkline and the
 * figure printed beside it alike. Two thresholds would let the same move come out grey on one and
 * red on the other, which a reader takes as two verdicts rather than one damped reading.
 */
export const directionOfRelativeChange = (change: number): LifelineDirection => {
  if (Math.abs(change) < FLAT_THRESHOLD) {
    return 'flat';
  }
  return change > 0 ? 'up' : 'down';
};

export const directionBetween = (first: number, last: number): LifelineDirection => {
  if (first === 0) {
    return last === 0 ? 'flat' : 'up';
  }
  return directionOfRelativeChange((last - first) / first);
};

const isMeasured = (value: number | null): value is number => value !== null;

const unbrokenStretches = (values: ReadonlyArray<number | null>): Array<Array<number>> => {
  const stretches: Array<Array<number>> = [];
  let current: Array<number> = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) {
        stretches.push(current);
      }
      current = [];
      return;
    }
    current.push(index);
  });
  if (current.length > 0) {
    stretches.push(current);
  }
  return stretches;
};

/** Fritsch-Carlson monotone cubic: the curve never overshoots either neighbour of a segment. */
const monotonePath = (points: ReadonlyArray<{ x: number, y: number }>): Array<string> => {
  const widths = points.slice(1).map((point, index) => point.x - points[index].x);
  const slopes = widths.map((width, index) => (width === 0 ? 0 : (points[index + 1].y - points[index].y) / width));
  const tangents = points.map((_, index) => {
    if (index === 0) {
      return slopes[0];
    }
    if (index === points.length - 1) {
      return slopes[index - 1];
    }
    const [before, after] = [slopes[index - 1], slopes[index]];
    if (before * after <= 0) {
      return 0;
    }
    const [left, right] = [widths[index - 1], widths[index]];
    return (3 * (left + right)) / ((2 * right + left) / before + (right + 2 * left) / after);
  });
  const coordinates = (x: number, y: number): string => [round(x), round(y)].join(',');
  return points.map((point, index) => {
    const end = coordinates(point.x, point.y);
    if (index === 0) {
      return `M${end}`;
    }
    const previous = points[index - 1];
    const third = widths[index - 1] / 3;
    if (third === 0) {
      return `L${end}`;
    }
    const controls = [
      coordinates(previous.x + third, previous.y + tangents[index - 1] * third),
      coordinates(point.x - third, point.y - tangents[index] * third),
    ];
    return `C${[...controls, end].join(' ')}`;
  });
};

/**
 * Turns any numeric series into SVG paths in a fixed 100x100 box, which the caller stretches with
 * `preserveAspectRatio="none"`. A null is a stretch with no value: the line breaks there, and
 * resumes at the next value, rather than bridging it.
 *
 * The scale is the series' own unless `shape.domain` names one shared with another series, so the
 * shape stays readable whatever feeds it, and the printed figure beside it carries the magnitude.
 */
export const buildLifelineGeometry = (values: ReadonlyArray<number | null>, shape?: LifelineShape): LifelineGeometry | null => {
  const measured = values.filter(isMeasured);
  if (measured.length === 0) {
    return null;
  }

  const lowest = shape?.domain?.min ?? Math.min(...measured);
  const highest = shape?.domain?.max ?? Math.max(...measured);
  let min = lowest;
  let max = highest;

  const level = shape?.domain === undefined
    ? measured.reduce((total, value) => total + value, 0) / measured.length
    : (lowest + highest) / 2;
  const minimumSpan = Math.abs(level) * MIN_RELATIVE_SPAN;
  let span = max - min;
  if (span < minimumSpan) {
    const middle = (min + max) / 2;
    span = minimumSpan;
    min = middle - span / 2;
    max = middle + span / 2;
  }
  if (span === 0) {
    min -= 1;
    max += 1;
    span = 2;
  }
  min -= span * DOMAIN_PADDING;
  max += span * DOMAIN_PADDING;

  const toY = (value: number): number => round((1 - (value - min) / (max - min)) * LIFELINE_VIEWBOX_HEIGHT);
  const xs = shape?.xs;
  const toX = (index: number): number => {
    if (xs !== undefined) {
      return round(xs[index] * LIFELINE_VIEWBOX_WIDTH);
    }
    return values.length === 1
      ? LIFELINE_VIEWBOX_WIDTH / 2
      : round((index / (values.length - 1)) * LIFELINE_VIEWBOX_WIDTH);
  };
  const vertex = (index: number): string => `${toX(index)},${toY(values[index]!)}`;

  // A stretch of one point is drawn as a zero-length segment, which the round cap renders as a dot.
  const subpaths = unbrokenStretches(values).map((stretch) => {
    if (stretch.length === 1) {
      return [`M${vertex(stretch[0])}`, `L${vertex(stretch[0])}`];
    }
    if (shape?.curve === 'monotone') {
      return monotonePath(stretch.map((index) => ({ x: toX(index), y: toY(values[index]!) })));
    }
    return stretch.map((index, position) => `${position === 0 ? 'M' : 'L'}${vertex(index)}`);
  });
  const linePath = values.length < 2 ? '' : subpaths.map((subpath) => subpath.join(' ')).join(' ');
  const areaPath = values.length < 2
    ? null
    : unbrokenStretches(values).map((stretch, position) => [
      ...subpaths[position],
      `L${toX(stretch[stretch.length - 1])},${LIFELINE_VIEWBOX_HEIGHT}`,
      `L${toX(stretch[0])},${LIFELINE_VIEWBOX_HEIGHT}`,
      'Z',
    ].join(' ')).join(' ');

  const lastIndex = values.length - 1;
  const last = values[lastIndex];
  return {
    linePath,
    areaPath,
    endX: last === null ? null : toX(lastIndex) / LIFELINE_VIEWBOX_WIDTH,
    endY: last === null ? null : toY(last) / LIFELINE_VIEWBOX_HEIGHT,
    startY: toY(measured[0]) / LIFELINE_VIEWBOX_HEIGHT,
    direction: directionBetween(measured[0], measured[measured.length - 1]),
    points: values.map((value, index) => (value === null
      ? null
      : { x: toX(index) / LIFELINE_VIEWBOX_WIDTH, y: toY(value) / LIFELINE_VIEWBOX_HEIGHT })),
    min: lowest,
    max: highest,
    minY: toY(lowest) / LIFELINE_VIEWBOX_HEIGHT,
    maxY: toY(highest) / LIFELINE_VIEWBOX_HEIGHT,
  };
};

/** The mark nearest to `x` across the plot, -1 when there is none. */
export const nearestMarkIndex = (marks: ReadonlyArray<{ x: number }>, x: number): number =>
  marks.reduce((nearest, mark, index) => (
    nearest === -1 || Math.abs(mark.x - x) < Math.abs(marks[nearest].x - x) ? index : nearest
  ), -1);

/** Zero carries no sign, since it is neither a rise nor a fall. */
export const formatSignedPoints = (points: number): string => {
  if (points === 0) {
    return '0';
  }
  return `${points > 0 ? '+' : MINUS_SIGN}${Math.abs(points)}`;
};

/** A journal line: a null value is the series losing its value at `at`. */
export interface WindowedLine<Payload> {
  at: number,
  value: number | null,
  payload: Payload,
}

/**
 * A line of the window the plot can point at. A line losing the value is one with a null `value`,
 * pointing at the end of the stretch it breaks.
 */
export interface WindowedMark<Payload> {
  at: Date,
  value: number | null,
  /** From 0 to 1 across the plot. */
  x: number,
  /** Its point in `values`. */
  pointIndex: number,
  /** Null when the line before it had no value, or there was none. */
  previous: number | null,
  payload: Payload,
}

export interface WindowedLifeline<Payload> {
  /** A value per point, null where the value is lost, each at its `xs` from 0 to 1. */
  values: Array<number | null>,
  xs: Array<number>,
  /** The payload of the line each point draws, held points carrying the line they hold. */
  payloads: Array<Payload>,
  marks: Array<WindowedMark<Payload>>,
  oldest: { at: Date, value: number },
  /** Null when the series has no value now. */
  latest: number | null,
  change: number | null,
  /** The span the plot covers: the first point drawn and the last one. */
  start: Date,
  end: Date,
  /** One point only, drawn flat across the whole width. */
  single: boolean,
}

export interface WindowingOptions<Payload> {
  /** Draws the last value held up to `now`, a rung holding until the next change. */
  holdToNow?: boolean,
  /** With `holdToNow`, also runs a series ending on a lost value to `now`, as a gap. */
  holdGapToNow?: boolean,
  /** A line answering false is drawn without a mark. */
  isMarked?: (payload: Payload) => boolean,
}

const DAY_MS = 86_400_000;

/**
 * The window's journal lines, each at its date across a plot spanning the data rather than the
 * period: from the line in force when the window opens, drawn at the opening and given no mark,
 * else the first line, to the last line, or to `now` when held. A value is drawn held up to the line
 * that loses it. Null when the window holds no value.
 */
export const buildWindowedLifeline = <Payload>(
  lines: ReadonlyArray<WindowedLine<Payload>>,
  windowId: PeriodWindowId,
  now: Date,
  options?: WindowingOptions<Payload>,
): WindowedLifeline<Payload> | null => {
  const ordered = lines.filter((line) => !Number.isNaN(line.at)).toSorted((a, b) => a.at - b.at);
  const isMarked = options?.isMarked ?? (() => true);

  const windowEnd = Math.max(now.getTime(), ordered.at(-1)?.at ?? Number.NEGATIVE_INFINITY);
  const windowStart = windowEnd - periodWindowDays(windowId) * DAY_MS;
  const firstInWindow = ordered.findIndex((line) => line.at >= windowStart);
  const inForce = firstInWindow === 0 ? undefined : ordered.at(firstInWindow === -1 ? -1 : firstInWindow - 1);

  type Point = {
    at: number,
    value: number | null,
    payload: Payload,
    mark: Omit<WindowedMark<Payload>, 'x' | 'pointIndex'> | null,
  };
  const points: Array<Point> = [];
  if (inForce !== undefined && inForce.value !== null) {
    points.push({ at: windowStart, value: inForce.value, payload: inForce.payload, mark: null });
  }
  if (firstInWindow !== -1) {
    ordered.slice(firstInWindow).forEach((line, offset) => {
      if (points.length === 0 && line.value === null) {
        return;
      }
      const previous = ordered.at(firstInWindow + offset - 1);
      const heldPoint = points.at(-1);
      if (line.value === null && heldPoint !== undefined && heldPoint.value !== null) {
        points.push({
          ...heldPoint,
          at: line.at,
          mark: isMarked(line.payload) ? { at: new Date(line.at), value: null, previous: heldPoint.value, payload: line.payload } : null,
        });
      }
      points.push({
        at: line.at,
        value: line.value,
        payload: line.payload,
        mark: line.value === null || !isMarked(line.payload) ? null : {
          at: new Date(line.at),
          value: line.value,
          previous: firstInWindow + offset === 0 ? null : previous?.value ?? null,
          payload: line.payload,
        },
      });
    });
  }

  const tail = points.at(-1);
  const holds = tail !== undefined && (tail.value !== null || options?.holdGapToNow === true);
  if (options?.holdToNow === true && tail !== undefined && holds && tail.at < now.getTime()) {
    points.push({ ...tail, at: now.getTime(), mark: null });
  }

  const first = points.at(0);
  const last = points.at(-1);
  if (first === undefined || last === undefined || first.value === null) {
    return null;
  }
  const span = last.at - first.at;
  const single = points.length === 1;
  const xOf = (at: number): number => (span === 0 ? 1 : (at - first.at) / span);

  return {
    values: single ? [first.value, first.value] : points.map((point) => point.value),
    xs: single ? [0, 1] : points.map((point) => xOf(point.at)),
    payloads: single ? [first.payload, first.payload] : points.map((point) => point.payload),
    marks: points.flatMap((point, index) => (point.mark === null
      ? []
      : [{ ...point.mark, x: xOf(point.at), pointIndex: single ? 1 : index }])),
    oldest: { at: new Date(first.at), value: first.value },
    latest: last.value,
    change: last.value === null ? null : last.value - first.value,
    start: new Date(first.at),
    end: new Date(last.at),
    single,
  };
};

/** Where `at` falls across a plot spanning `start` to `end`, from 0 to 1, or null outside it. */
export const guideFraction = (at: Date, start: Date, end: Date): number | null => {
  const [time, from, to] = [at.getTime(), start.getTime(), end.getTime()];
  if (time < from || time > to) {
    return null;
  }
  return to === from ? 1 : (time - from) / (to - from);
};
