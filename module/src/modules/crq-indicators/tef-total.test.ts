import { describe, expect, it } from 'vitest';
import type { KeyedTefRange, TefRange } from './tef-total';
import { totalOfRanges } from './tef-total';

const FRAUD: KeyedTefRange = { key: 'fraud', low: 0.077, likely: 0.699, high: 7.48 };
const RANGES: Array<KeyedTefRange> = [
  { key: 'ransomware', low: 0.0723, likely: 0.166, high: 0.528 },
  FRAUD,
  { key: 'espionage', low: 0.02, likely: 0.09, high: 0.61 },
  { key: 'disruption', low: 0.005, likely: 0.03, high: 0.2 },
];

const pertMean = (range: TefRange): number => (range.low + 4 * range.likely + range.high) / 6;

describe('the total of several outcomes', () => {
  it('is the sum of their minimums, modes and maximums', () => {
    const total = totalOfRanges(RANGES);
    expect(total.low).toBeCloseTo(0.1743, 12);
    expect(total.likely).toBeCloseTo(0.985, 12);
    expect(total.high).toBeCloseTo(8.818, 12);
  });

  it('keeps the sum of the outcomes\' means', () => {
    const outcomesMean = RANGES.reduce((sum, range) => sum + pertMean(range), 0);
    expect(pertMean(totalOfRanges(RANGES))).toBeCloseTo(outcomesMean, 12);
  });

  it('is the same on every call, whatever the order the outcomes come in', () => {
    expect(totalOfRanges(RANGES.toReversed())).toEqual(totalOfRanges(RANGES));
  });

  it('is the outcome\'s own range when only one outcome has attempts', () => {
    const { key: _, ...range } = FRAUD;
    expect(totalOfRanges([FRAUD, { key: 'none', low: 0, likely: 0, high: 0 }])).toEqual(range);
  });

  it('is zero with no attempts', () => {
    expect(totalOfRanges([])).toEqual({ low: 0, likely: 0, high: 0 });
  });
});
