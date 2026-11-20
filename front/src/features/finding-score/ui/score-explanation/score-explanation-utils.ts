/**
 * Every figure in the explanation is printed at one of three precisions, and never at two.
 *
 * A composed factor carries four decimals because that is what the product needs to be replayable
 * by hand; a weight the engine multiplied carries three, which is all any of them has; a credit
 * share is whole percent, because it is a rank rule and not a measurement.
 */
const FACTOR_DIGITS = 4;
const WEIGHT_DIGITS = 3;

const decimals = (value: number, locale: string, digits: number): string => new Intl.NumberFormat(locale, {
  minimumFractionDigits: 2,
  maximumFractionDigits: digits,
}).format(value);

/**
 * The product of the counted factors.
 *
 * Six decimals because four factors at four decimals each leave the product that small: printing
 * it shorter would stop the line above from multiplying out to the line below.
 */
export const formatProduct = (value: number, locale: string): string => decimals(value, locale, 6);

/**
 * The score before the truncation, which is the only place the fractional part is ever shown.
 *
 * Truncated to its two decimals rather than rounded: rounding prints 44.00 directly above the row
 * that says the score truncates to 43, which reads as an error in the arithmetic.
 */
export const formatBeforeTruncation = (value: number, locale: string): string => decimals(
  Math.trunc(value * 100) / 100,
  locale,
  2,
);

/** A composed factor, on the 0 to 1 scale the engine works in. */
export const formatFactor = (value: number, locale: string): string => decimals(value, locale, FACTOR_DIGITS);

/** A term the engine multiplied: a weight, a floor, a coefficient, a resistance. */
export const formatWeight = (value: number, locale: string): string => decimals(value, locale, WEIGHT_DIGITS);

/** What a control's efficacy was credited at, once its rank applied. */
export const formatCreditShare = (share: number, locale: string): string => new Intl.NumberFormat(locale, {
  style: 'percent',
  maximumFractionDigits: 0,
}).format(share);

/** The figure a panel publishes, which is the factor on the score's own scale. */
export const toFigure = (value: number): number => Math.round(value * 100);

/**
 * The figure the controls panel publishes.
 *
 * It is the complement of what gets through, because a reader shown a low number under a shield
 * reads a defence that holds and the engine means the opposite.
 */
export const toDefenceFigure = (value: number): number => 100 - toFigure(value);
