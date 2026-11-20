import { describe, expect, it } from 'vitest';
import { resolvePostureScore } from './posture-score-utils';

describe('resolvePostureScore', () => {
  it('should report unmeasured when there are no counters at all', () => {
    expect(resolvePostureScore(null)).toEqual({ state: 'unmeasured' });
  });

  it('should report no-data when measured but nothing was validated yet', () => {
    expect(resolvePostureScore({ success: 0, failed: 0 })).toEqual({ state: 'no-data' });
  });

  it('should compute a rounded percentage score', () => {
    expect(resolvePostureScore({ success: 3, failed: 1 })).toEqual({ state: 'scored', score: 75, band: 'strong' });
    expect(resolvePostureScore({ success: 1, failed: 2 })).toEqual({ state: 'scored', score: 33, band: 'weak' });
  });

  it.each([
    [100, 'strong'],
    [75, 'strong'],
    [74, 'moderate'],
    [50, 'moderate'],
    [49, 'weak'],
    [25, 'weak'],
    [24, 'critical'],
    [0, 'critical'],
  ])('should band a %i%% score as %s', (successRatioPercent, expectedBand) => {
    const result = resolvePostureScore({ success: successRatioPercent, failed: 100 - successRatioPercent });
    expect(result).toMatchObject({ band: expectedBand });
  });
});
