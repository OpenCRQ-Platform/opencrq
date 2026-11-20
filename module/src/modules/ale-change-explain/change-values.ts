import { printedDollars, roundPercentPoints, roundToDecimals } from '@app/utils';
import type { ChangeDirection, ChangeEvent, ChangeItem, ChangeValueFormat } from './types';

/**
 * Two runs never draw the same worlds, so a Monte Carlo figure moves a little on every run: a
 * difference counts only once it shows at the precision the page prints.
 */
const PRINTED: Record<Exclude<ChangeValueFormat, 'currency' | 'text'>, (value: number) => number> = {
  frequency: (value) => roundToDecimals(value, 2),
  share: (value) => roundPercentPoints(value, 1),
  count: (value) => roundToDecimals(value, 0),
};

export const valuesDiffer = (format: ChangeValueFormat, before: number | string | null, after: number | string | null): boolean => {
  if (before === null || after === null || typeof before === 'string' || typeof after === 'string') {
    return before !== after;
  }
  if (format === 'text') {
    return before !== after;
  }
  if (format === 'currency') {
    return printedDollars(before).amount !== printedDollars(after).amount;
  }
  const printed = PRINTED[format];
  return printed(before) !== printed(after);
};

/**
 * `rise` says what a higher value does to the loss side; an appearing or vanishing value takes the
 * direction of the side it moved towards.
 */
export const directionOf = (
  rise: ChangeDirection,
  before: number | string | null,
  after: number | string | null,
): ChangeDirection => {
  if (rise === 'none' || typeof before === 'string' || typeof after === 'string') {
    return 'none';
  }
  const higher = (after ?? 0) > (before ?? 0);
  if (rise === 'up') {
    return higher ? 'up' : 'down';
  }
  return higher ? 'down' : 'up';
};

/** Eight significant digits: far past what any figure prints, and what keeps the run curve small on the wire. */
const FIGURE_DIGITS = 8;

/** A figure the curve and the change list both print is read through this, so the two never print it apart. */
export const roundFigure = (value: number): number => Number(value.toPrecision(FIGURE_DIGITS));

export const engineDifference = (params: {
  category: ChangeEvent['category'],
  item: ChangeItem,
  format: ChangeValueFormat,
  rise: ChangeDirection,
  before: number | string | null,
  afterValue: number | string | null,
}): ChangeEvent | null => {
  if (!valuesDiffer(params.format, params.before, params.afterValue)) {
    return null;
  }
  return {
    category: params.category,
    moment: { kind: 'balance' },
    direction: directionOf(params.rise, params.before, params.afterValue),
    item: params.item,
    sentence: { key: 'value-changed', parts: {} },
    values: { format: params.format, before: params.before, after: params.afterValue },
  };
};
