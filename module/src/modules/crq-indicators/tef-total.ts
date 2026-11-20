import { compareCodePoints } from '@app/utils';

export interface TefRange {
  low: number,
  likely: number,
  high: number,
}

/** An outcome's range, under the key that orders the sum. */
export interface KeyedTefRange extends TefRange {
  readonly key: string,
}

/**
 * The attempts per year over several outcomes, each range a PERT (min, mode, max): the sum of their
 * minimums, of their modes and of their maximums. The bounds are the sum's own, and a PERT's mean is
 * linear in its three points, so the total's mean is the sum of the outcomes' means.
 */
export const totalOfRanges = (ranges: ReadonlyArray<KeyedTefRange>): TefRange => {
  // Floating-point addition is not associative: a fixed order keeps the total bit for bit.
  const sorted = ranges.toSorted((a, b) => compareCodePoints(a.key, b.key));
  const sum = (point: (range: TefRange) => number): number => sorted.reduce((total, range) => total + point(range), 0);
  return { low: sum((range) => range.low), likely: sum((range) => range.likely), high: sum((range) => range.high) };
};
