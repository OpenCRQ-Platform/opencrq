import { describe, expect, it } from 'vitest';
import {
  buildLifelineGeometry,
  buildWindowedLifeline,
  directionBetween,
  formatSignedPoints,
  guideFraction,
  nearestMarkIndex,
} from './lifeline-utils';

const series = (...values: Array<number>): Array<number> => values;

const ysOf = (path: string): Array<number> =>
  [...path.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((match) => Number(match[1]));

describe('buildLifelineGeometry', () => {
  it('should return nothing for an empty history', () => {
    expect(buildLifelineGeometry([])).toBeNull();
  });

  it('should place a single point in the middle of the box and draw no line', () => {
    const geometry = buildLifelineGeometry(series(100))!;

    expect(geometry.linePath).toBe('');
    expect(geometry.areaPath).toBeNull();
    expect(geometry.endX).toBe(0.5);
  });

  it('should span the full width and put the highest value nearest the top', () => {
    const geometry = buildLifelineGeometry(series(100, 200))!;

    const [first, second] = geometry.linePath.split(' ');
    expect(first.startsWith('M0,')).toBe(true);
    expect(second.startsWith('L100,')).toBe(true);
    expect(ysOf(geometry.linePath)[1]).toBeLessThan(ysOf(geometry.linePath)[0]);
    expect(geometry.endX).toBe(1);
  });

  it('should give a real move most of the height instead of a sliver', () => {
    const ys = ysOf(buildLifelineGeometry(series(100_000, 150_000))!.linePath);

    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(70);
  });

  it('should keep a move smaller than a tenth of the level visually gentle', () => {
    const ys = ysOf(buildLifelineGeometry(series(100_000, 102_000))!.linePath);

    expect(Math.abs(ys[0] - ys[1])).toBeLessThan(30);
  });

  it('should keep every point inside the box', () => {
    const ys = ysOf(buildLifelineGeometry(series(10, 5000, 300))!.linePath);

    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(100);
  });

  it('should close the area down to the floor of the box', () => {
    const geometry = buildLifelineGeometry(series(100, 200))!;

    expect(geometry.areaPath!.endsWith('L100,100 L0,100 Z')).toBe(true);
  });

  it('should centre a flat series rather than divide by a zero range', () => {
    const geometry = buildLifelineGeometry(series(100, 100))!;

    expect(geometry.linePath).toBe('M0,50 L100,50');
    expect(geometry.endY).toBe(0.5);
    expect(geometry.direction).toBe('flat');
  });

  it('should survive a history of nothing but zeroes', () => {
    const geometry = buildLifelineGeometry(series(0, 0))!;

    expect(geometry.linePath).toBe('M0,50 L100,50');
    expect(geometry.direction).toBe('flat');
  });

  it('should read a move under one percent as flat', () => {
    expect(buildLifelineGeometry(series(1000, 1005))!.direction).toBe('flat');
    expect(buildLifelineGeometry(series(1000, 1020))!.direction).toBe('up');
    expect(buildLifelineGeometry(series(1000, 980))!.direction).toBe('down');
  });

  it('should call a rise from zero an increase rather than dividing by it', () => {
    expect(buildLifelineGeometry(series(0, 500))!.direction).toBe('up');
  });

  it('should read the direction from the endpoints, not from the peak in between', () => {
    expect(buildLifelineGeometry(series(100, 9000, 90))!.direction).toBe('down');
  });

  it('should break the line at a null and resume after it, never bridging it', () => {
    const geometry = buildLifelineGeometry([60, 60, null, null, 70])!;

    expect(geometry.linePath.match(/M/g)).toHaveLength(2);
    expect(geometry.linePath.startsWith('M0,')).toBe(true);
    expect(geometry.linePath).toContain(' M100,');
    expect(geometry.areaPath!.match(/Z/g)).toHaveLength(2);
  });

  it('should draw a value standing alone between two gaps as a dot', () => {
    const geometry = buildLifelineGeometry([null, 50, null])!;

    expect(geometry.linePath).toBe('M50,50 L50,50');
  });

  it('should scale on the values alone and read the direction between the measured ends', () => {
    const geometry = buildLifelineGeometry([40, null, 60])!;

    expect(geometry.direction).toBe('up');
    expect(Math.max(...ysOf(geometry.linePath))).toBeLessThan(100);
  });

  it('should draw no end marker when the series ends in a gap', () => {
    const geometry = buildLifelineGeometry([40, 50, null])!;

    expect(geometry.endX).toBeNull();
    expect(geometry.endY).toBeNull();
  });

  it('should return nothing for a series of gaps only', () => {
    expect(buildLifelineGeometry([null, null])).toBeNull();
  });

  it('should place each value at the position it is given', () => {
    const geometry = buildLifelineGeometry([40, 50, 45], { xs: [0, 0.9, 1] })!;

    expect(geometry.points.map((point) => point?.x)).toEqual([0, 0.9, 1]);
    expect(geometry.linePath.split(' ')[1].startsWith('L90,')).toBe(true);
  });

  it('should bend a monotone curve through every point without passing beyond them', () => {
    const values = [40, 60, 55, 70];
    const geometry = buildLifelineGeometry(values, { xs: [0, 0.2, 0.7, 1], curve: 'monotone' })!;
    const controlYs = [...geometry.linePath.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) => Number(match[2]));
    const pointYs = geometry.points.map((point) => point!.y * 100);

    expect(geometry.linePath.startsWith('M0,')).toBe(true);
    expect(geometry.linePath.match(/C/g)).toHaveLength(3);
    expect(Math.min(...controlYs)).toBeGreaterThanOrEqual(Math.min(...pointYs) - 0.01);
    expect(Math.max(...controlYs)).toBeLessThanOrEqual(Math.max(...pointYs) + 0.01);
  });

  it('should place the lowest and highest values at their own heights, inside the padded frame', () => {
    const geometry = buildLifelineGeometry([20, 60, 40])!;

    expect(geometry.min).toBe(20);
    expect(geometry.max).toBe(60);
    expect(geometry.minY).toBe(geometry.points[0]!.y);
    expect(geometry.maxY).toBe(geometry.points[1]!.y);
    expect(geometry.maxY).toBeGreaterThan(0);
    expect(geometry.minY).toBeLessThan(1);
  });

  it('should still break a monotone curve on a gap', () => {
    const geometry = buildLifelineGeometry([40, 50, null, 45, 60], { curve: 'monotone' })!;

    expect(geometry.linePath.match(/M/g)).toHaveLength(2);
    expect(geometry.points[2]).toBeNull();
  });
});

describe('buildLifelineGeometry with a shared domain', () => {
  it('should put the same value at the same height in two series scaled on one domain', () => {
    const domain = { min: 0.2, max: 0.8 };
    const front = buildLifelineGeometry([0.5, 0.8], { domain })!;
    const back = buildLifelineGeometry([0.2, 0.5], { domain })!;

    expect(front.points[0]!.y).toBe(back.points[1]!.y);
    expect(front.maxY).toBe(front.points[1]!.y);
    expect(back.minY).toBe(back.points[0]!.y);
  });

  it('should print the domain rather than the values the series holds', () => {
    const geometry = buildLifelineGeometry([0.4, 0.6], { domain: { min: 0.1, max: 0.9 } })!;

    expect(geometry.min).toBe(0.1);
    expect(geometry.max).toBe(0.9);
    expect(geometry.points[0]!.y).toBeLessThan(geometry.minY);
  });
});

describe('directionBetween', () => {
  it('should read no move at all as flat', () => {
    expect(directionBetween(0, 0)).toBe('flat');
  });

  it('should call a rise from zero an increase', () => {
    expect(directionBetween(0, 500)).toBe('up');
  });

  it('should read a five percent drop as a decrease', () => {
    expect(directionBetween(1000, 950)).toBe('down');
  });
});

describe('nearestMarkIndex', () => {
  it('should snap to the nearest mark, and to none when there is none', () => {
    const marks = [{ x: 0 }, { x: 0.4 }, { x: 1 }];

    expect(nearestMarkIndex(marks, 0.15)).toBe(0);
    expect(nearestMarkIndex(marks, 0.3)).toBe(1);
    expect(nearestMarkIndex(marks, 0.9)).toBe(2);
    expect(nearestMarkIndex([], 0.5)).toBe(-1);
  });
});

describe('formatSignedPoints', () => {
  it('should sign a rise and a fall, and leave zero bare', () => {
    expect(formatSignedPoints(9)).toBe('+9');
    expect(formatSignedPoints(-4)).toBe('−4');
    expect(formatSignedPoints(0)).toBe('0');
  });
});

describe('buildWindowedLifeline', () => {
  const DAY_MS = 86_400_000;
  const NOW = new Date(Date.UTC(2026, 9, 1, 12));
  const daysAgo = (days: number): number => NOW.getTime() - days * DAY_MS;

  it('should hold the last value up to now, with no mark at now', () => {
    const lifeline = buildWindowedLifeline([
      { at: daysAgo(40), value: 30, payload: 'a' },
      { at: daysAgo(20), value: 50, payload: 'b' },
    ], '90d', NOW, { holdToNow: true })!;

    expect(lifeline.values).toEqual([30, 50, 50]);
    expect(lifeline.xs).toEqual([0, 0.5, 1]);
    expect(lifeline.end).toEqual(NOW);
    expect(lifeline.marks.map((mark) => mark.payload)).toEqual(['a', 'b']);
  });

  it('should hold a value set before the window flat across it', () => {
    const lifeline = buildWindowedLifeline([{ at: daysAgo(200), value: 40, payload: null }], '90d', NOW, { holdToNow: true })!;

    expect(lifeline.values).toEqual([40, 40]);
    expect(lifeline.start).toEqual(new Date(daysAgo(90)));
    expect(lifeline.marks).toEqual([]);
  });

  it('should not hold a lost value', () => {
    const lifeline = buildWindowedLifeline([
      { at: daysAgo(40), value: 30, payload: null },
      { at: daysAgo(20), value: null, payload: null },
    ], '90d', NOW, { holdToNow: true })!;

    expect(lifeline.values.at(-1)).toBeNull();
    expect(lifeline.end).toEqual(new Date(daysAgo(20)));
  });

  it('should mark a lost value on the end of the stretch it breaks', () => {
    const lifeline = buildWindowedLifeline([
      { at: daysAgo(40), value: 30, payload: 'set' },
      { at: daysAgo(20), value: null, payload: 'lost' },
    ], '90d', NOW)!;

    expect(lifeline.values).toEqual([30, 30, null]);
    expect(lifeline.marks).toMatchObject([
      { value: 30, payload: 'set' },
      { value: null, previous: 30, payload: 'lost', x: 1, pointIndex: 1 },
    ]);
  });

  it('should leave unmarked a lost value the caller says carries no mark', () => {
    const lifeline = buildWindowedLifeline([
      { at: daysAgo(40), value: 30, payload: true },
      { at: daysAgo(20), value: null, payload: false },
    ], '90d', NOW, { isMarked: (marked) => marked })!;

    expect(lifeline.marks.map((mark) => mark.value)).toEqual([30]);
  });

  it('should leave unmarked the lines the caller says carry no mark', () => {
    const lifeline = buildWindowedLifeline([
      { at: daysAgo(40), value: 30, payload: true },
      { at: daysAgo(20), value: 50, payload: false },
    ], '90d', NOW, { isMarked: (marked) => marked })!;

    expect(lifeline.values).toEqual([30, 50]);
    expect(lifeline.marks.map((mark) => mark.value)).toEqual([30]);
  });

  it('should give each point the payload of the line it draws, a held point the line it holds', () => {
    const lifeline = buildWindowedLifeline([
      { at: daysAgo(200), value: 10, payload: 'in force' },
      { at: daysAgo(40), value: 30, payload: 'a' },
      { at: daysAgo(20), value: null, payload: 'lost' },
    ], '90d', NOW, { holdToNow: true })!;

    expect(lifeline.values).toEqual([10, 30, 30, null]);
    expect(lifeline.payloads).toEqual(['in force', 'a', 'a', 'lost']);
  });
});

describe('guideFraction', () => {
  const start = new Date(Date.UTC(2026, 0, 1));
  const end = new Date(Date.UTC(2026, 0, 11));

  it('should place a date inside the span at its share of it', () => {
    expect(guideFraction(new Date(Date.UTC(2026, 0, 6)), start, end)).toBe(0.5);
    expect(guideFraction(start, start, end)).toBe(0);
    expect(guideFraction(end, start, end)).toBe(1);
  });

  it('should place no guide outside the span', () => {
    expect(guideFraction(new Date(Date.UTC(2025, 11, 31)), start, end)).toBeNull();
    expect(guideFraction(new Date(Date.UTC(2026, 0, 12)), start, end)).toBeNull();
  });
});
