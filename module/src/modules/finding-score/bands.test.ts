import { describe, expect, it } from 'vitest';
import { POSTURE_BANDS, postureBandForScore, postureBandRange, postureSeverityBand } from './bands';

describe('postureSeverityBand', () => {
  it.each([
    ['strong', 'low'],
    ['moderate', 'medium'],
    ['weak', 'high'],
    ['critical', 'critical'],
  ] as const)('maps posture band %s to severity band %s', (postureBand, severityBand) => {
    expect(postureSeverityBand(postureBand)).toBe(severityBand);
  });
});

describe('postureBandRange', () => {
  it('should cover the whole scale with no gap between bands', () => {
    expect(POSTURE_BANDS.map(postureBandRange)).toEqual([
      '75-100', '50-74', '25-49', '0-24',
    ]);
  });

  it('should agree with the band a score falls in at every cut-off', () => {
    expect([100, 75, 74, 50, 49, 25, 24, 0].map(postureBandForScore)).toEqual([
      'strong', 'strong', 'moderate', 'moderate', 'weak', 'weak', 'critical', 'critical',
    ]);
  });
});
