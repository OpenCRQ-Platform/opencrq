import { describe, expect, it } from 'vitest';
import type { PlottedBandPoint } from './exposure-band-utils';
import { bandAxisWindow, buildForecastSegment } from './exposure-band-utils';

const DAY_MS = 86_400_000;
const DAY_0 = Date.UTC(2026, 5, 1);

const point = (dayOffset: number, mean: number): PlottedBandPoint => ({
  x: DAY_0 + dayOffset * DAY_MS,
  date: new Date(DAY_0 + dayOffset * DAY_MS).toISOString().slice(0, 10),
  mean,
  delta: null,
});

describe('bandAxisWindow', () => {
  it('should start the axis on the first measured day', () => {
    const window = bandAxisWindow([point(0, 100), point(90, 120)], 0.85)!;

    expect(window.min).toBe(DAY_0);
  });

  it('should reserve the share of the width the fill ratio leaves over', () => {
    const points = [point(0, 100), point(90, 120)];

    const window = bandAxisWindow(points, 0.85)!;

    const total = window.max - window.min;
    const reserved = window.max - points[1].x;
    expect(reserved / total).toBeCloseTo(0.15, 6);
  });

  it('should reserve nothing measurable as the fill ratio approaches the whole width', () => {
    const points = [point(0, 100), point(90, 120)];

    const window = bandAxisWindow(points, 1)!;

    expect(window.max).toBe(points[1].x);
  });

  it('should pad an axis that would otherwise be a single point wide', () => {
    const window = bandAxisWindow([point(0, 100)], 0.85)!;

    expect(window.max - window.min).toBe(30 * DAY_MS);
  });

  it('should give no window for an empty series or a ratio that cannot divide', () => {
    expect(bandAxisWindow([], 0.85)).toBeNull();
    expect(bandAxisWindow([point(0, 100), point(90, 120)], 0)).toBeNull();
  });
});

describe('buildForecastSegment', () => {
  it('should run from the last measured point to the projection', () => {
    const points = [point(0, 100), point(90, 120)];
    const window = bandAxisWindow(points, 0.85)!;

    const segment = buildForecastSegment(points, window, 80);

    expect(segment).toHaveLength(2);
    expect(segment[0]).toEqual({ x: points[1].x, y: 120 });
    expect(segment[1].y).toBe(80);
  });

  it('should place the projection inside the reserved region, clear of both edges', () => {
    const points = [point(0, 100), point(90, 120)];
    const window = bandAxisWindow(points, 0.85)!;

    const [, projected] = buildForecastSegment(points, window, 80);

    expect(projected.x).toBeGreaterThan(points[1].x);
    expect(projected.x).toBeLessThan(window.max);
  });

  it('should give no segment without history or without a window', () => {
    const points = [point(0, 100), point(90, 120)];

    expect(buildForecastSegment([], bandAxisWindow(points, 0.85), 80)).toEqual([]);
    expect(buildForecastSegment(points, null, 80)).toEqual([]);
  });
});
