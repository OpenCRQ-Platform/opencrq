import { describe, expect, it } from 'vitest';
import type { PostureHistoryLine } from './posture-lifeline-utils';
import { buildPostureLifeline, spansLessThanADay } from './posture-lifeline-utils';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOW = new Date(Date.UTC(2026, 9, 1, 12));

const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();
const hoursAgo = (hours: number): string => new Date(NOW.getTime() - hours * HOUR_MS).toISOString();

const line = (at: string, score: number | null): PostureHistoryLine => ({ at, score, cause: null });

describe('buildPostureLifeline', () => {
  it('should return nothing for an asset with no posture history', () => {
    expect(buildPostureLifeline([], '90d', NOW)).toBeNull();
  });

  it('should place each line at its date across a plot spanning the first line to the last', () => {
    const lifeline = buildPostureLifeline([
      line(daysAgo(30), 55),
      line(daysAgo(20), 58),
      line(daysAgo(10), 64),
    ], '90d', NOW)!;

    expect(lifeline.values).toEqual([55, 58, 64]);
    expect(lifeline.xs).toEqual([0, 0.5, 1]);
    expect(lifeline.start).toEqual(new Date(daysAgo(30)));
    expect(lifeline.end).toEqual(new Date(daysAgo(10)));
    expect(lifeline.oldest.score).toBe(55);
    expect(lifeline.latest).toBe(64);
    expect(lifeline.change).toBe(9);
  });

  it('should open on the line in force when the window opens, drawn at the opening and given no mark', () => {
    const lifeline = buildPostureLifeline([
      line(daysAgo(200), 40),
      line(daysAgo(45), 45),
    ], '90d', NOW)!;

    expect(lifeline.oldest).toEqual({ at: new Date(daysAgo(90)), score: 40 });
    expect(lifeline.xs).toEqual([0, 1]);
    expect(lifeline.marks).toHaveLength(1);
    expect(lifeline.marks[0]).toMatchObject({ score: 45, previous: 40, x: 1, pointIndex: 1 });
  });

  it('should fill the whole width with changes a few hours apart', () => {
    const lifeline = buildPostureLifeline([
      line(hoursAgo(4), 48),
      line(hoursAgo(3), 52),
      line(hoursAgo(1), 58),
    ], '90d', NOW)!;

    expect(lifeline.xs).toEqual([0, 1 / 3, 1]);
    expect(spansLessThanADay(lifeline)).toBe(true);
    expect(lifeline.marks.map((mark) => mark.previous)).toEqual([null, 48, 52]);
  });

  it('should draw a single line flat across the whole width, marked at its right end', () => {
    const lifeline = buildPostureLifeline([line(daysAgo(2), 55)], '90d', NOW)!;

    expect(lifeline.single).toBe(true);
    expect(lifeline.values).toEqual([55, 55]);
    expect(lifeline.xs).toEqual([0, 1]);
    expect(lifeline.marks).toEqual([expect.objectContaining({ x: 1, pointIndex: 1, previous: null })]);
  });

  it('should break where the posture was lost and mark only the lines with a posture', () => {
    const lifeline = buildPostureLifeline([
      line(daysAgo(20), 70),
      line(daysAgo(15), null),
      line(daysAgo(10), 60),
    ], '90d', NOW)!;

    expect(lifeline.values).toEqual([70, 70, null, 60]);
    expect(lifeline.xs.slice(1, 3)).toEqual([0.5, 0.5]);
    expect(lifeline.marks.map((mark) => mark.score)).toEqual([70, 60]);
    expect(lifeline.marks[1].previous).toBeNull();
  });

  it('should never carry a lost posture forward', () => {
    const lifeline = buildPostureLifeline([
      line(daysAgo(20), 70),
      line(daysAgo(3), null),
    ], '90d', NOW)!;

    expect(lifeline.values.at(-1)).toBeNull();
    expect(lifeline.latest).toBeNull();
    expect(lifeline.change).toBeNull();
  });

  it('should start on the first posture of the window rather than on the gap before it', () => {
    const lifeline = buildPostureLifeline([
      line(daysAgo(120), null),
      line(daysAgo(30), 50),
    ], '90d', NOW)!;

    expect(lifeline.values).toEqual([50, 50]);
    expect(lifeline.start).toEqual(new Date(daysAgo(30)));
  });

  it('should return nothing when the window holds no posture', () => {
    expect(buildPostureLifeline([line(daysAgo(120), null)], '90d', NOW)).toBeNull();
  });

  it('should redraw a wider window from the same lines', () => {
    const lines = [line(daysAgo(150), 30), line(daysAgo(100), 32), line(daysAgo(10), 35)];

    expect(buildPostureLifeline(lines, '90d', NOW)!.marks).toHaveLength(1);
    expect(buildPostureLifeline(lines, '6m', NOW)!.marks).toHaveLength(3);
  });
});
