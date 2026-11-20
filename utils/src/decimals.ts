const DECIMAL_FORMATS = new Map<number, Intl.NumberFormat>();

const PERCENT_POINTS = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 20, useGrouping: false });

/**
 * `value` rounded to `fractionDigits` decimals the way `Intl.NumberFormat` prints it, from the
 * number's shortest decimal form: 1.005 gives 1.01, where `toFixed` reads the binary value and gives
 * 1.00. A figure compared or subtracted after this rounding agrees with the one printed.
 */
export const roundToDecimals = (value: number, fractionDigits: number): number => {
  let format = DECIMAL_FORMATS.get(fractionDigits);
  if (format === undefined) {
    format = new Intl.NumberFormat('en', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits, useGrouping: false });
    DECIMAL_FORMATS.set(fractionDigits, format);
  }
  return Number(format.format(value));
};

/**
 * A fraction as percentage points, scaled in decimal as the percent style scales it: 0.0185 gives
 * 1.85, where `0.0185 * 100` is 1.8499999999999999 and prints 1.8 at one decimal.
 */
export const toPercentPoints = (fraction: number): number => Number(PERCENT_POINTS.format(fraction).slice(0, -1));

/** A fraction as percentage points rounded to `fractionDigits` decimals, as the percent style prints it: 0.145 gives 15. */
export const roundPercentPoints = (fraction: number, fractionDigits: number): number =>
  roundToDecimals(toPercentPoints(fraction), fractionDigits);
