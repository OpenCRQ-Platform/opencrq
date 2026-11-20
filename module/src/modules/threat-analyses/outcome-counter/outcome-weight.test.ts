import { describe, expect, it } from 'vitest';
import { computeRelevance, effectiveOutcomeWeight, outcomeWeight } from './outcome-weight';

describe('outcomeWeight', () => {
  it.each([
    [0, 0],
    [0.3, 0],
    [0.5, 0],
    [0.51, 0.0004],
    [0.7, 0.16],
    [0.9, 0.64],
    [1, 1],
  ])('should map a probability of %s to a weight of %s', (probability, expected) => {
    expect(outcomeWeight(probability)).toBeCloseTo(expected, 10);
  });
});

describe('effectiveOutcomeWeight', () => {
  it('should be 0 when the record lacks minimum evidence, whatever the probability', () => {
    expect(effectiveOutcomeWeight({ probability: 0.99, evidenceSufficient: false })).toBe(0);
  });

  it('should equal the outcome weight when the evidence is sufficient', () => {
    expect(effectiveOutcomeWeight({ probability: 0.9, evidenceSufficient: true })).toBe(outcomeWeight(0.9));
  });
});

describe('computeRelevance', () => {
  it.each([
    [1, true, true, 1],
    [1, true, false, 0.25],
    [1, false, true, 0.4],
    [1, false, false, 0.1],
    [0, true, true, 0],
    [0.64, true, true, 0.64],
  ])('should give %s with country %s and sector %s a relevance of %s', (weight, countryMatch, sectorMatch, expected) => {
    expect(computeRelevance({ weight, countryMatch, sectorMatch })).toBeCloseTo(expected, 10);
  });
});
