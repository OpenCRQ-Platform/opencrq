import { describe, expect, it } from 'vitest';
import type { FullWalkTimestamps } from './full-walk-utils';
import { isFullWalkDue } from './full-walk-utils';

const now = new Date('2026-10-05T12:00:00.000Z');
const ago = (hours: number): Date => new Date(now.getTime() - hours * 60 * 60 * 1000);

const state = (over: Partial<FullWalkTimestamps>): FullWalkTimestamps => ({
  fullWalkStartedAt: null,
  lastFullWalkCompletedAt: null,
  lastFullWalkAttemptedAt: null,
  ...over,
});

describe('isFullWalkDue', () => {
  it('should be due for a stream with no state', () => {
    expect(isFullWalkDue(null, now)).toBe(true);
  });

  it('should be due when a full walk was never made', () => {
    expect(isFullWalkDue(state({}), now)).toBe(true);
  });

  it('should not be due when the last walk completed 6 days ago', () => {
    expect(isFullWalkDue(state({ lastFullWalkCompletedAt: ago(6 * 24), lastFullWalkAttemptedAt: ago(6 * 24) }), now)).toBe(false);
  });

  it('should be due when the last walk completed 8 days ago', () => {
    expect(isFullWalkDue(state({ lastFullWalkCompletedAt: ago(8 * 24), lastFullWalkAttemptedAt: ago(8 * 24) }), now)).toBe(true);
  });

  it('should not be due exactly 7 days after the last completion', () => {
    expect(isFullWalkDue(state({ lastFullWalkCompletedAt: ago(7 * 24), lastFullWalkAttemptedAt: ago(7 * 24) }), now)).toBe(false);
  });

  it('should not be due when never completed but attempted 2 hours ago', () => {
    expect(isFullWalkDue(state({ lastFullWalkAttemptedAt: ago(2) }), now)).toBe(false);
  });

  it('should be due when never completed and attempted 25 hours ago', () => {
    expect(isFullWalkDue(state({ lastFullWalkAttemptedAt: ago(25) }), now)).toBe(true);
  });

  it('should not be due when the last completion is stale but a retry was attempted 2 hours ago', () => {
    expect(isFullWalkDue(state({ lastFullWalkCompletedAt: ago(8 * 24), lastFullWalkAttemptedAt: ago(2) }), now)).toBe(false);
  });

  it('should be due while a walk is in progress, to resume it', () => {
    expect(isFullWalkDue(state({
      fullWalkStartedAt: ago(1),
      lastFullWalkCompletedAt: ago(24),
      lastFullWalkAttemptedAt: ago(1),
    }), now)).toBe(true);
  });
});
