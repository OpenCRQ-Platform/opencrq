import type { ExceedancePoint, RiskToleranceLike, ToleranceSource } from '../dashboard/loss-exceedance';
import type { BudgetReviewTolerancePosture, BudgetReviewToleranceReference } from './constants';
import type { ReviewScenario } from './review-figures';
import { compareCodePoints } from '@app/utils';
import { buildExceedanceCurve, readExceedance, resolveAppliedTolerance } from '../dashboard/loss-exceedance';
import { reviewPeriodBounds } from './review-period';

export interface ReviewToleranceReading {
  /** The probability that the year's loss exceeds the applied tolerance's amount; null without a tolerance. */
  probability: number | null,
  /** Null without a tolerance, as `probability` is. */
  beyondTail: boolean | null,
  curve: Array<ExceedancePoint>,
}

export interface ReviewToleranceScenario {
  /** Null on a closed review for a scenario deleted since its closing. */
  scenarioId: string | null,
  name: string,
  tolerance: (RiskToleranceLike & { source: ToleranceSource }) | null,
  /** Null for a scenario carrying no distribution priced under the review's current version. */
  reference: ReviewToleranceReading | null,
  withoutBuild: ReviewToleranceReading | null,
  /** True when the scenario's latest run is not the run the curves come from. */
  olderThanHeadline: boolean,
}

/** One stored annual loss of a review, on the run that scenario's figures of the review were read from. */
export interface ReviewAnnualLossRow {
  riskScenarioId: string,
  reviewVersion: number,
  posture: BudgetReviewTolerancePosture,
  lossYearShare: number,
  probabilities: Array<number>,
  losses: Array<number>,
}

export interface ScenarioTolerances {
  riskScenarioId: string,
  scope: RiskToleranceLike | null,
  own: RiskToleranceLike | null,
}

/** `closedAt` is null for an open review, which reads its scope as it stands at `now`. */
export const toleranceReferenceOf = (periodStart: string, closedAt: Date | null, now: Date): BudgetReviewToleranceReference => {
  if ((closedAt ?? now) >= reviewPeriodBounds(periodStart).end) {
    return 'period-end';
  }
  return closedAt === null ? 'today' : 'closing';
};

export const toleranceReadingOf = (curve: Array<ExceedancePoint>, tolerance: RiskToleranceLike | null): ReviewToleranceReading => {
  if (tolerance === null) {
    return { probability: null, beyondTail: null, curve };
  }
  const { probability, beyondTail } = readExceedance(curve, tolerance.annualLoss);
  return { probability, beyondTail, curve };
};

const byName = (first: ReviewToleranceScenario, second: ReviewToleranceScenario): number =>
  compareCodePoints(first.name, second.name) || compareCodePoints(first.scenarioId ?? '', second.scenarioId ?? '');

/**
 * Every scenario of the scope against the tolerance it applies today, its own over its scope's. A
 * scenario reads a curve on the rules a review's figure follows: only when it is ready, and only from
 * distributions priced under the review's current version, so an expired one reads null rather than
 * a posture the review no longer describes.
 */
export const buildReviewTolerance = (
  scenarios: ReadonlyArray<ReviewScenario & { name: string }>,
  tolerances: ReadonlyArray<ScenarioTolerances>,
  rows: ReadonlyArray<ReviewAnnualLossRow>,
  version: number,
  olderThanHeadline: ReadonlySet<string>,
): Array<ReviewToleranceScenario> => {
  const toleranceByScenario = new Map(tolerances.map((row) => [row.riskScenarioId, row]));
  const rowByKey = new Map(rows
    .filter((row) => row.reviewVersion === version)
    .map((row) => [`${row.riskScenarioId}:${row.posture}`, row]));
  const curveOf = (scenarioId: string, posture: BudgetReviewTolerancePosture): Array<ExceedancePoint> | null => {
    const row = rowByKey.get(`${scenarioId}:${posture}`);
    return row === undefined ? null : buildExceedanceCurve({
      lossYearShare: row.lossYearShare,
      quantiles: row.probabilities.map((probability, index) => ({ probability, loss: row.losses[index] })),
    });
  };
  return scenarios.map((scenario): ReviewToleranceScenario => {
    const held = toleranceByScenario.get(scenario.id);
    const applied = resolveAppliedTolerance(held?.scope ?? null, held?.own ?? null);
    const tolerance = applied === null ? null : { ...applied.tolerance, source: applied.source };
    const reference = scenario.readinessStatus === 'ready' ? curveOf(scenario.id, 'reference') : null;
    const withoutBuild = scenario.readinessStatus === 'ready' ? curveOf(scenario.id, 'without-build') : null;
    const priced = reference !== null && withoutBuild !== null;
    return {
      scenarioId: scenario.id,
      name: scenario.name,
      tolerance,
      reference: priced ? toleranceReadingOf(reference, tolerance) : null,
      withoutBuild: priced ? toleranceReadingOf(withoutBuild, tolerance) : null,
      olderThanHeadline: priced && olderThanHeadline.has(scenario.id),
    };
  }).sort(byName);
};

export interface ClosedToleranceRow {
  riskScenarioId: string | null,
  scenarioName: string,
  toleranceAnnualLoss: number | null,
  toleranceMaxExceedanceProbability: number | null,
  toleranceSource: ToleranceSource | null,
  referenceLosses: Array<number> | null,
  referenceProbabilities: Array<number> | null,
  withoutBuildLosses: Array<number> | null,
  withoutBuildProbabilities: Array<number> | null,
}

const curveFrom = (losses: Array<number> | null, probabilities: Array<number> | null): Array<ExceedancePoint> | null =>
  (losses === null || probabilities === null ? null : losses.map((loss, index) => ({ loss, probability: probabilities[index] })));

export const closedReviewToleranceOf = (rows: ReadonlyArray<ClosedToleranceRow>): Array<ReviewToleranceScenario> => rows.map((row) => {
  const tolerance = row.toleranceAnnualLoss === null || row.toleranceMaxExceedanceProbability === null || row.toleranceSource === null
    ? null
    : { annualLoss: row.toleranceAnnualLoss, maxExceedanceProbability: row.toleranceMaxExceedanceProbability, source: row.toleranceSource };
  const reference = curveFrom(row.referenceLosses, row.referenceProbabilities);
  const withoutBuild = curveFrom(row.withoutBuildLosses, row.withoutBuildProbabilities);
  return {
    scenarioId: row.riskScenarioId,
    name: row.scenarioName,
    tolerance,
    reference: reference === null ? null : toleranceReadingOf(reference, tolerance),
    withoutBuild: withoutBuild === null ? null : toleranceReadingOf(withoutBuild, tolerance),
    olderThanHeadline: false,
  };
}).sort(byName);

/** What a closing stores of one scenario, so `closedReviewToleranceOf` answers what was read. */
export const closedToleranceColumnsOf = (scenario: ReviewToleranceScenario) => ({
  riskScenarioId: scenario.scenarioId,
  scenarioName: scenario.name,
  toleranceAnnualLoss: scenario.tolerance?.annualLoss ?? null,
  toleranceMaxExceedanceProbability: scenario.tolerance?.maxExceedanceProbability ?? null,
  toleranceSource: scenario.tolerance?.source ?? null,
  referenceLosses: scenario.reference?.curve.map((point) => point.loss) ?? null,
  referenceProbabilities: scenario.reference?.curve.map((point) => point.probability) ?? null,
  withoutBuildLosses: scenario.withoutBuild?.curve.map((point) => point.loss) ?? null,
  withoutBuildProbabilities: scenario.withoutBuild?.curve.map((point) => point.probability) ?? null,
});
