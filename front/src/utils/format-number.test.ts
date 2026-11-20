import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatAtMost,
  formatFixed,
  formatFractionAsPercent,
  formatFractionAsPercentAtMost,
  formatNumber,
  formatPointsAsPercent,
  formatPointsAsPercentAtMost,
  formatPrecision,
  formatSignedNumber,
  formatSignificant,
} from './format-number';

describe('formatNumber', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('keeps every digit, grouped as the locale groups them', () => {
    expect(formatNumber(12_345, 'en')).toBe('12,345');
  });

  it('should follow the application language when no locale is given', () => {
    i18n.load({ en: {}, fr: {} });
    i18n.activate('en');
    expect(formatNumber(1_234_567.5)).toBe('1,234,567.5');
    i18n.activate('fr');
    expect(formatNumber(1_234_567.5)).toBe('1 234 567,5');
  });
});

describe('formatFractionAsPercent', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should pad to the fraction digits given, with the percent sign attached', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatFractionAsPercent(0.976, 2)).toBe('97.60%');
    expect(formatFractionAsPercent(0.12, 1)).toBe('12.0%');
  });

  it('should round an exact half up, which the fraction multiplied by 100 would not', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatFractionAsPercent(0.145, 0)).toBe('15%');
    expect(formatFractionAsPercent(0.1455, 1)).toBe('14.6%');
  });

  it('should write the decimal separator and the percent spacing of the application language', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatFractionAsPercent(0.976, 2)).toBe('97,60 %');
  });
});

describe('formatFractionAsPercentAtMost', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should keep the decimals a percentage has, up to the limit given, with the percent sign attached', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatFractionAsPercentAtMost(0.1, 1)).toBe('10%');
    expect(formatFractionAsPercentAtMost(0.0234, 1)).toBe('2.3%');
    expect(formatFractionAsPercentAtMost(0.0000015, 6)).toBe('0.00015%');
  });

  it('should write the decimal separator and the percent spacing of the application language', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatFractionAsPercentAtMost(0.023, 1)).toBe('2,3 %');
  });
});

describe('formatPointsAsPercent', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should print percentage points as they are, padded to the fraction digits given', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatPointsAsPercent(97.6, 2)).toBe('97.60%');
    expect(formatPointsAsPercent(12, 1)).toBe('12.0%');
  });

  it('should write the decimal separator and the percent spacing of the application language', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatPointsAsPercent(97.6, 2)).toBe('97,60 %');
  });
});

describe('formatPointsAsPercentAtMost', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should keep the decimals percentage points have, up to the limit given', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatPointsAsPercentAtMost(40, 3)).toBe('40%');
    expect(formatPointsAsPercentAtMost(12.5, 3)).toBe('12.5%');
  });

  it('should write the decimal separator and the percent spacing of the application language', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatPointsAsPercentAtMost(12.5, 3)).toBe('12,5 %');
  });
});

describe('formatSignificant', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should round to the significant digits given, without trailing zeros', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatSignificant(1.8123, 2)).toBe('1.8');
    expect(formatSignificant(0.934, 2)).toBe('0.93');
    expect(formatSignificant(1, 2)).toBe('1');
  });

  it('should use the decimal separator of the active locale', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatSignificant(0.55, 2)).toBe('0,55');
  });
});

describe('formatPrecision', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should keep the trailing zeros the significant digits given call for', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatPrecision(0.6, 2)).toBe('0.60');
    expect(formatPrecision(9, 2)).toBe('9.0');
    expect(formatPrecision(0.934, 2)).toBe('0.93');
    expect(formatPrecision(1234, 2)).toBe('1,200');
  });

  it('should use the decimal separator of the active locale', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatPrecision(2.6, 2)).toBe('2,6');
    expect(formatPrecision(0.6, 2)).toBe('0,60');
  });
});

describe('formatFixed', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should pad to the fraction digits given', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatFixed(0.2, 2)).toBe('0.20');
    expect(formatFixed(22.44, 1)).toBe('22.4');
  });

  it('should use the decimal separator of the active locale', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatFixed(0.37, 2)).toBe('0,37');
  });
});

describe('formatSignedNumber', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should sign a rise with a plus and a fall with the minus sign U+2212', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatSignedNumber(0.12, 2)).toBe('+0.12');
    expect(formatSignedNumber(0.2, 2)).toBe('+0.20');
    expect(formatSignedNumber(-0.12, 2)).toBe('−0.12');
    expect(formatSignedNumber(-7, 0)).toBe('−7');
  });

  it('should leave unsigned a change that rounds to zero, at the fraction digits given', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatSignedNumber(0, 0)).toBe('0');
    expect(formatSignedNumber(0, 2)).toBe('0.00');
    expect(formatSignedNumber(0.004, 2)).toBe('0.00');
    expect(formatSignedNumber(-0.004, 2)).toBe('0.00');
    expect(formatSignedNumber(-0.04, 1)).toBe('0.0');
  });

  it('should use the decimal separator of the active locale', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatSignedNumber(0.37, 2)).toBe('+0,37');
    expect(formatSignedNumber(-0.37, 2)).toBe('−0,37');
  });
});

describe('formatAtMost', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('should keep the decimals a number has, up to the limit given', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(formatAtMost(7, 1)).toBe('7');
    expect(formatAtMost(12.6, 1)).toBe('12.6');
    expect(formatAtMost(12.34, 1)).toBe('12.3');
  });

  it('should use the decimal separator of the active locale', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatAtMost(12.6, 1)).toBe('12,6');
  });
});
