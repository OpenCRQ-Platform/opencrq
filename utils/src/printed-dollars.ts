import { roundToDecimals } from './decimals';

const DOLLAR_UNITS = [
  { from: 999_950_000_000, divisor: 1_000_000_000_000, fractionDigits: 1 },
  { from: 999_950_000, divisor: 1_000_000_000, fractionDigits: 1 },
  { from: 999_500, divisor: 1_000_000, fractionDigits: 1 },
  { from: 999.5, divisor: 1_000, fractionDigits: 0 },
] as const;

const ONES = { divisor: 1, fractionDigits: 0 } as const;

/** An amount rounded as the screens print it. */
export interface PrintedDollars {
  /** The amount after rounding, signed, and 0 for one that prints as zero, so it carries no sign. */
  readonly amount: number,
  /** The decimals of the unit it reads in: none in dollars and thousands, one in millions and above. */
  readonly fractionDigits: number,
  /** The unit it reads in: 1 for dollars, then a thousand, a million, a billion, a trillion. */
  readonly divisor: number,
}

/**
 * The compact rounding of an amount, which the front prints and the server compares: 2.0M, 450K,
 * 999. Each threshold sits where rounding would otherwise print `1000K`, `1000.0M` or `1000.0B`, and
 * the units stop at the trillion, where the English and French compact notations stop.
 */
export const printedDollars = (value: number): PrintedDollars => {
  const magnitude = Math.abs(value);
  const unit = DOLLAR_UNITS.find((candidate) => magnitude >= candidate.from) ?? ONES;
  const rounded = roundToDecimals(magnitude / unit.divisor, unit.fractionDigits) * unit.divisor;
  return { amount: value < 0 && rounded !== 0 ? -rounded : rounded, fractionDigits: unit.fractionDigits, divisor: unit.divisor };
};
