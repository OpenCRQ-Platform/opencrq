import { i18n } from '@lingui/core';
import { roundToDecimals } from '@app/utils/decimals';

/** The sign a printed fall carries: the minus the typography draws as wide as the plus. */
export const MINUS_SIGN = '−';

/** A number in full, grouped as the reader's locale groups digits, in the application language unless one is given: "12,345.6", "12 345,6" in French. */
export const formatNumber = (value: number, locale: string = i18n.locale || 'en'): string =>
  new Intl.NumberFormat(locale).format(value);

/** A number at exactly `fractionDigits` decimals, in the reader's locale: "0.37", "0,37" in French. */
export const formatFixed = (value: number, fractionDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

/** A change at exactly `fractionDigits` decimals, in the reader's locale: "+0.12", "−0.12", and "0.00" for one that rounds to zero, which is neither a rise nor a fall. */
export const formatSignedNumber = (value: number, fractionDigits: number): string => {
  const rounded = roundToDecimals(value, fractionDigits);
  if (rounded === 0) {
    return formatFixed(0, fractionDigits);
  }
  return `${rounded > 0 ? '+' : MINUS_SIGN}${formatFixed(Math.abs(rounded), fractionDigits)}`;
};

/**
 * A fraction as a percentage at exactly `fractionDigits` decimals, with the percent sign the
 * reader's locale writes: 0.123 reads "12.3%", "12,3 %" in French. The fraction is scaled in
 * decimal, so 0.145 reads "15%" at no decimal, where `0.145 * 100` is 14.499999999999998.
 */
export const formatFractionAsPercent = (fraction: number, fractionDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(fraction);

/** A fraction as a percentage at no more than `maxFractionDigits` decimals, scaled like `formatFractionAsPercent`: 0.1 reads "10%", 0.023 "2.3%", "2,3 %" in French. */
export const formatFractionAsPercentAtMost = (fraction: number, maxFractionDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(fraction);

/**
 * Percentage points, a figure already on the 0 to 100 scale, at exactly `fractionDigits` decimals,
 * with the percent sign the reader's locale writes: 12.3 reads "12.3%", "12,3 %" in French. A
 * fraction goes to `formatFractionAsPercent` instead, never multiplied by 100 on the way here.
 */
export const formatPointsAsPercent = (percentPoints: number, fractionDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', {
    style: 'unit',
    unit: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(percentPoints);

/** Percentage points at no more than `maxFractionDigits` decimals: 40 reads "40%", 12.5 "12.5%", "12,5 %" in French. */
export const formatPointsAsPercentAtMost = (percentPoints: number, maxFractionDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', {
    style: 'unit',
    unit: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(percentPoints);

/** A number at `significantDigits` significant digits, in the reader's locale: "1.8", "0.93", "1,8" in French. */
export const formatSignificant = (value: number, significantDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', { maximumSignificantDigits: significantDigits }).format(value);

/** A number at exactly `significantDigits` significant digits, trailing zeros kept, as `toPrecision` writes it: "0.60", "9.0", "9,0" in French. */
export const formatPrecision = (value: number, significantDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', { minimumSignificantDigits: significantDigits, maximumSignificantDigits: significantDigits }).format(value);

/** A number at no more than `maxFractionDigits` decimals, in the reader's locale: "7", "12.6", "12,6" in French. */
export const formatAtMost = (value: number, maxFractionDigits: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
