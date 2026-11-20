import { i18n } from '@lingui/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatCompactCount, formatDollar, formatDollarChange } from './format-currency';

const NBSP = ' ';

beforeEach(() => {
  i18n.load({ en: {}, fr: {}, ja: {}, de: {} });
  i18n.activate('en');
});

afterEach(() => {
  i18n.activate('en');
});

describe('formatDollar', () => {
  it('should format billions', () => {
    expect(formatDollar(1_000_000_000)).toBe('$1.0B');
    expect(formatDollar(2_500_000_000)).toBe('$2.5B');
  });

  it('should format millions', () => {
    expect(formatDollar(1_000_000)).toBe('$1.0M');
    expect(formatDollar(12_300_000)).toBe('$12.3M');
  });

  it('should format thousands', () => {
    expect(formatDollar(1_000)).toBe('$1K');
    expect(formatDollar(450_000)).toBe('$450K');
  });

  it('should format small values', () => {
    expect(formatDollar(0)).toBe('$0');
    expect(formatDollar(999)).toBe('$999');
    expect(formatDollar(42.7)).toBe('$43');
  });

  it('should print an amount that rounds to a thousand as 1K, never with a grouping separator', () => {
    expect(formatDollar(999.4)).toBe('$999');
    expect(formatDollar(999.5)).toBe('$1K');
    expect(formatDollar(999.99)).toBe('$1K');
  });

  it('should handle boundary values', () => {
    expect(formatDollar(999_499)).toBe('$999K');
    expect(formatDollar(999_999)).toBe('$1.0M');
    expect(formatDollar(999_949_999)).toBe('$999.9M');
    expect(formatDollar(999_999_999)).toBe('$1.0B');
    expect(formatDollar(999_949_999_999)).toBe('$999.9B');
    expect(formatDollar(999_950_000_000)).toBe('$1.0T');
  });

  it('should print two amounts the same exactly when their rounding is the same, past a trillion too', () => {
    expect(formatDollar(1_010_000_000_000)).toBe(formatDollar(1_000_000_000_000));
    expect(formatDollar(1_060_000_000_000)).toBe('$1.1T');
  });

  it('should print a negative amount compact, with the minus sign U+2212 before the dollar sign', () => {
    expect(formatDollar(-22_668_403)).toBe('−$22.7M');
    expect(formatDollar(-2_500_000_000)).toBe('−$2.5B');
    expect(formatDollar(-450_000)).toBe('−$450K');
    expect(formatDollar(-42.7)).toBe('−$43');
    expect(formatDollar(-999.6)).toBe('−$1K');
  });

  it('should leave unsigned a negative amount that rounds to zero', () => {
    expect(formatDollar(-0.4)).toBe('$0');
    expect(formatDollar(-0)).toBe('$0');
  });

  it('should return dash for null', () => {
    expect(formatDollar(null)).toBe('-');
  });

  it('should write the decimal separator, the unit and the dollar sign as the application language does', () => {
    i18n.activate('fr');
    expect(formatDollar(2_500_000_000)).toBe(`2,5${NBSP}Md${NBSP}$`);
    expect(formatDollar(-22_668_403)).toBe(`−22,7${NBSP}M${NBSP}$`);
    expect(formatDollar(450_000)).toBe(`450${NBSP}k${NBSP}$`);
    expect(formatDollar(999)).toBe(`999${NBSP}$`);
  });

  it('should print the rounded amount in full in a language whose compact notation does not step by a thousand', () => {
    i18n.activate('ja');
    expect(formatDollar(12_000)).toBe('$12,000');
    expect(formatDollar(2_340_000)).toBe('$2,300,000');
    expect(formatDollar(-2_340_000)).toBe('−$2,300,000');
    expect(formatDollar(1_240_000_000_000)).toBe('$1.2兆');
    i18n.activate('de');
    expect(formatDollar(450_400)).toBe(`450.000${NBSP}$`);
    expect(formatDollar(2_340_000)).toBe(`2,3${NBSP}Mio.${NBSP}$`);
  });
});

describe('formatCompactCount', () => {
  it('should return dash for null', () => {
    expect(formatCompactCount(null)).toBe('-');
  });

  it('should format millions at no more than one decimal', () => {
    expect(formatCompactCount(1_000_000)).toBe('1M');
    expect(formatCompactCount(2_500_000)).toBe('2.5M');
    expect(formatCompactCount(1_234_567)).toBe('1.2M');
  });

  it('should format thousands at no more than one decimal', () => {
    expect(formatCompactCount(1_000)).toBe('1K');
    expect(formatCompactCount(15_300)).toBe('15.3K');
    expect(formatCompactCount(50_000)).toBe('50K');
  });

  it('should format small values', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(42)).toBe('42');
    expect(formatCompactCount(999)).toBe('999');
  });

  it('should write the decimal separator and the unit as the application language does', () => {
    i18n.activate('fr');
    expect(formatCompactCount(1_500)).toBe(`1,5${NBSP}k`);
    expect(formatCompactCount(2_300_000)).toBe(`2,3${NBSP}M`);
  });
});

describe('formatDollarChange', () => {
  it('should sign an increase', () => {
    expect(formatDollarChange(150_000)).toBe('+$150K');
  });

  it('should sign a decrease with the minus sign U+2212', () => {
    expect(formatDollarChange(-216_000)).toBe('−$216K');
  });

  it('should leave zero unsigned', () => {
    expect(formatDollarChange(0)).toBe('$0');
  });

  it('should leave unsigned a change that rounds to zero', () => {
    expect(formatDollarChange(0.3)).toBe('$0');
    expect(formatDollarChange(-0.4)).toBe('$0');
  });

  it('should format a large amount', () => {
    expect(formatDollarChange(2_500_000_000)).toBe('+$2.5B');
  });

  it('should sign a fall in the same compact unit as the amount it prints', () => {
    expect(formatDollarChange(-22_668_403)).toBe('−$22.7M');
  });

  it('should sign a change in the application language', () => {
    i18n.activate('fr');
    expect(formatDollarChange(-216_000)).toBe(`−216${NBSP}k${NBSP}$`);
  });
});
