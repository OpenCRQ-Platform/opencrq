import { describe, expect, it } from 'vitest';
import type { DimensionClaimEvidence } from './relevance-proof';
import { compareClaimsByStrength, explainRelevance } from './relevance-proof';

const claim = (overrides: Partial<DimensionClaimEvidence> & { stixRelationId: string }): DimensionClaimEvidence => ({
  name: 'France',
  producerStixId: null,
  producerName: null,
  isInferred: false,
  relConfidence: null,
  relCreated: null,
  relStartTime: null,
  relStopTime: null,
  relModified: null,
  openctiStixRelationId: null,
  ...overrides,
});

describe('compareClaimsByStrength', () => {
  const ordered = (claims: Array<DimensionClaimEvidence>): Array<string> =>
    [...claims].sort(compareClaimsByStrength).map((entry) => entry.stixRelationId);

  it('should order a stated confidence descending', () => {
    expect(ordered([
      claim({ stixRelationId: 'low', relConfidence: 30 }),
      claim({ stixRelationId: 'high', relConfidence: 90 }),
    ])).toEqual(['high', 'low']);
  });

  it('should put a stated confidence ahead of an unstated one read at the same value', () => {
    expect(ordered([
      claim({ stixRelationId: 'unstated', relConfidence: null }),
      claim({ stixRelationId: 'stated', relConfidence: 60 }),
    ])).toEqual(['stated', 'unstated']);
  });

  it('should break a tie on the producer entry date, most recent first', () => {
    expect(ordered([
      claim({ stixRelationId: 'older', relConfidence: 60, relCreated: new Date('2024-01-01') }),
      claim({ stixRelationId: 'newer', relConfidence: 60, relCreated: new Date('2025-01-01') }),
    ])).toEqual(['newer', 'older']);
  });
});

describe('explainRelevance', () => {
  const base = {
    probability: 0.9,
    evidenceSufficient: true,
    countryMatch: false,
    sectorMatch: false,
    countryClaims: [],
    sectorClaims: [],
  };

  it('should score the model weight scaled by the targeting factors over their maximum', () => {
    // weight at 0.9 is 0.64
    expect(explainRelevance({ ...base, countryMatch: true, sectorMatch: true }).score).toBeCloseTo(0.64, 10);
    expect(explainRelevance({ ...base, countryMatch: true }).score).toBeCloseTo(0.16, 10);
    expect(explainRelevance({ ...base, sectorMatch: true }).score).toBeCloseTo(0.256, 10);
    expect(explainRelevance(base).score).toBeCloseTo(0.064, 10);
  });

  it('should score zero when the percentage does not exceed the threshold', () => {
    expect(explainRelevance({ ...base, probability: 0.5, countryMatch: true, sectorMatch: true }).score).toBe(0);
  });

  it('should score zero on insufficient evidence, however high the percentage', () => {
    expect(explainRelevance({ ...base, probability: 0.99, evidenceSufficient: false, countryMatch: true, sectorMatch: true }).score).toBe(0);
  });

  it('should score zero when the threat has no stored percentage', () => {
    expect(explainRelevance({ ...base, probability: null, countryMatch: true, sectorMatch: true }).score).toBe(0);
  });

  it('should name the matched value only for a matched dimension and order its claims by strength', () => {
    const explanation = explainRelevance({
      ...base,
      countryMatch: true,
      countryName: 'France',
      sectorName: 'Finance',
      countryClaims: [
        claim({ stixRelationId: 'low', relConfidence: 30 }),
        claim({ stixRelationId: 'high', relConfidence: 90 }),
      ],
    });

    expect(explanation.country.matched).toBe(true);
    expect(explanation.country.matchedValue).toBe('France');
    expect(explanation.country.claims.map((entry) => entry.stixRelationId)).toEqual(['high', 'low']);
    expect(explanation.country.organizationValue).toBe('France');
    expect(explanation.sector).toEqual({ matched: false, matchedValue: null, organizationValue: 'Finance', claims: [] });
  });
});
