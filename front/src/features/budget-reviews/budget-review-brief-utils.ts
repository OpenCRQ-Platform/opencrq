import type { BudgetLineNature } from './budget-review-utils';
import type { ReviewToleranceScenario } from './budget-review-tolerance-utils';
import { hasAppliedTolerance, reviewToleranceSummary } from './budget-review-tolerance-utils';

type FigureState = 'priced' | 'expired' | 'not-priced';

/**
 * `none` with no build line, `unpriced` while the build figure is missing or out of date, so the
 * sentence never states a stale amount, `unchanged` for a loss avoided of exactly zero, `raises`
 * when the build work adds to the annual loss.
 */
export type BriefBuildClause = 'none' | 'unpriced' | 'removes' | 'unchanged' | 'raises';

export type ToleranceFigure = 'no-tolerance' | 'not-assessed' | 'assessed';

export interface BriefClauses {
  spent: boolean,
  build: BriefBuildClause,
  /** Said only of work that removes loss and brings at least one scenario back within its tolerance. */
  tolerance: boolean,
}

export interface BriefInput {
  lineCount: number,
  buildLineCount: number,
  build: { state: FigureState, aleReductionMean: number | null } | undefined,
  /** Undefined while it loads. */
  tolerance: { figure: ToleranceFigure, state: FigureState, broughtBack: number } | undefined,
}

const buildClause = (buildLineCount: number, build: BriefInput['build']): BriefBuildClause => {
  if (buildLineCount === 0) {
    return 'none';
  }
  if (build === undefined || build.state !== 'priced' || build.aleReductionMean === null) {
    return 'unpriced';
  }
  if (build.aleReductionMean === 0) {
    return 'unchanged';
  }
  return build.aleReductionMean < 0 ? 'raises' : 'removes';
};

export const briefClauses = ({ lineCount, buildLineCount, build, tolerance }: BriefInput): BriefClauses => {
  const clause = buildClause(buildLineCount, build);
  return {
    spent: lineCount > 0,
    build: clause,
    tolerance: clause === 'removes' && tolerance?.figure === 'assessed' && tolerance.state === 'priced' && tolerance.broughtBack > 0,
  };
};

export const toleranceFigure = (scenarios: ReadonlyArray<ReviewToleranceScenario>): ToleranceFigure => {
  if (!hasAppliedTolerance(scenarios)) {
    return 'no-tolerance';
  }
  return reviewToleranceSummary(scenarios).assessed === 0 ? 'not-assessed' : 'assessed';
};

export const spentByNature = (lines: ReadonlyArray<{ nature: BudgetLineNature, amountSpent: number }>): Record<BudgetLineNature | 'total', number> => {
  const of = (nature: BudgetLineNature) => lines.filter((line) => line.nature === nature).reduce((total, line) => total + line.amountSpent, 0);
  const build = of('build');
  const run = of('run');
  return { build, run, total: build + run };
};
