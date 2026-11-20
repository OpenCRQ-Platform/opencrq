export interface Point {
  x: number,
  y: number,
}

export interface Curve {
  start: Point,
  c1: Point,
  c2: Point,
  end: Point,
}

interface CurveEnd extends Point {
  /** How far from its centre a line touching the node must stop. */
  reach: number,
}

/** A box centred on a point, sized in graph units. */
export interface Box extends Point {
  halfWidth: number,
  halfHeight: number,
}

/** Shallow enough that the arc rounds out to the side rather than folding into a point. */
const SIDEWAYS_ANGLE = Math.PI / 7;
/** How far the arc between two nodes of one column swings out, against their distance. */
const SIDEWAYS_BULGE = 0.45;
/** Enough for the apex to clear the label under the upper node at the default zoom, which a shorter arc hides behind. */
const MIN_SIDEWAYS_BULGE = 90;
const HIT_SAMPLES = 24;

const unit = (x: number, y: number): Point => {
  const length = Math.hypot(x, y);
  return length === 0 ? { x: 1, y: 0 } : { x: x / length, y: y / length };
};

/**
 * Leaves and enters each node horizontally, since the graph reads left to right. Two nodes of one
 * column, within `columnTolerance` across, are joined by an arc swinging out to the right instead,
 * whose ends run along a radius so that a head drawn on them points at the node's centre.
 * `null` when the nodes are too close for any line to show between them.
 */
export const edgeCurve = (from: CurveEnd, to: CurveEnd, columnTolerance: number): Curve | null => {
  const dx = to.x - from.x;
  if (Math.abs(dx) <= columnTolerance) {
    const span = Math.abs(to.y - from.y);
    if (span <= from.reach + to.reach) {
      return null;
    }
    const down = to.y >= from.y ? 1 : -1;
    const out = { x: Math.cos(SIDEWAYS_ANGLE), y: down * Math.sin(SIDEWAYS_ANGLE) };
    const back = { x: out.x, y: -out.y };
    const start = { x: from.x + from.reach * out.x, y: from.y + from.reach * out.y };
    const end = { x: to.x + to.reach * back.x, y: to.y + to.reach * back.y };
    // Past half the span the two handles cross, and the arc folds into a point.
    const handle = Math.min(Math.max(span * SIDEWAYS_BULGE, MIN_SIDEWAYS_BULGE) / out.x, span / 2 / Math.abs(out.y));
    return {
      start,
      c1: { x: start.x + handle * out.x, y: start.y + handle * out.y },
      c2: { x: end.x + handle * back.x, y: end.y + handle * back.y },
      end,
    };
  }
  const direction = Math.sign(dx);
  const start = { x: from.x + direction * from.reach, y: from.y };
  const end = { x: to.x - direction * to.reach, y: to.y };
  if ((end.x - start.x) * direction <= 0) {
    return null;
  }
  const handle = (end.x - start.x) / 2;
  return { start, c1: { x: start.x + handle, y: start.y }, c2: { x: end.x - handle, y: end.y }, end };
};

const curvePoint = ({ start, c1, c2, end }: Curve, t: number): Point => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * start.x + b * c1.x + c * c2.x + d * end.x,
    y: a * start.y + b * c1.y + c * c2.y + d * end.y,
  };
};

/**
 * The midpoint in length as well as in parameter: both handles of a curve drawn by `edgeCurve` are the
 * same length, so the curve is symmetric about `t = 0.5`.
 */
export const curveMidpoint = (curve: Curve): Point => curvePoint(curve, 0.5);

export const endTangent = ({ c2, end, start }: Curve): Point =>
  (c2.x === end.x && c2.y === end.y ? unit(end.x - start.x, end.y - start.y) : unit(end.x - c2.x, end.y - c2.y));

/** The way a head at the start of the curve points, out of it. */
export const startTangent = ({ c1, start, end }: Curve): Point =>
  (c1.x === start.x && c1.y === start.y ? unit(start.x - end.x, start.y - end.y) : unit(start.x - c1.x, start.y - c1.y));

/**
 * The curve pulled back from either end along its tangent, so the line stops where an arrowhead begins
 * rather than running under its ink. Each end moves with its handle, which keeps the tangent.
 */
export const trimCurve = (curve: Curve, atStart: number, atEnd: number): Curve => {
  const head = endTangent(curve);
  const tail = startTangent(curve);
  return {
    start: { x: curve.start.x - tail.x * atStart, y: curve.start.y - tail.y * atStart },
    c1: { x: curve.c1.x - tail.x * atStart, y: curve.c1.y - tail.y * atStart },
    c2: { x: curve.c2.x - head.x * atEnd, y: curve.c2.y - head.y * atEnd },
    end: { x: curve.end.x - head.x * atEnd, y: curve.end.y - head.y * atEnd },
  };
};

const distanceToSegment = (point: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

export const distanceToCurve = (curve: Curve, point: Point): number => {
  let nearest = Number.POSITIVE_INFINITY;
  let previous = curve.start;
  for (let step = 1; step <= HIT_SAMPLES; step += 1) {
    const next = curvePoint(curve, step / HIT_SAMPLES);
    nearest = Math.min(nearest, distanceToSegment(point, previous, next));
    previous = next;
  }
  return nearest;
};

export const boxContains = (box: Box, point: Point): boolean =>
  Math.abs(point.x - box.x) <= box.halfWidth && Math.abs(point.y - box.y) <= box.halfHeight;

const boxesOverlap = (first: Box, second: Box): boolean =>
  Math.abs(first.x - second.x) < first.halfWidth + second.halfWidth
  && Math.abs(first.y - second.y) < first.halfHeight + second.halfHeight;

/** Kept in the order given, each one dropped when it would overlap one kept before it. */
export const boxesClearOfEachOther = <T extends { box: Box }>(items: ReadonlyArray<T>): Array<T> => {
  const kept: Array<T> = [];
  for (const item of items) {
    if (!kept.some((other) => boxesOverlap(other.box, item.box))) {
      kept.push(item);
    }
  }
  return kept;
};
