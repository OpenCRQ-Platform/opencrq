import { describe, expect, it } from 'vitest';
import { formatPosturePoints } from './crq-posture-utils';

describe('formatPosturePoints', () => {
  it('prints a whole exploitability without decimals', () => {
    expect(formatPosturePoints(68, 'fr')).toBe('68');
  });

  it('keeps the three decimals of a per-finding increment', () => {
    expect(formatPosturePoints(0.005, 'fr')).toBe('0,005');
  });

  it('hides the floating residue of a sum of increments', () => {
    expect(formatPosturePoints(0.07 + 0.005, 'en')).toBe('0.075');
  });
});
