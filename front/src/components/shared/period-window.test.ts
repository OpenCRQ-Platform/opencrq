import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD_WINDOW, PERIOD_WINDOWS, periodWindowDays } from './period-window';

describe('PERIOD_WINDOWS', () => {
  it('should offer 90 days, 6 months and 12 months, defaulting to 90 days', () => {
    expect(PERIOD_WINDOWS).toEqual(['90d', '6m', '12m']);
    expect(DEFAULT_PERIOD_WINDOW).toBe('90d');
  });

  it('should span twelve months in 365 days', () => {
    expect(periodWindowDays('12m')).toBe(365);
  });
});
