import { describe, expect, it } from 'vitest';
import { computeUniqueScore } from './unique-score';

describe('computeUniqueScore', () => {
  it('keeps the score of a group holding one finding', () => {
    expect(computeUniqueScore([73])).toBe(73);
  });

  it('lifts n findings sharing a score by ln(n)', () => {
    expect(computeUniqueScore([85, 85])).toBeCloseTo(85 + Math.log(2), 10);
    expect(computeUniqueScore(Array.from({ length: 10 }, () => 60))).toBeCloseTo(60 + Math.log(10), 10);
    expect(computeUniqueScore(Array.from({ length: 1000 }, () => 85))).toBeCloseTo(85 + Math.log(1000), 10);
  });

  it('counts a finding one point under the worst for exp(-1) of one at the worst', () => {
    expect(computeUniqueScore([80, 79])).toBeCloseTo(80 + Math.log(1 + Math.exp(-1)), 10);
  });

  it('weighs mixed scores by their distance to the worst', () => {
    const scores = [88, ...Array.from({ length: 11 }, () => 88), ...Array.from({ length: 40 }, () => 84)];
    const expected = 88 + Math.log(12 + 40 * Math.exp(-4));

    expect(computeUniqueScore(scores)).toBeCloseTo(expected, 10);
  });

  it('lets no mass of low findings outweigh a severe one by much', () => {
    const scores = [90, ...Array.from({ length: 10_000 }, () => 40)];

    expect(computeUniqueScore(scores)).toBeLessThan(90.001);
  });

  it('never falls below the worst finding', () => {
    expect(computeUniqueScore([12, 95, 3, 70])).toBeGreaterThanOrEqual(95);
  });

  it('caps the score at 100', () => {
    expect(computeUniqueScore(Array.from({ length: 1000 }, () => 97))).toBe(100);
    expect(computeUniqueScore([100, 100])).toBe(100);
  });

  it('gives no score to a group with no scored finding', () => {
    expect(computeUniqueScore([])).toBeNull();
  });

  it('gives the same double whatever order the scores arrive in', () => {
    // Summed as given, these scores reversed differ in the last bit.
    const scores = Array.from({ length: 11 }, (_, index) => 60 + index / 3);

    expect(computeUniqueScore(scores.toReversed())).toBe(computeUniqueScore(scores));
  });
});
