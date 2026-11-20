import { describe, expect, it } from 'vitest';
import { buildBandAxis, buildExposureBandSeries, MAX_AXIS_POINTS } from './exposure-band';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 31, 15);
const daysAgo = (days: number) => NOW - days * DAY_MS;

describe('buildBandAxis', () => {
  it('should be empty before any run is on file', () => {
    expect(buildBandAxis({ windowDays: 30, now: NOW, earliestRunTime: null })).toEqual([]);
  });

  it('should sample every day of a window up to 120 days, ending today', () => {
    const axis = buildBandAxis({ windowDays: 30, now: NOW, earliestRunTime: daysAgo(400) });

    expect(axis).toHaveLength(30);
    expect(axis.at(0)).toBe('2026-07-02');
    expect(axis.at(-1)).toBe('2026-07-31');
  });

  it('should open on the first run when the platform is younger than the window', () => {
    const axis = buildBandAxis({ windowDays: 365, now: NOW, earliestRunTime: daysAgo(10) });

    expect(axis).toHaveLength(11);
    expect(axis.at(0)).toBe('2026-07-21');
  });

  it('should sample a year weekly, keeping today and the opening day', () => {
    const axis = buildBandAxis({ windowDays: 365, now: NOW, earliestRunTime: daysAgo(900) });

    expect(axis.length).toBeLessThanOrEqual(54);
    expect(axis.at(-1)).toBe('2026-07-31');
    expect(axis.at(0)).toBe('2025-08-01');
  });

  it('should step monthly once the span passes 400 days', () => {
    const axis = buildBandAxis({ windowDays: null, now: NOW, earliestRunTime: daysAgo(500) });

    expect(axis).toHaveLength(18);
  });

  it('should list strictly ascending days whatever the day of the month it runs on', () => {
    const unordered: Array<string> = [];
    for (let offset = 0; offset < 800; offset += 1) {
      const now = Date.UTC(2024, 0, 1, 12) + offset * DAY_MS;
      for (const windowDays of [30, 90, 183, 365, null]) {
        for (const age of [10, 200, 500, 1500, 4000]) {
          const axis = buildBandAxis({ windowDays, now, earliestRunTime: now - age * DAY_MS });
          if (axis.some((day, index) => index > 0 && day <= axis[index - 1])) {
            unordered.push(`${new Date(now).toISOString().slice(0, 10)} window ${windowDays} age ${age}`);
          }
        }
      }
    }

    expect(unordered).toEqual([]);
  });

  it('should hold the whole history of any length to the axis ceiling', () => {
    const axis = buildBandAxis({ windowDays: null, now: NOW, earliestRunTime: daysAgo(365 * 60) });

    expect(axis.length).toBeLessThanOrEqual(MAX_AXIS_POINTS);
    expect(axis.at(-1)).toBe('2026-07-31');
  });
});

describe('buildExposureBandSeries', () => {
  const days = ['2026-07-01', '2026-07-02', '2026-07-03'];

  it('should add up each scenario\'s latest means as of every sampled day', () => {
    const points = buildExposureBandSeries(
      days,
      [],
      [
        { riskScenarioId: 's1', axisIndex: 0, aleMean: 100, lefMean: 1 },
        { riskScenarioId: 's2', axisIndex: 1, aleMean: 50, lefMean: 2 },
      ],
    );

    expect(points).toEqual([
      { date: '2026-07-01', aleMean: 100, lefMean: 1 },
      { date: '2026-07-02', aleMean: 150, lefMean: 3 },
      { date: '2026-07-03', aleMean: 150, lefMean: 3 },
    ]);
  });

  it('should leave a day null until some scenario has a run', () => {
    const points = buildExposureBandSeries(days, [], [{ riskScenarioId: 's1', axisIndex: 1, aleMean: 100, lefMean: null }]);

    expect(points).toEqual([
      { date: '2026-07-01', aleMean: null, lefMean: null },
      { date: '2026-07-02', aleMean: 100, lefMean: null },
      { date: '2026-07-03', aleMean: 100, lefMean: null },
    ]);
  });

  it('should open on the seed and keep a scenario whose only run predates the window', () => {
    const points = buildExposureBandSeries(days, [{ riskScenarioId: 's1', aleMean: 100, lefMean: 1 }], []);

    expect(points.map((point) => point.aleMean)).toEqual([100, 100, 100]);
  });

  it('should keep carrying each mean past a bucket that has none of it', () => {
    const points = buildExposureBandSeries(days, [], [
      { riskScenarioId: 's1', axisIndex: 0, aleMean: 100, lefMean: 1 },
      { riskScenarioId: 's1', axisIndex: 1, aleMean: null, lefMean: 2 },
    ]);

    expect(points.map((point) => [point.aleMean, point.lefMean])).toEqual([[100, 1], [100, 2], [100, 2]]);
  });

  it('should let a bucket replace the seed from its own day, and keep a mean it has none of', () => {
    const points = buildExposureBandSeries(
      days,
      [{ riskScenarioId: 's1', aleMean: 100, lefMean: 1 }],
      [{ riskScenarioId: 's1', axisIndex: 1, aleMean: 300, lefMean: null }],
    );

    expect(points.map((point) => [point.aleMean, point.lefMean])).toEqual([[100, 1], [300, 1], [300, 1]]);
  });
});
