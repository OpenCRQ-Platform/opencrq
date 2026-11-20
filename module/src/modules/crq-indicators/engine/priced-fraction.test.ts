import { describe, expect, it } from 'vitest';
import { DETECTED_MAGNITUDE_FACTOR, RESPONSE_COST_FRACTION } from './attack-run-constants';
import { pricedFraction } from './priced-fraction';

describe('pricedFraction', () => {
  it('prices an outcome that only blocks at zero', () => {
    expect(pricedFraction({ evicted: 0, impactDetected: 0, impactUndetected: 0 })).toBe(0);
  });

  it('prices an eviction at the response cost fraction', () => {
    expect(pricedFraction({ evicted: 1, impactDetected: 0, impactUndetected: 0 })).toBe(RESPONSE_COST_FRACTION);
  });

  it('prices a detected impact at the detected magnitude factor', () => {
    expect(pricedFraction({ evicted: 0, impactDetected: 1, impactUndetected: 0 })).toBe(DETECTED_MAGNITUDE_FACTOR);
  });

  it('prices an undetected impact at the whole magnitude', () => {
    expect(pricedFraction({ evicted: 0, impactDetected: 0, impactUndetected: 1 })).toBe(1);
  });

  it('prices a mix of outcomes as their weighted sum', () => {
    const outcomes = { evicted: 0.2, impactDetected: 0.3, impactUndetected: 0.1 };
    const expected = outcomes.evicted * RESPONSE_COST_FRACTION
      + outcomes.impactDetected * DETECTED_MAGNITUDE_FACTOR
      + outcomes.impactUndetected;

    expect(pricedFraction(outcomes)).toBeCloseTo(expected, 12);
  });
});
