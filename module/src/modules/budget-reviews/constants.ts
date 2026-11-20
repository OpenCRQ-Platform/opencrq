export const BUDGET_REVIEW_STATUSES = ['open', 'closed'] as const;
export type BudgetReviewStatus = typeof BUDGET_REVIEW_STATUSES[number];

/**
 * `build` is a project, worth what the period's posture changes of its controls removed. `run` is
 * a standing cost (licences, teams, managed services), worth what its controls, at the level they
 * held at the period's start, protect against them being absent.
 */
export const BUDGET_LINE_NATURES = ['build', 'run'] as const;
export type BudgetLineNature = typeof BUDGET_LINE_NATURES[number];

export const BUDGET_LINE_MAX_AMORTIZATION_YEARS = 10;

/** The six functions of NIST CSF 2.0, Govern first as the wheel puts it at its centre. */
export const CSF_FUNCTIONS = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'] as const;
export type CsfFunction = typeof CSF_FUNCTIONS[number];

/**
 * The figures a review is priced as. `line` is one budget line, `build` and `run` the lines of one
 * nature together, `ensemble` everything the review funds at once. The last is a basket of its own
 * and never the sum of the other two: two controls on one technique each quieten what the other left.
 */
export const BUDGET_REVIEW_BASKETS = ['line', 'build', 'run', 'ensemble'] as const;
export type BudgetReviewBasket = typeof BUDGET_REVIEW_BASKETS[number];

/**
 * What a run stores per review: every basket, plus, on each day a build control moved before the
 * period's last such day, `step` and `step-level`, which only draw the risk curve and are never closed.
 */
export const BUDGET_REVIEW_STORED_BASKETS = [...BUDGET_REVIEW_BASKETS, 'step', 'step-level'] as const;
export type BudgetReviewStoredBasket = typeof BUDGET_REVIEW_STORED_BASKETS[number];

/**
 * - `priced`: every simulable scenario of the scope carries a figure for the review's current version.
 * - `expired`: one at least carries a figure for an earlier version, kept and shown rather than dropped.
 * - `not-priced`: some simulable scenario carries no figure for this review at all.
 */
export const BUDGET_REVIEW_FIGURE_STATES = ['priced', 'expired', 'not-priced'] as const;
export type BudgetReviewFigureState = typeof BUDGET_REVIEW_FIGURE_STATES[number];

/**
 * The postures a review's risk tolerance is read at: `reference`, the scope today while the period
 * runs or at its end once it is over, and `without-build`, the same with the build lines' controls
 * back at their period-start posture.
 */
export const BUDGET_REVIEW_TOLERANCE_POSTURES = ['reference', 'without-build'] as const;
export type BudgetReviewTolerancePosture = typeof BUDGET_REVIEW_TOLERANCE_POSTURES[number];

/**
 * Where a review reads its tolerance: the scope today while its period runs, at the period's end once
 * it is over, and on its closing day for a review closed before its period ended.
 */
export const BUDGET_REVIEW_TOLERANCE_REFERENCES = ['today', 'period-end', 'closing'] as const;
export type BudgetReviewToleranceReference = typeof BUDGET_REVIEW_TOLERANCE_REFERENCES[number];
