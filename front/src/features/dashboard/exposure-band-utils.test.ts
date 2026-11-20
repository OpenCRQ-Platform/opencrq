import { describe, expect, it } from 'vitest';
import { bandFormatters, toBandChartSeries, toExposureBandPoints } from './exposure-band-utils';

describe('toExposureBandPoints', () => {
  const rows = [
    { date: '2026-07-01', aleMean: 100, lefMean: 1 },
    { date: '2026-07-02', aleMean: null, lefMean: 2 },
  ];

  it('should read the money mean for the ale metric', () => {
    expect(toExposureBandPoints(rows, 'ale')).toEqual([
      { date: '2026-07-01', mean: 100 },
      { date: '2026-07-02', mean: null },
    ]);
  });

  it('should read the event rate for the lef metric', () => {
    expect(toExposureBandPoints(rows, 'lef')).toEqual([
      { date: '2026-07-01', mean: 1 },
      { date: '2026-07-02', mean: 2 },
    ]);
  });
});

describe('toBandChartSeries', () => {
  it('should plot only the days carrying a mean, each with its change against the first', () => {
    const series = toBandChartSeries([
      { date: '2026-07-01', mean: null },
      { date: '2026-07-02', mean: 100 },
      { date: '2026-07-03', mean: 80 },
    ]);

    expect(series.points.map((point) => [point.date, point.mean, point.delta])).toEqual([
      ['2026-07-02', 100, null],
      ['2026-07-03', 80, -20],
    ]);
    expect(series.line.map((point) => point.y)).toEqual([100, 80]);
  });
});

describe('bandFormatters', () => {
  it('should print the money metric as compact dollars, its change signed in both directions', () => {
    const { formatValue, formatChange } = bandFormatters('ale');

    expect(formatValue(22_668_403)).toBe('$22.7M');
    expect(formatChange(1_200)).toBe('+$1K');
    expect(formatChange(-22_668_403)).toBe('−$22.7M');
  });

  it('should print the event rate at two decimals, its change signed in both directions', () => {
    const { formatValue, formatChange } = bandFormatters('lef');

    expect(formatValue(0.1234)).toBe('0.12');
    expect(formatChange(0.12)).toBe('+0.12');
    expect(formatChange(-0.12)).toBe('−0.12');
  });

  it('should leave unsigned a change that prints as zero', () => {
    expect(bandFormatters('ale').formatChange(0.4)).toBe('$0');
    expect(bandFormatters('lef').formatChange(-0.004)).toBe('0.00');
  });
});
