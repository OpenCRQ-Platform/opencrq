import { describe, expect, it } from 'vitest';
import type { FindingCreationBucket, FindingTransitionBucket } from './remediation-pace';
import { trendWindowStart } from './aggregation';
import { buildRemediationPace, DAYS_PER_MONTH, remediationPaceHorizon } from './remediation-pace';

const NOW = new Date('2026-10-10T12:00:00.000Z');

const build = (
  creations: Array<FindingCreationBucket>,
  transitions: Array<FindingTransitionBucket>,
  options: { windowDays?: number, timeOpen?: Parameters<typeof buildRemediationPace>[0]['timeOpen'] } = {},
) => {
  const windowDays = options.windowDays ?? 90;
  return buildRemediationPace({
    creations,
    transitions,
    timeOpen: options.timeOpen ?? [],
    now: NOW,
    windowStart: trendWindowStart(NOW, windowDays),
    windowDays,
  });
};

const created = (day: string | null, count: number, firstDay = day ?? '2025-06-01'): FindingCreationBucket =>
  ({ band: 'high', day, count, firstDay });
const closed = (day: string | null, count: number): FindingTransitionBucket => ({ band: 'high', day, kind: 'closed', count });

describe('remediationPaceHorizon', () => {
  it('starts on the first day of the twelfth full month back', () => {
    expect(remediationPaceHorizon(NOW).toISOString()).toBe('2025-10-01T00:00:00.000Z');
  });
});

describe('buildRemediationPace', () => {
  it('counts a reopened finding as open again and never as new', () => {
    const pace = build(
      [created(null, 5), created('2026-08-05', 3), created('2026-10-02', 2)],
      [
        closed(null, 2),
        closed('2026-08-20', 2),
        { band: 'high', day: '2026-09-03', kind: 'reopened', count: 1 },
        closed('2026-10-05', 1),
      ],
    );
    const high = pace.bands.find((band) => band.band === 'high')!;

    expect(high.months.map((month) => month.month)).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
    expect(high.months.at(-2)).toEqual({ month: '2026-08', newCount: 3, closedCount: 2, openAtEnd: 4 });
    expect(high.months.at(-1)).toEqual({ month: '2026-09', newCount: 0, closedCount: 0, openAtEnd: 5 });
    expect(high).toMatchObject({ openCount: 6, openAtWindowStart: 3, newInWindow: 5, closedInWindow: 3 });
    expect(pace.total).toMatchObject({ openCount: 6, newInWindow: 5 });
  });

  it('takes the best closing rate held over three consecutive full months as capacity', () => {
    const pace = build(
      [created(null, 100), created('2026-09-01', 33)],
      [
        closed('2025-11-15', 9),
        closed('2025-12-15', 12),
        closed('2026-01-15', 6),
        closed('2026-05-10', 30),
        closed('2026-06-10', 3),
        closed('2026-10-01', 50),
      ],
    );
    const high = pace.bands.find((band) => band.band === 'high')!;

    expect(high.capacityPerMonth).toBe(11);
    expect(high.newPerMonth).toBeCloseTo(33 / (90 / DAYS_PER_MONTH));
    expect(high.occupancy).toBeCloseTo(high.newPerMonth / 11);
    expect(high.occupancyHistory).toHaveLength(6);
    expect(high.occupancyHistory.at(-1)).toBeCloseTo(33 / 11);
  });

  it('reads neither a month before the first finding nor the partial month it came in when it measures capacity', () => {
    const pace = build(
      [created('2026-08-20', 10)],
      [closed('2026-08-25', 4), closed('2026-09-10', 6)],
    );

    expect(pace.total.capacityPerMonth).toBe(6);
    expect(pace.measurableFrom).toBe('2026-11-01');
    expect(pace.measurable).toBe(false);
  });

  it('becomes measurable after two full months, with capacity over those two', () => {
    const pace = build(
      [created('2026-08-01', 10)],
      [closed('2026-08-10', 4), closed('2026-09-10', 6)],
    );

    expect(pace.measurableFrom).toBe('2026-10-01');
    expect(pace.measurable).toBe(true);
    expect(pace.total.capacityPerMonth).toBe(5);
  });

  it('has no occupancy for a band that never closed anything, and no date while the scope holds no finding', () => {
    const pace = build([], []);

    expect(pace).toMatchObject({ measurableFrom: null, measurable: false });
    expect(pace.bands.map((band) => band.band)).toEqual(['critical', 'high', 'medium', 'low']);
    expect(pace.bands.every((band) => band.occupancy === null && band.openCount === 0)).toBe(true);
  });

  it('counts an unscored finding in the total and in no band', () => {
    const pace = build([{ band: 'unscored', day: '2026-09-01', count: 4, firstDay: '2026-09-01' }], []);

    expect(pace.total.openCount).toBe(4);
    expect(pace.bands.reduce((sum, band) => sum + band.openCount, 0)).toBe(0);
  });

  it('honours Little\'s law in a steady state: open = new per month x mean time open', () => {
    const DAY_MS = 86_400_000;
    const DAYS_OPEN = 30;
    const horizonDay = remediationPaceHorizon(NOW).toISOString().slice(0, 10);
    const bucketOf = (date: Date): string | null => {
      const day = date.toISOString().slice(0, 10);
      return day < horizonDay ? null : day;
    };
    const creations: Array<FindingCreationBucket> = [];
    const transitions: Array<FindingTransitionBucket> = [];
    for (let daysAgo = 0; daysAgo < 400; daysAgo += 1) {
      const createdAt = new Date(NOW.getTime() - daysAgo * DAY_MS);
      creations.push(created(bucketOf(createdAt), 1, '2025-09-05'));
      if (daysAgo >= DAYS_OPEN) {
        transitions.push(closed(bucketOf(new Date(createdAt.getTime() + DAYS_OPEN * DAY_MS)), 1));
      }
    }

    const { total } = build(creations, transitions, { timeOpen: [{ band: null, medianDays: DAYS_OPEN, meanDays: DAYS_OPEN }] });

    expect(total.openCount).toBe(DAYS_OPEN);
    expect(total.newPerMonth * (total.meanDaysOpen! / DAYS_PER_MONTH)).toBeCloseTo(total.openCount);
  });
});
