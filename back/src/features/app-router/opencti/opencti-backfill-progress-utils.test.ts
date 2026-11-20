import { describe, expect, it } from 'vitest';
import { computeTimelineProgressPercent } from './opencti-backfill-progress-utils';

describe('computeTimelineProgressPercent', () => {
  const backfillTargetAt = new Date('2026-07-30T12:00:00.000Z');

  it('is null when historyStartAt is not known yet', () => {
    expect(computeTimelineProgressPercent({ historyStartAt: null, backfillTargetAt, currentEventAt: new Date('2025-01-01T00:00:00.000Z') })).toBeNull();
  });

  it('is null when backfillTargetAt is not known yet', () => {
    expect(computeTimelineProgressPercent({ historyStartAt: new Date('2025-01-01T00:00:00.000Z'), backfillTargetAt: null, currentEventAt: new Date('2025-01-01T00:00:00.000Z') })).toBeNull();
  });

  it('is null when no event has been persisted yet', () => {
    expect(computeTimelineProgressPercent({ historyStartAt: new Date('2025-01-01T00:00:00.000Z'), backfillTargetAt, currentEventAt: null })).toBeNull();
  });

  it('is roughly 50 halfway between historyStartAt and backfillTargetAt', () => {
    const historyStartAt = new Date('2026-01-01T00:00:00.000Z');
    const currentEventAt = new Date('2026-04-16T00:00:00.000Z');
    const percent = computeTimelineProgressPercent({ historyStartAt, backfillTargetAt, currentEventAt });
    expect(percent).toBeGreaterThan(45);
    expect(percent).toBeLessThan(55);
  });

  it('is 100 once currentEventAt reaches backfillTargetAt', () => {
    const historyStartAt = new Date('2026-01-01T00:00:00.000Z');
    expect(computeTimelineProgressPercent({ historyStartAt, backfillTargetAt, currentEventAt: backfillTargetAt })).toBe(100);
  });

  it('never regresses when called again later, unlike a "now"-based denominator would', () => {
    const historyStartAt = new Date('2026-01-01T00:00:00.000Z');
    const currentEventAt = new Date('2026-04-16T00:00:00.000Z');
    const first = computeTimelineProgressPercent({ historyStartAt, backfillTargetAt, currentEventAt });
    const second = computeTimelineProgressPercent({ historyStartAt, backfillTargetAt, currentEventAt });
    expect(second).toBe(first);
  });

  it('clamps to 0 if currentEventAt is somehow before historyStartAt', () => {
    const historyStartAt = new Date('2026-07-01T00:00:00.000Z');
    const currentEventAt = new Date('2026-06-01T00:00:00.000Z');
    expect(computeTimelineProgressPercent({ historyStartAt, backfillTargetAt, currentEventAt })).toBe(0);
  });
});
