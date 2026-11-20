import { describe, expect, it } from 'vitest';
import { isReviewPeriodStart, reviewPeriodBounds, reviewPeriodEnd } from './review-period';

const NOW = new Date(Date.UTC(2026, 9, 5, 12));

describe('isReviewPeriodStart', () => {
  it('accepts the first day of the current month and of any earlier month back to January 2000', () => {
    expect(isReviewPeriodStart('2026-10-01', NOW)).toBe(true);
    expect(isReviewPeriodStart('2025-04-01', NOW)).toBe(true);
    expect(isReviewPeriodStart('2000-01-01', NOW)).toBe(true);
  });

  it('refuses a month that has not started, a day other than the first and a year before 2000', () => {
    expect(isReviewPeriodStart('2026-11-01', NOW)).toBe(false);
    expect(isReviewPeriodStart('2027-01-01', NOW)).toBe(false);
    expect(isReviewPeriodStart('2026-04-15', NOW)).toBe(false);
    expect(isReviewPeriodStart('1999-12-01', NOW)).toBe(false);
    expect(isReviewPeriodStart('2026-13-01', NOW)).toBe(false);
    expect(isReviewPeriodStart('2026-4-01', NOW)).toBe(false);
  });

  it('reads the current month in UTC', () => {
    const lateOnSeptemberUtc = new Date(Date.UTC(2026, 8, 30, 23, 30));
    expect(isReviewPeriodStart('2026-10-01', lateOnSeptemberUtc)).toBe(false);
  });
});

describe('reviewPeriodBounds', () => {
  it('spans twelve months from the start, the end exclusive', () => {
    expect(reviewPeriodBounds('2025-04-01')).toEqual({
      start: new Date(Date.UTC(2025, 3, 1)),
      end: new Date(Date.UTC(2026, 3, 1)),
    });
    expect(reviewPeriodBounds('2026-01-01')).toEqual({
      start: new Date(Date.UTC(2026, 0, 1)),
      end: new Date(Date.UTC(2027, 0, 1)),
    });
  });

  it('refuses a start that is not the first day of a month', () => {
    expect(() => reviewPeriodBounds('2025-04-02')).toThrow();
  });
});

describe('reviewPeriodEnd', () => {
  it('is the last day the period covers', () => {
    expect(reviewPeriodEnd('2025-04-01')).toBe('2026-03-31');
    expect(reviewPeriodEnd('2026-01-01')).toBe('2026-12-31');
    expect(reviewPeriodEnd('2023-03-01')).toBe('2024-02-29');
  });
});
