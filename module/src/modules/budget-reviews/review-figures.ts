import type { BudgetLineNature, BudgetReviewBasket, BudgetReviewFigureState, BudgetReviewStoredBasket } from './constants';
import type { ScenarioReadinessStatus } from '../risk-scenarios/readiness';

/** One stored figure of a review, on the latest run of one scenario of its scope that priced the review. */
export interface ReviewResultRow {
  riskScenarioId: string,
  runCreatedAt: Date,
  reviewVersion: number,
  basket: BudgetReviewStoredBasket,
  lineId: string | null,
  aleReductionMean: number | null,
  aleReductionP10: number | null,
  aleReductionP90: number | null,
  /** True when the scenario's latest run is not the run the review's figures come from. */
  olderThanHeadline: boolean,
}

export interface ReviewScenario {
  id: string,
  readinessStatus: ScenarioReadinessStatus,
}

export interface ReviewLineSpend {
  id: string,
  nature: BudgetLineNature,
  amountSpent: number,
  amortizationYears: number | null,
}

export interface BudgetReviewFigure {
  basket: BudgetReviewBasket,
  lineId: string | null,
  state: BudgetReviewFigureState,
  /** Summed over the scope's ready scenarios. Null when none carries a figure, which is not zero. */
  aleReductionMean: number | null,
  /**
   * The per-scenario p10 and p90 summed: each is the quantile of a paired difference on one run, and
   * runs of two scenarios share no worlds, so the sum is the spread the scenarios would have if they
   * moved together, wider than the true spread of the total.
   */
  aleReductionP10: number | null,
  aleReductionP90: number | null,
  /** What the figure's lines spent over the period: the line's own, a nature's, or every line's. */
  spent: number,
  /** `(loss avoided - spent) / spent`, as a percentage. Null without a figure or without a spend. */
  returnPercent: number | null,
  /**
   * What the figure's lines cost a year, each build line's spend spread over its amortization years.
   * Equal to `spent` when no build line of the figure is amortized.
   */
  annualSpent: number,
  /** The return read against `annualSpent`, which the annual loss avoided compares with like for like. */
  amortizedReturnPercent: number | null,
  pricedScenarioCount: number,
  /** The oldest simulation the figure is made of. */
  pricedAt: Date | null,
}

export interface BudgetReviewFigures {
  figures: Array<BudgetReviewFigure>,
  scopeScenarioCount: number,
  /** The ready scenarios whose latest run is not the run their figures come from. */
  olderThanHeadline: Array<string>,
  /**
   * The simulable scenarios of the scope that carry no figure for the review's current version, or
   * whose latest run is not the run their figures come from.
   */
  toReprice: Array<string>,
}

/** The other two statuses wait on the analyst, not on a simulation. */
const SIMULABLE_STATUSES: ReadonlySet<ScenarioReadinessStatus> = new Set(['not-simulated', 'stale', 'ready']);

export const figureKey = (basket: BudgetReviewStoredBasket, lineId: string | null): string => `${basket}:${lineId ?? ''}`;

export const returnPercentOf = (aleReduction: number | null, spent: number): number | null =>
  (aleReduction === null || !(spent > 0) ? null : ((aleReduction - spent) / spent) * 100);

interface FigureSlot {
  basket: BudgetReviewBasket,
  lineId: string | null,
  spent: number,
  annualSpent: number,
}

const annualSpendOf = (line: ReviewLineSpend): number =>
  (line.nature === 'build' && line.amortizationYears !== null && line.amortizationYears > 0
    ? line.amountSpent / line.amortizationYears
    : line.amountSpent);

/** The baskets a review owes a figure for: one per line, then the two natures and the ensemble. */
export const reviewFigureSlots = (lines: ReadonlyArray<ReviewLineSpend>): Array<FigureSlot> => {
  const slotOf = (basket: Exclude<BudgetReviewBasket, 'line'>, nature: BudgetLineNature | null): FigureSlot => {
    const held = lines.filter((line) => nature === null || line.nature === nature);
    return {
      basket,
      lineId: null,
      spent: held.reduce((total, line) => total + line.amountSpent, 0),
      annualSpent: held.reduce((total, line) => total + annualSpendOf(line), 0),
    };
  };
  return [
    ...lines.map((line) => ({ basket: 'line' as const, lineId: line.id, spent: line.amountSpent, annualSpent: annualSpendOf(line) })),
    slotOf('build', 'build'),
    slotOf('run', 'run'),
    slotOf('ensemble', null),
  ];
};

export const figureSpendOf = (slot: FigureSlot, aleReductionMean: number | null) => ({
  spent: slot.spent,
  returnPercent: returnPercentOf(aleReductionMean, slot.spent),
  annualSpent: slot.annualSpent,
  amortizedReturnPercent: returnPercentOf(aleReductionMean, slot.annualSpent),
});

const sumOrNull = (values: ReadonlyArray<number | null>): number | null =>
  (values.length === 0 ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0));

/**
 * A review's figures over the scenarios of its scope, on the rules a treatment plan's projection
 * follows: a scenario that is not ready carries nothing, its last run describing a scenario that no
 * longer exists, and a figure priced under an earlier version keeps its amount and reads expired.
 *
 * Every figure of a review is written by the same run, so a scenario is to reprice when the latest
 * run that priced the review carries no ensemble figure for the current version, or when its latest
 * run is another one: its figures stay `priced` but are listed in `olderThanHeadline`.
 */
export const buildReviewFigures = (
  scenarios: ReadonlyArray<ReviewScenario>,
  rows: ReadonlyArray<ReviewResultRow>,
  version: number,
  lines: ReadonlyArray<ReviewLineSpend>,
): BudgetReviewFigures => {
  const ready = new Set(scenarios.filter((scenario) => scenario.readinessStatus === 'ready').map((scenario) => scenario.id));
  const rowsByKey = Map.groupBy(rows.filter((row) => ready.has(row.riskScenarioId)), (row: ReviewResultRow) => figureKey(row.basket, row.lineId));

  const figures = reviewFigureSlots(lines).map((slot): BudgetReviewFigure => {
    const { basket, lineId } = slot;
    const held = rowsByKey.get(figureKey(basket, lineId)) ?? [];
    const current = held.filter((row) => row.reviewVersion === version);
    let state: BudgetReviewFigureState = 'priced';
    if (current.length < held.length) {
      state = 'expired';
    } else if (ready.size === 0 || current.length < ready.size) {
      state = 'not-priced';
    }
    const aleReductionMean = sumOrNull(held.map((row) => row.aleReductionMean));
    return {
      basket,
      lineId,
      state,
      aleReductionMean,
      aleReductionP10: sumOrNull(held.map((row) => row.aleReductionP10)),
      aleReductionP90: sumOrNull(held.map((row) => row.aleReductionP90)),
      ...figureSpendOf(slot, aleReductionMean),
      pricedScenarioCount: held.length,
      pricedAt: held.reduce<Date | null>((oldest, row) => (oldest === null || row.runCreatedAt < oldest ? row.runCreatedAt : oldest), null),
    };
  });

  const pricedNow = new Set(rows
    .filter((row) => ready.has(row.riskScenarioId) && row.basket === 'ensemble' && row.reviewVersion === version)
    .map((row) => row.riskScenarioId));
  const olderIds = new Set(rows.filter((row) => ready.has(row.riskScenarioId) && row.olderThanHeadline).map((row) => row.riskScenarioId));
  return {
    figures,
    scopeScenarioCount: scenarios.length,
    olderThanHeadline: scenarios.filter((scenario) => olderIds.has(scenario.id)).map((scenario) => scenario.id),
    toReprice: scenarios
      .filter((scenario) => SIMULABLE_STATUSES.has(scenario.readinessStatus) && (!pricedNow.has(scenario.id) || olderIds.has(scenario.id)))
      .map((scenario) => scenario.id),
  };
};
