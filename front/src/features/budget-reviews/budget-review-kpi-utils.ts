import type { BudgetReviewFigureState } from './ui/review-chips';
import { returnPercentSign } from '../treatment-plans/treatment-plan-utils';

export interface ReviewKpiFigures {
  spent: number,
  aleReductionMean: number | null,
  aleReductionP10: number | null,
  aleReductionP90: number | null,
  returnPercent: number | null,
  state: BudgetReviewFigureState,
}

export interface ReviewKpiRow extends ReviewKpiFigures {
  organizationId: string,
  name: string,
  periodStart: string,
  lineCount: number,
  build: ReviewKpiFigures,
}

export interface ToleranceScopeCount {
  organizationId: string,
  assessed: number,
  outside: number,
}

export interface ToleranceCount {
  assessed: number,
  outside: number,
  /** Risk scopes with at least one scenario outside. */
  outsideScopes: number,
}

/** The server holds each scenario to its own tolerance on its latest simulation, never to the sum of several. */
export const toleranceCount = (scopes: ReadonlyArray<ToleranceScopeCount>): ToleranceCount => ({
  assessed: scopes.reduce((total, scope) => total + scope.assessed, 0),
  outside: scopes.reduce((total, scope) => total + scope.outside, 0),
  outsideScopes: scopes.filter((scope) => scope.outside > 0).length,
});

interface Dated {
  periodStart: string,
  lineCount: number,
}

const byPeriodStartDescending = <T extends Dated>(a: T, b: T): number => b.periodStart.localeCompare(a.periodStart);

/**
 * The most recent by period start among the reviews with at least one line, else the most recent:
 * an empty review opened early for the next year does not hide the figures of the year under way.
 */
const mostRecentReview = <T extends Dated>(reviews: ReadonlyArray<T>): T | null => {
  const sorted = [...reviews].sort(byPeriodStartDescending);
  return sorted.find((review) => review.lineCount > 0) ?? sorted[0] ?? null;
};

/** One scope's latest review, and the one it is compared with among those that started before it. */
export const latestTwoReviews = <T extends Dated>(reviews: ReadonlyArray<T>): { latest: T | null, previous: T | null } => {
  const latest = mostRecentReview(reviews);
  if (latest === null) {
    return { latest: null, previous: null };
  }
  const previous = mostRecentReview(reviews.filter((review) => review.periodStart.localeCompare(latest.periodStart) < 0));
  return { latest, previous };
};

/** Percent change of the loss avoided against the previous review's. Null unless both are priced, and when the previous is zero. */
export const lossAvoidedTrendPercent = (latest: ReviewKpiFigures | null, previous: ReviewKpiFigures | null): number | null => {
  if (latest?.state !== 'priced' || previous?.state !== 'priced') {
    return null;
  }
  const now = latest.aleReductionMean;
  const before = previous.aleReductionMean;
  return now === null || before === null || before === 0 ? null : ((now - before) / Math.abs(before)) * 100;
};

export interface TenantReviewKpis {
  scopeCount: number,
  /** Sum of the latest reviews' loss avoided, over the scopes whose latest review is priced. */
  lossAvoided: number | null,
  lossAvoidedScopeCount: number,
  /** The build work's return, pooled: its loss avoided and its spend are summed before the ratio is taken. */
  buildReturnPercent: number | null,
  scopesBelowZero: number,
  spent: number,
  buildSpent: number,
}

export const latestReviewPerScope = <T extends Dated & { organizationId: string }>(reviews: ReadonlyArray<T>): Array<T> => {
  const byScope = Map.groupBy(reviews, (review) => review.organizationId);
  return [...byScope.values()].flatMap((scopeReviews) => {
    const latest = mostRecentReview(scopeReviews);
    return latest === null ? [] : [latest];
  });
};

const sum = (values: ReadonlyArray<number>): number => values.reduce((total, value) => total + value, 0);

/** Bands are left out: those of several scopes do not add up. */
export const tenantReviewKpis = (reviews: ReadonlyArray<ReviewKpiRow>): TenantReviewKpis => {
  const latest = latestReviewPerScope(reviews);
  const priced = latest.flatMap((review) => (review.state !== 'priced' || review.aleReductionMean === null ? [] : [review.aleReductionMean]));
  const built = latest.filter((review) => review.build.state === 'priced' && review.build.aleReductionMean !== null && review.build.spent > 0);
  const buildSpentOfBuilt = sum(built.map((review) => review.build.spent));
  return {
    scopeCount: latest.length,
    lossAvoided: priced.length === 0 ? null : sum(priced),
    lossAvoidedScopeCount: priced.length,
    buildReturnPercent: built.length === 0
      ? null
      : ((sum(built.map((review) => review.build.aleReductionMean ?? 0)) - buildSpentOfBuilt) / buildSpentOfBuilt) * 100,
    scopesBelowZero: built.filter((review) => review.build.returnPercent !== null && returnPercentSign(review.build.returnPercent) < 0).length,
    spent: sum(latest.map((review) => review.spent)),
    buildSpent: sum(latest.map((review) => review.build.spent)),
  };
};
