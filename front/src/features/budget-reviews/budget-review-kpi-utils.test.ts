import { describe, expect, it } from 'vitest';
import type { ReviewKpiFigures, ReviewKpiRow } from './budget-review-kpi-utils';
import { latestReviewPerScope, latestTwoReviews, lossAvoidedTrendPercent, tenantReviewKpis, toleranceCount } from './budget-review-kpi-utils';

const figures = (overrides: Partial<ReviewKpiFigures> = {}): ReviewKpiFigures => ({
  spent: 0,
  aleReductionMean: null,
  aleReductionP10: null,
  aleReductionP90: null,
  returnPercent: null,
  state: 'priced',
  ...overrides,
});

const review = (
  organizationId: string,
  periodStart: string,
  overrides: Partial<ReviewKpiFigures> & { lineCount?: number } = {},
  build: Partial<ReviewKpiFigures> = {},
): ReviewKpiRow => {
  const { lineCount = 1, ...rest } = overrides;
  return {
    ...figures(rest),
    organizationId,
    name: `Review ${periodStart}`,
    periodStart,
    lineCount,
    build: figures(build),
  };
};

describe('latestTwoReviews', () => {
  it('should pick the most recent period start, and the one before it', () => {
    const reviews = [review('a', '2024-01-01'), review('a', '2026-01-01'), review('a', '2025-01-01')];

    const { latest, previous } = latestTwoReviews(reviews);

    expect(latest?.periodStart).toBe('2026-01-01');
    expect(previous?.periodStart).toBe('2025-01-01');
  });

  it('should pass over a later review with no line, for the latest and for the previous', () => {
    const reviews = [
      review('a', '2027-01-01', { lineCount: 0 }),
      review('a', '2026-01-01'),
      review('a', '2025-06-01', { lineCount: 0 }),
      review('a', '2025-01-01'),
    ];

    const { latest, previous } = latestTwoReviews(reviews);

    expect(latest?.periodStart).toBe('2026-01-01');
    expect(previous?.periodStart).toBe('2025-01-01');
  });

  it('should fall back to the most recent review when none has a line', () => {
    const { latest, previous } = latestTwoReviews([review('a', '2026-01-01', { lineCount: 0 }), review('a', '2027-01-01', { lineCount: 0 })]);

    expect(latest?.periodStart).toBe('2027-01-01');
    expect(previous?.periodStart).toBe('2026-01-01');
  });

  it('should leave the previous review out when there is only one', () => {
    expect(latestTwoReviews([review('a', '2026-01-01')]).previous).toBeNull();
    expect(latestTwoReviews([]).latest).toBeNull();
  });
});

describe('lossAvoidedTrendPercent', () => {
  it('should compare the latest loss avoided with the previous one', () => {
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 138 }), figures({ aleReductionMean: 100 }))).toBeCloseTo(38);
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 50 }), figures({ aleReductionMean: 100 }))).toBeCloseTo(-50);
  });

  it('should read a fall from a negative previous figure as a rise', () => {
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 50 }), figures({ aleReductionMean: -100 }))).toBeCloseTo(150);
  });

  it('should give no trend unless both figures are priced and the previous one is not zero', () => {
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: null }), figures({ aleReductionMean: 100 }))).toBeNull();
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 100 }), figures({ aleReductionMean: null }))).toBeNull();
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 100 }), figures({ aleReductionMean: 0 }))).toBeNull();
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 100 }), null)).toBeNull();
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 100 }), figures({ aleReductionMean: 80, state: 'expired' }))).toBeNull();
    expect(lossAvoidedTrendPercent(figures({ aleReductionMean: 100, state: 'expired' }), figures({ aleReductionMean: 80 }))).toBeNull();
  });
});

describe('latestReviewPerScope', () => {
  it('should keep the most recent review of each scope', () => {
    const latest = latestReviewPerScope([
      review('a', '2025-01-01'),
      review('b', '2024-01-01'),
      review('a', '2026-01-01'),
    ]);

    expect(latest.map((row) => `${row.organizationId}:${row.periodStart}`).sort()).toEqual(['a:2026-01-01', 'b:2024-01-01']);
  });

  it("should pass over a scope's later review with no line", () => {
    const latest = latestReviewPerScope([review('a', '2026-01-01'), review('a', '2027-01-01', { lineCount: 0 })]);

    expect(latest.map((row) => row.periodStart)).toEqual(['2026-01-01']);
  });
});

describe('tenantReviewKpis', () => {
  it('should sum the latest reviews, and only those, of the scopes', () => {
    const kpis = tenantReviewKpis([
      review('a', '2025-01-01', { spent: 900, aleReductionMean: 9_000 }),
      review('a', '2026-01-01', { spent: 100, aleReductionMean: 1_000 }, { spent: 40 }),
      review('b', '2026-01-01', { spent: 200, aleReductionMean: 3_000 }, { spent: 60 }),
    ]);

    expect(kpis.scopeCount).toBe(2);
    expect(kpis.lossAvoided).toBe(4_000);
    expect(kpis.lossAvoidedScopeCount).toBe(2);
    expect(kpis.spent).toBe(300);
    expect(kpis.buildSpent).toBe(100);
  });

  it('should count in the loss avoided only the scopes whose latest review is priced', () => {
    const kpis = tenantReviewKpis([
      review('a', '2026-01-01', { aleReductionMean: 1_000 }),
      review('b', '2026-01-01', { aleReductionMean: null, state: 'not-priced' }),
    ]);

    expect(kpis.lossAvoided).toBe(1_000);
    expect(kpis.lossAvoidedScopeCount).toBe(1);
    expect(tenantReviewKpis([review('b', '2026-01-01')]).lossAvoided).toBeNull();
  });

  it('should leave an expired figure out of the loss avoided and of the pooled build return', () => {
    const kpis = tenantReviewKpis([
      review('a', '2026-01-01', { aleReductionMean: 1_000 }, { spent: 100, aleReductionMean: 300, returnPercent: 200 }),
      review('b', '2026-01-01', { aleReductionMean: 5_000, state: 'expired' }, { spent: 300, aleReductionMean: 9_000, returnPercent: 2_900, state: 'expired' }),
    ]);

    expect(kpis.lossAvoided).toBe(1_000);
    expect(kpis.lossAvoidedScopeCount).toBe(1);
    expect(kpis.buildReturnPercent).toBeCloseTo(200);
  });

  it('should pool the build return over the scopes that priced their build work and spent on it', () => {
    const kpis = tenantReviewKpis([
      review('a', '2026-01-01', {}, { spent: 100, aleReductionMean: 300, returnPercent: 200 }),
      review('b', '2026-01-01', {}, { spent: 300, aleReductionMean: 150, returnPercent: -50 }),
      review('c', '2026-01-01', {}, { spent: 500, aleReductionMean: null }),
      review('d', '2026-01-01', {}, { spent: 0, aleReductionMean: 0 }),
    ]);

    expect(kpis.buildReturnPercent).toBeCloseTo(12.5);
    expect(kpis.scopesBelowZero).toBe(1);
  });

  it('should give no build return without a priced build spend', () => {
    expect(tenantReviewKpis([review('a', '2026-01-01')]).buildReturnPercent).toBeNull();
  });
});

describe('toleranceCount', () => {
  it('should add the counts of the scopes up, and count the scopes with a scenario outside', () => {
    const count = toleranceCount([
      { organizationId: 'a', assessed: 3, outside: 2 },
      { organizationId: 'b', assessed: 1, outside: 0 },
      { organizationId: 'c', assessed: 1, outside: 1 },
    ]);

    expect(count).toEqual({ assessed: 5, outside: 3, outsideScopes: 2 });
  });

  it('should read nothing when no scope holds a tolerance', () => {
    expect(toleranceCount([])).toEqual({ assessed: 0, outside: 0, outsideScopes: 0 });
  });
});
