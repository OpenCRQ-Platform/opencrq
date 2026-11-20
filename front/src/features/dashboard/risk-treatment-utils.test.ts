import { describe, expect, it } from 'vitest';
import type { ScenarioTrendPointLike } from './risk-treatment-utils';
import { readScenarioTrend, scenarioTrendWindow } from './risk-treatment-utils';

const point = (overrides: Partial<ScenarioTrendPointLike> & { date: string }): ScenarioTrendPointLike => ({
  likelihood: 0.5,
  likelihoodP10: 0.3,
  likelihoodP90: 0.7,
  aleMean: 1000,
  ...overrides,
});

describe('readScenarioTrend', () => {
  it('places each reading on the window ending today', () => {
    const reading = readScenarioTrend([
      point({ date: '2026-01-01' }),
      point({ date: '2026-01-06' }),
      point({ date: '2026-01-11' }),
    ], 'aleMean', '2026-01-11', 11);

    expect(reading.xs).toEqual([0, 0.5, 1]);
  });

  it('reads the change from the first reading to the last, rising as up', () => {
    const reading = readScenarioTrend([
      point({ date: '2026-01-01', likelihood: 0.4 }),
      point({ date: '2026-01-05', likelihood: 0.6 }),
    ], 'likelihood', '2026-01-05', 5);

    expect(reading.current).toBe(0.6);
    expect(reading.change).toBeCloseTo(0.2);
    expect(reading.direction).toBe('up');
  });

  it('skips a day without a reading of the metric rather than drawing a gap', () => {
    const reading = readScenarioTrend([
      point({ date: '2026-01-01', likelihood: 0.4 }),
      point({ date: '2026-01-02', likelihood: null }),
      point({ date: '2026-01-03', likelihood: 0.5 }),
    ], 'likelihood', '2026-01-03', 3);

    expect(reading.values).toEqual([0.4, 0.5]);
    expect(reading.xs).toEqual([0, 1]);
  });

  it('names the day of the first measured reading, skipping a day without one', () => {
    const reading = readScenarioTrend([
      point({ date: '2026-01-01', likelihood: null }),
      point({ date: '2026-01-02', likelihood: 0.4 }),
    ], 'likelihood', '2026-01-02', 2);

    expect(reading.firstDate).toBe('2026-01-02');
    expect(readScenarioTrend([], 'likelihood', '2026-01-02', 2).firstDate).toBeNull();
  });

  it('reads the latest likelihood band, and none for the annual loss exposure', () => {
    const points = [
      point({ date: '2026-01-01', likelihoodP10: null, likelihoodP90: null }),
      point({ date: '2026-01-02' }),
    ];

    expect(readScenarioTrend(points, 'likelihood', '2026-01-02', 2).currentBand).toEqual({ p10: 0.3, p90: 0.7 });
    expect(readScenarioTrend(points, 'aleMean', '2026-01-02', 2).currentBand).toBeNull();
  });

  it('gives no band to the latest value when its run carried none', () => {
    const reading = readScenarioTrend([point({ date: '2026-01-02', likelihoodP90: null })], 'likelihood', '2026-01-02', 2);

    expect(reading.currentBand).toBeNull();
  });

  it('reads no change from a single reading', () => {
    const reading = readScenarioTrend([point({ date: '2026-01-02' })], 'aleMean', '2026-01-02', 2);

    expect(reading).toMatchObject({ current: 1000, change: null, direction: 'flat' });
  });
});

describe('scenarioTrendWindow', () => {
  it('opens the window the given number of days back, today included', () => {
    const { start, end } = scenarioTrendWindow('2026-01-10', 10);

    expect(new Date(start).toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(new Date(end).toISOString().slice(0, 10)).toBe('2026-01-10');
  });
});
