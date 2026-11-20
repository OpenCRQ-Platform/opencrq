import { describe, expect, it } from 'vitest';
import {
  breakRelevanceDown,
  composeThreatScore,
  DEFAULT_CLAIM_PAGE_SIZE,
  resolveClaimPage,
  resolveLimitingThreatScoreFactor,
  resolveRelevanceBand,
  threatScoreSortKey,
  toRelevancePercent,
  weighsOnOutcome,
} from './relevance-proof-utils';

describe('resolveClaimPage', () => {
  it('should offer no paging control for a list that fits the default page', () => {
    const page = resolveClaimPage(DEFAULT_CLAIM_PAGE_SIZE, DEFAULT_CLAIM_PAGE_SIZE, 0);
    expect(page).toMatchObject({ hasControl: false, pageCount: 1, from: 1, to: 10, total: 10 });
  });

  it('should offer the control as soon as the list outgrows the default page', () => {
    expect(resolveClaimPage(11, DEFAULT_CLAIM_PAGE_SIZE, 0).hasControl).toBe(true);
  });

  it('should describe the window of the requested page', () => {
    expect(resolveClaimPage(23, 10, 1)).toMatchObject({ pageIndex: 1, pageCount: 3, from: 11, to: 20 });
    expect(resolveClaimPage(23, 10, 2)).toMatchObject({ pageIndex: 2, pageCount: 3, from: 21, to: 23 });
  });

  it('should clamp a page index that no longer exists back onto the last page', () => {
    expect(resolveClaimPage(23, 10, 9)).toMatchObject({ pageIndex: 2, from: 21, to: 23 });
    expect(resolveClaimPage(23, 50, 1)).toMatchObject({ pageIndex: 0, from: 1, to: 23 });
  });

  it('should describe an empty list without printing a first item', () => {
    expect(resolveClaimPage(0, 10, 0)).toMatchObject({ pageIndex: 0, pageCount: 1, from: 0, to: 0, total: 0, hasControl: false });
  });

  it('should keep the control reachable on a short list once the persisted page size has grown', () => {
    expect(resolveClaimPage(8, 50, 0).hasControl).toBe(true);
  });
});

describe('composeThreatScore', () => {
  it('should combine relevance and activity into a single whole-percent figure', () => {
    expect(composeThreatScore(0.72, 0.81)).toBe(58);
    expect(composeThreatScore(0.78, 0.84)).toBe(66);
    expect(composeThreatScore(0.47, 0.68)).toBe(32);
  });

  it('should collapse to zero as soon as one of the two is zero', () => {
    expect(composeThreatScore(0, 0.9)).toBe(0);
    expect(composeThreatScore(0.9, 0)).toBe(0);
  });
});

describe('threatScoreSortKey', () => {
  it('should keep the product of the two factors unrounded', () => {
    expect(threatScoreSortKey(0.5, 0.4)).toBeCloseTo(0.2, 10);
  });

  it('should order two threats showing the same score by their product', () => {
    const lower = { relevance: 0.6, activity: 0.5 };
    const higher = { relevance: 0.604, activity: 0.5 };
    expect(composeThreatScore(lower.relevance, lower.activity)).toBe(composeThreatScore(higher.relevance, higher.activity));
    expect(threatScoreSortKey(higher.relevance, higher.activity)).toBeGreaterThan(threatScoreSortKey(lower.relevance, lower.activity));
  });

  it('should tell apart two threats that both round to zero', () => {
    const undatedWeight = 0.021;
    expect(composeThreatScore(0.1, undatedWeight)).toBe(0);
    expect(composeThreatScore(0.2, undatedWeight)).toBe(0);
    expect(threatScoreSortKey(0.2, undatedWeight)).toBeGreaterThan(threatScoreSortKey(0.1, undatedWeight));
    expect(threatScoreSortKey(0.1, undatedWeight)).toBeGreaterThan(0);
  });
});

describe('resolveLimitingThreatScoreFactor', () => {
  it('should name the lower of the two factors', () => {
    expect(resolveLimitingThreatScoreFactor(0.4, 0.9)).toBe('relevance');
    expect(resolveLimitingThreatScoreFactor(0.9, 0.4)).toBe('activity');
  });

  it('should name relevance on a tie', () => {
    expect(resolveLimitingThreatScoreFactor(0.5, 0.5)).toBe('relevance');
  });
});

describe('weighsOnOutcome', () => {
  it('should weigh above the threshold and not at it', () => {
    expect(weighsOnOutcome({ probability: 0.51, evidenceSufficient: true })).toBe(true);
    expect(weighsOnOutcome({ probability: 0.5, evidenceSufficient: true })).toBe(false);
    expect(weighsOnOutcome({ probability: 0.2, evidenceSufficient: true })).toBe(false);
  });

  it('should not weigh on insufficient evidence, whatever the percentage', () => {
    expect(weighsOnOutcome({ probability: 0.99, evidenceSufficient: false })).toBe(false);
  });

  it('should not weigh without a stored percentage', () => {
    expect(weighsOnOutcome({ probability: null, evidenceSufficient: true })).toBe(false);
  });
});

describe('breakRelevanceDown', () => {
  it('should hold the model weight and the targeting factors the relevance multiplies', () => {
    expect(breakRelevanceDown({ probability: 0.9, evidenceSufficient: true, countryMatch: true, sectorMatch: true })).toEqual({
      modelWeight: expect.closeTo(0.64, 10),
      countryFactor: 2.5,
      sectorFactor: 4,
      targetingFactor: 10,
    });
  });

  it('should leave an unmatched dimension at one', () => {
    expect(breakRelevanceDown({ probability: 0.9, evidenceSufficient: true, countryMatch: true, sectorMatch: false })).toMatchObject({
      countryFactor: 2.5,
      sectorFactor: 1,
      targetingFactor: 2.5,
    });
  });

  it('should carry a zero weight on insufficient evidence or no percentage', () => {
    expect(breakRelevanceDown({ probability: 0.99, evidenceSufficient: false, countryMatch: true, sectorMatch: true }).modelWeight).toBe(0);
    expect(breakRelevanceDown({ probability: null, evidenceSufficient: true, countryMatch: true, sectorMatch: true }).modelWeight).toBe(0);
  });
});

describe('resolveRelevanceBand', () => {
  it('should band on the thresholds themselves, not just above them', () => {
    expect(resolveRelevanceBand(50)).toBe('strong');
    expect(resolveRelevanceBand(49)).toBe('moderate');
    expect(resolveRelevanceBand(15)).toBe('moderate');
    expect(resolveRelevanceBand(14)).toBe('weak');
  });

  it('should band the extremes', () => {
    expect(resolveRelevanceBand(100)).toBe('strong');
    expect(resolveRelevanceBand(0)).toBe('weak');
  });
});

describe('toRelevancePercent', () => {
  it('should print relevance as a whole percent', () => {
    expect(toRelevancePercent(0.7373)).toBe(74);
    expect(toRelevancePercent(0)).toBe(0);
    expect(toRelevancePercent(1)).toBe(100);
  });
});
