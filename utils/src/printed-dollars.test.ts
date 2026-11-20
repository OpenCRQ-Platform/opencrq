import { describe, expect, it } from 'vitest';
import { printedDollars } from './printed-dollars';

describe('printedDollars', () => {
  it('should round an amount in the unit it reads in, at the decimals that unit shows', () => {
    expect(printedDollars(2_000_000_000)).toEqual({ amount: 2_000_000_000, fractionDigits: 1, divisor: 1_000_000_000 });
    expect(printedDollars(2_040_000)).toEqual({ amount: 2_000_000, fractionDigits: 1, divisor: 1_000_000 });
    expect(printedDollars(450_400)).toEqual({ amount: 450_000, fractionDigits: 0, divisor: 1_000 });
    expect(printedDollars(42.7)).toEqual({ amount: 43, fractionDigits: 0, divisor: 1 });
  });

  it('should round a negative amount in the same unit', () => {
    expect(printedDollars(-22_668_403).amount).toBeCloseTo(-22_700_000);
    expect(printedDollars(-450_000)).toEqual({ amount: -450_000, fractionDigits: 0, divisor: 1_000 });
    expect(printedDollars(-999)).toEqual({ amount: -999, fractionDigits: 0, divisor: 1 });
  });

  it('should move up a unit at the same thresholds on either side of zero', () => {
    expect(printedDollars(999_499)).toEqual({ amount: 999_000, fractionDigits: 0, divisor: 1_000 });
    expect(printedDollars(-999_499)).toEqual({ amount: -999_000, fractionDigits: 0, divisor: 1_000 });
    expect(printedDollars(999_500)).toEqual({ amount: 1_000_000, fractionDigits: 1, divisor: 1_000_000 });
    expect(printedDollars(-999_500)).toEqual({ amount: -1_000_000, fractionDigits: 1, divisor: 1_000_000 });
    expect(printedDollars(999_949_999)).toEqual({ amount: 999_900_000, fractionDigits: 1, divisor: 1_000_000 });
    expect(printedDollars(999_950_000)).toEqual({ amount: 1_000_000_000, fractionDigits: 1, divisor: 1_000_000_000 });
    expect(printedDollars(999_949_999_999)).toEqual({ amount: 999_900_000_000, fractionDigits: 1, divisor: 1_000_000_000 });
    expect(printedDollars(999_950_000_000)).toEqual({ amount: 1_000_000_000_000, fractionDigits: 1, divisor: 1_000_000_000_000 });
    expect(printedDollars(1_010_000_000_000)).toEqual({ amount: 1_000_000_000_000, fractionDigits: 1, divisor: 1_000_000_000_000 });
    expect(printedDollars(-999.6)).toEqual({ amount: -1_000, fractionDigits: 0, divisor: 1_000 });
  });

  it('should round an exact half up, as the screens print it', () => {
    expect(printedDollars(1_150_000).amount).toBe(1_200_000);
  });

  it('should leave unsigned an amount that prints as zero', () => {
    expect(Object.is(printedDollars(-0).amount, 0)).toBe(true);
    expect(Object.is(printedDollars(-0.4).amount, 0)).toBe(true);
  });
});
