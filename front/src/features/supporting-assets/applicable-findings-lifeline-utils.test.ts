import { describe, expect, it } from 'vitest';
import type { DailyCount } from './applicable-findings-lifeline-utils';
import { buildApplicableFindingsLifeline, countDirection } from './applicable-findings-lifeline-utils';

const START = Date.UTC(2025, 9, 12);
const DAY_MS = 86_400_000;

const seriesOf = (counts: ReadonlyArray<number>): Array<DailyCount> =>
  counts.map((count, index) => ({ day: new Date(START + index * DAY_MS).toISOString().slice(0, 10), count }));

describe('buildApplicableFindingsLifeline', () => {
  it('should return nothing for an empty series', () => {
    expect(buildApplicableFindingsLifeline([], '12m')).toBeNull();
  });

  it('should hold each count until the day it moves, then step to the new one', () => {
    const lifeline = buildApplicableFindingsLifeline(seriesOf([3, 3, 5, 5, 4]), '12m')!;

    expect(lifeline.values).toEqual([3, 3, 5, 5, 4]);
    expect(lifeline.xs).toEqual([0, 0.5, 0.5, 1, 1]);
  });

  it('should hold the last count to the end of the window', () => {
    const lifeline = buildApplicableFindingsLifeline(seriesOf([3, 5, 5]), '12m')!;

    expect(lifeline.values).toEqual([3, 3, 5, 5]);
    expect(lifeline.xs).toEqual([0, 0.5, 0.5, 1]);
  });

  it('should mark each day the count moves with the count before it', () => {
    const series = seriesOf([3, 3, 5, 5, 4]);
    const lifeline = buildApplicableFindingsLifeline(series, '12m')!;

    expect(lifeline.marks).toEqual([
      { day: series[2].day, count: 5, previous: 3, x: 0.5, pointIndex: 2 },
      { day: series[4].day, count: 4, previous: 5, x: 1, pointIndex: 4 },
    ]);
  });

  it('should measure the move from the window first day to its last', () => {
    const series = seriesOf([3, 3, 5, 5, 4]);
    const lifeline = buildApplicableFindingsLifeline(series, '12m')!;

    expect(lifeline.oldest).toEqual(series[0]);
    expect(lifeline.latest).toEqual(series[4]);
    expect(lifeline.change).toBe(1);
  });

  it('should read only the window last days', () => {
    const counts = Array.from({ length: 364 }, (_, index) => (index < 300 ? 10 : 12));
    const lifeline = buildApplicableFindingsLifeline(seriesOf(counts), '90d')!;

    expect(lifeline.oldest.count).toBe(10);
    expect(lifeline.oldest.day).toBe(seriesOf(counts)[274].day);
    expect(lifeline.change).toBe(2);
    expect(lifeline.marks).toHaveLength(1);
  });

  it('should read the whole series for a window longer than it', () => {
    const series = seriesOf(Array.from({ length: 364 }, (_, index) => index));
    const lifeline = buildApplicableFindingsLifeline(series, '12m')!;

    expect(lifeline.oldest).toEqual(series[0]);
    expect(lifeline.marks).toHaveLength(363);
  });

  it('should draw a flat line at 0 for an asset with no applicable finding', () => {
    const lifeline = buildApplicableFindingsLifeline(seriesOf([0, 0, 0]), '12m')!;

    expect(lifeline.values).toEqual([0, 0]);
    expect(lifeline.xs).toEqual([0, 1]);
    expect(lifeline.marks).toEqual([]);
    expect(lifeline.change).toBe(0);
  });

  it('should draw a single day flat across the plot', () => {
    const lifeline = buildApplicableFindingsLifeline(seriesOf([7]), '12m')!;

    expect(lifeline.values).toEqual([7, 7]);
    expect(lifeline.xs).toEqual([0, 1]);
  });

  it('should read the days in calendar order whatever order they arrive in', () => {
    const series = seriesOf([1, 2]);
    const lifeline = buildApplicableFindingsLifeline([series[1], series[0]], '12m')!;

    expect(lifeline.oldest).toEqual(series[0]);
    expect(lifeline.latest).toEqual(series[1]);
  });
});

describe('countDirection', () => {
  it('should read any rise as up and any fall as down, however small', () => {
    expect(countDirection(1)).toBe('up');
    expect(countDirection(-1)).toBe('down');
    expect(countDirection(0)).toBe('flat');
  });
});
