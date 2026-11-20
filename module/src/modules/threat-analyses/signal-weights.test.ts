import { describe, expect, it } from 'vitest';
import { combineSignalWeights } from './signal-weights';

describe('combineSignalWeights', () => {
  it('should return 0 for no signals', () => {
    expect(combineSignalWeights([])).toBe(0);
  });

  it('should return the single weight for one signal', () => {
    expect(combineSignalWeights([0.5])).toBeCloseTo(0.5);
  });

  it('should return exactly 1 for a certain signal', () => {
    expect(combineSignalWeights([1])).toBe(1);
    expect(combineSignalWeights([0.2, 1])).toBe(1);
  });

  it('should keep a tiny weight that the literal complement product would round to 0', () => {
    expect(1 - (1 - 1e-18)).toBe(0);
    expect(combineSignalWeights([1e-18])).toBeGreaterThan(0);
  });

  it('should return +0 for zero weights', () => {
    expect(combineSignalWeights([0, 0])).toBe(0);
  });

  it('should increase monotonically but sub-additively with more signals', () => {
    const one = combineSignalWeights([0.4]);
    const two = combineSignalWeights([0.4, 0.4]);
    const three = combineSignalWeights([0.4, 0.4, 0.4]);

    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    expect(two - one).toBeGreaterThan(three - two);
  });

  it('should combine two signals via complementary probability', () => {
    expect(combineSignalWeights([0.4, 0.4])).toBeCloseTo(1 - 0.6 * 0.6);
    expect(combineSignalWeights([0.3, 0.55])).toBeCloseTo(1 - (1 - 0.3) * (1 - 0.55));
  });

  // Uncapped and asymptotic, so it converges to 1 rather than reaching it. Piling on enough strong
  // signals does round to exactly 1 in float64 (0.1^20 underflows the mantissa), which is why the
  // attacker-mixture weight is a normalized share and not this.
  it('should converge towards 1 without exceeding it', () => {
    const weight = combineSignalWeights(Array.from({ length: 12 }, () => 0.5));
    expect(weight).toBeLessThan(1);
    expect(weight).toBeGreaterThan(0.999);
  });
});
