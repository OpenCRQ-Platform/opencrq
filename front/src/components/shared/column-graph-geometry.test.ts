import { describe, expect, it } from 'vitest';
import {
  boxContains,
  boxesClearOfEachOther,
  curveMidpoint,
  distanceToCurve,
  edgeCurve,
  endTangent,
  startTangent,
  trimCurve,
} from './column-graph-geometry';

const TOLERANCE = 20;

describe('edgeCurve', () => {
  it('leaves and enters the two nodes horizontally, cut at each one\'s reach', () => {
    const curve = edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 200, y: 80, reach: 12 }, TOLERANCE);

    expect(curve?.start).toEqual({ x: 10, y: 0 });
    expect(curve?.end).toEqual({ x: 188, y: 80 });
    expect(curve?.c1.y).toBe(0);
    expect(curve?.c2.y).toBe(80);
  });

  it('points the head along the curve\'s end, which is horizontal', () => {
    const curve = edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 200, y: 80, reach: 12 }, TOLERANCE);

    expect(curve === null ? null : endTangent(curve)).toEqual({ x: 1, y: 0 });
    expect(curve === null ? null : startTangent(curve)).toEqual({ x: -1, y: 0 });
  });

  it('arcs out to the right between two nodes of one column', () => {
    const curve = edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 5, y: 110, reach: 10 }, TOLERANCE);

    expect(curve).not.toBeNull();
    expect(curve!.c1.x).toBeGreaterThan(curve!.start.x);
    expect(curve!.c2.x).toBeGreaterThan(curve!.end.x);
    expect(curveMidpoint(curve!).x).toBeGreaterThan(5);
  });

  it('swings the arc between two neighbours of one column past the label under the upper one', () => {
    const curve = edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 0, y: 110, reach: 10 }, TOLERANCE);

    expect(curveMidpoint(curve!).x).toBeGreaterThan(65);
  });

  it('points both ends of an arc within one column at the centre of their node', () => {
    const from = { x: 0, y: 0, reach: 10 };
    const to = { x: 0, y: 120, reach: 12 };
    const curve = edgeCurve(from, to, TOLERANCE)!;

    const intoStart = startTangent(curve);
    const intoEnd = endTangent(curve);
    const towards = (point: { x: number, y: number }, centre: { x: number, y: number }) => {
      const length = Math.hypot(centre.x - point.x, centre.y - point.y);
      return { x: (centre.x - point.x) / length, y: (centre.y - point.y) / length };
    };
    expect(intoStart.x).toBeCloseTo(towards(curve.start, from).x);
    expect(intoStart.y).toBeCloseTo(towards(curve.start, from).y);
    expect(intoEnd.x).toBeCloseTo(towards(curve.end, to).x);
    expect(intoEnd.y).toBeCloseTo(towards(curve.end, to).y);
  });

  it('draws nothing between two nodes too close for a line to show', () => {
    expect(edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 15, y: 0, reach: 10 }, 5)).toBeNull();
    expect(edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 0, y: 15, reach: 10 }, TOLERANCE)).toBeNull();
  });
});

describe('curveMidpoint', () => {
  it('sits halfway between the two nodes, where the pill goes', () => {
    const curve = edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 200, y: 80, reach: 10 }, TOLERANCE);

    expect(curve === null ? null : curveMidpoint(curve)).toEqual({ x: 100, y: 40 });
  });
});

describe('trimCurve', () => {
  it('pulls the end back along its tangent and keeps the tangent', () => {
    const curve = edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 200, y: 80, reach: 10 }, TOLERANCE)!;
    const trimmed = trimCurve(curve, 0, 6);

    expect(trimmed.end).toEqual({ x: 184, y: 80 });
    expect(trimmed.start).toEqual(curve.start);
    expect(endTangent(trimmed)).toEqual(endTangent(curve));
  });
});

describe('distanceToCurve', () => {
  const curve = edgeCurve({ x: 0, y: 0, reach: 10 }, { x: 200, y: 80, reach: 10 }, TOLERANCE)!;

  it('is nothing on the curve and grows away from it', () => {
    expect(distanceToCurve(curve, curveMidpoint(curve))).toBeLessThan(0.5);
    expect(distanceToCurve(curve, { x: 40, y: 60 })).toBeGreaterThan(30);
  });
});

describe('boxContains', () => {
  it('holds the points inside the box, edges included', () => {
    const box = { x: 10, y: 10, halfWidth: 5, halfHeight: 2 };

    expect(boxContains(box, { x: 15, y: 12 })).toBe(true);
    expect(boxContains(box, { x: 16, y: 10 })).toBe(false);
  });
});

describe('boxesClearOfEachOther', () => {
  const at = (id: string, x: number, y: number) => ({ id, box: { x, y, halfWidth: 10, halfHeight: 5 } });

  it('drops a box that overlaps one kept before it, and keeps the first', () => {
    const kept = boxesClearOfEachOther([at('a', 0, 0), at('b', 5, 3), at('c', 100, 0)]);

    expect(kept.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('keeps boxes side by side or one above the other', () => {
    const kept = boxesClearOfEachOther([at('a', 0, 0), at('b', 25, 0), at('c', 0, 12)]);

    expect(kept.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
