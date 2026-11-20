import type { CapabilityFunction } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { ProvenPostureHistoryLine } from './proven-posture-lifeline-utils';
import { buildProvenPostureLifeline } from './proven-posture-lifeline-utils';

const DAY_MS = 86_400_000;
const NOW = new Date(Date.UTC(2026, 9, 6, 12));
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const line = (
  days: number,
  [held, tested, credited]: [number, number, number],
  capabilityFunction: CapabilityFunction = 'prevent',
): ProvenPostureHistoryLine => ({ function: capabilityFunction, at: daysAgo(days).toISOString(), credited, tested, held });

describe('buildProvenPostureLifeline', () => {
  it('should return nothing when no line was recorded', () => {
    expect(buildProvenPostureLifeline([], 'prevent', '90d', NOW)).toBeNull();
  });

  it('should open on the counts in force when the window opens, unmarked, and hold the last counts to now', () => {
    const lifeline = buildProvenPostureLifeline([
      line(200, [5, 10, 40]),
      line(30, [6, 10, 40]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.values).toEqual([0.5, 0.6, 0.6]);
    expect(lifeline.coverage).toEqual([0.25, 0.25, 0.25]);
    expect(lifeline.start).toEqual(daysAgo(90));
    expect(lifeline.end).toEqual(NOW);
    expect(lifeline.marks).toHaveLength(1);
    expect(lifeline.marks[0]).toMatchObject({ value: 0.6, previous: 0.5, payload: { held: 6, tested: 10, credited: 40 } });
  });

  it('should mark the first rate of the period when nothing was in force before it', () => {
    const lifeline = buildProvenPostureLifeline([line(30, [3, 4, 8])], 'prevent', '90d', NOW)!;

    expect(lifeline.marks).toHaveLength(1);
    expect(lifeline.marks[0]).toMatchObject({ value: 0.75, previous: null });
  });

  it('should break the rate where nothing was tested, never drawing it at zero', () => {
    const lifeline = buildProvenPostureLifeline([
      line(60, [2, 4, 8]),
      line(40, [0, 0, 8]),
      line(20, [3, 4, 8]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.values).toEqual([0.5, 0.5, null, 0.75, 0.75]);
    expect(lifeline.coverage).toEqual([0.5, 0.5, 0, 0.5, 0.5]);
    expect(lifeline.marks.map((mark) => mark.value)).toEqual([0.5, 0.75]);
    expect(lifeline.marks[1].previous).toBe(0.5);
  });

  it('should run a rate lost before now to today as a gap, the coverage with it', () => {
    const lifeline = buildProvenPostureLifeline([
      line(60, [2, 4, 8]),
      line(20, [0, 0, 8]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.values).toEqual([0.5, 0.5, null, null]);
    expect(lifeline.coverage).toEqual([0.5, 0.5, 0, 0]);
    expect(lifeline.end).toEqual(NOW);
    expect(lifeline.latest).toBeNull();
  });

  it('should read a function left with nothing credited as a lost rate over a coverage at zero', () => {
    const lifeline = buildProvenPostureLifeline([
      line(60, [2, 4, 8]),
      line(20, [0, 0, 0]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.values).toEqual([0.5, 0.5, null, null]);
    expect(lifeline.coverage).toEqual([0.5, 0.5, 0, 0]);
    expect(lifeline.domain).toEqual({ min: 0, max: 0.5 });
    expect(lifeline.marks.map((mark) => mark.value)).toEqual([0.5]);
    expect(lifeline.latest).toBeNull();
  });

  it('should draw a change of the coverage alone without marking it', () => {
    const lifeline = buildProvenPostureLifeline([
      line(60, [2, 4, 8]),
      line(40, [4, 8, 8]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.values).toEqual([0.5, 0.5, 0.5]);
    expect(lifeline.coverage).toEqual([0.5, 1, 1]);
    expect(lifeline.marks).toHaveLength(1);
  });

  it('should mark rates that round to one percent but differ', () => {
    const lifeline = buildProvenPostureLifeline([
      line(60, [500, 1000, 1000]),
      line(40, [501, 1000, 1000]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.marks).toHaveLength(2);
  });

  it('should scale both series on the lowest and highest value either holds', () => {
    const lifeline = buildProvenPostureLifeline([
      line(60, [3, 4, 20]),
      line(40, [3, 5, 10]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.domain).toEqual({ min: 0.2, max: 0.75 });
  });

  it('should ignore the other function', () => {
    const lifeline = buildProvenPostureLifeline([
      line(60, [1, 2, 4], 'detect'),
      line(40, [3, 4, 8]),
    ], 'prevent', '90d', NOW)!;

    expect(lifeline.marks.map((mark) => mark.value)).toEqual([0.75]);
    expect(buildProvenPostureLifeline([line(40, [3, 4, 8])], 'detect', '90d', NOW)).toBeNull();
  });

  it('should return nothing when the window holds no rate', () => {
    expect(buildProvenPostureLifeline([line(40, [0, 0, 8]), line(20, [0, 0, 9])], 'prevent', '90d', NOW)).toBeNull();
  });
});
