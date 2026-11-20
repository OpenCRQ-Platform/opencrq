import { describe, expect, it } from 'vitest';
import { deriveRevenueBand, REVENUE_BAND_VALUES, revenueBandMidpoint } from './constants';

describe('REVENUE_BAND_VALUES', () => {
  it('should expose the six bands in ascending order', () => {
    expect(REVENUE_BAND_VALUES).toEqual([
      'under_10m',
      '10m_100m',
      '100m_1b',
      '1b_10b',
      '10b_100b',
      'over_100b',
    ]);
  });
});

describe('deriveRevenueBand', () => {
  it('should map the lower bound of each band to that band', () => {
    expect(deriveRevenueBand(0)).toBe('under_10m');
    expect(deriveRevenueBand(10_000_000)).toBe('10m_100m');
    expect(deriveRevenueBand(100_000_000)).toBe('100m_1b');
    expect(deriveRevenueBand(1_000_000_000)).toBe('1b_10b');
    expect(deriveRevenueBand(10_000_000_000)).toBe('10b_100b');
    expect(deriveRevenueBand(100_000_000_000)).toBe('over_100b');
  });

  it('should exclude the upper bound of each band', () => {
    expect(deriveRevenueBand(9_999_999)).toBe('under_10m');
    expect(deriveRevenueBand(99_999_999)).toBe('10m_100m');
    expect(deriveRevenueBand(999_999_999)).toBe('100m_1b');
    expect(deriveRevenueBand(9_999_999_999)).toBe('1b_10b');
    expect(deriveRevenueBand(99_999_999_999)).toBe('10b_100b');
  });

  it('should map values inside each band', () => {
    expect(deriveRevenueBand(1)).toBe('under_10m');
    expect(deriveRevenueBand(45_000_000)).toBe('10m_100m');
    expect(deriveRevenueBand(950_000_000)).toBe('100m_1b');
    expect(deriveRevenueBand(8_500_000_000)).toBe('1b_10b');
    expect(deriveRevenueBand(42_000_000_000)).toBe('10b_100b');
    expect(deriveRevenueBand(500_000_000_000)).toBe('over_100b');
  });
});

describe('revenueBandMidpoint', () => {
  it('should sit inside the band it represents', () => {
    for (const band of REVENUE_BAND_VALUES) {
      expect(deriveRevenueBand(revenueBandMidpoint(band))).toBe(band);
    }
  });
});
