import { describe, expect, it } from 'vitest';
import { FINDING_TREND_WINDOW_DAYS, resolveFindingTrendWindow } from './trend-window';

const NOW = new Date('2026-08-19T10:00:00.000Z');

describe('resolveFindingTrendWindow', () => {
  it('opens the current window one window back', () => {
    expect(resolveFindingTrendWindow(NOW).windowStart.toISOString()).toBe('2026-08-12T10:00:00.000Z');
  });

  it('opens the previous window one window before that', () => {
    expect(resolveFindingTrendWindow(NOW).previousWindowStart.toISOString()).toBe('2026-08-05T10:00:00.000Z');
  });

  it('gives both windows the same length, so the two new-counts compare', () => {
    const { windowStart, previousWindowStart } = resolveFindingTrendWindow(NOW);

    expect(NOW.getTime() - windowStart.getTime()).toBe(windowStart.getTime() - previousWindowStart.getTime());
  });

  it('measures that length in whole days from the instant it is asked at', () => {
    const { windowStart } = resolveFindingTrendWindow(NOW);

    expect(NOW.getTime() - windowStart.getTime()).toBe(FINDING_TREND_WINDOW_DAYS * 86_400_000);
  });
});
