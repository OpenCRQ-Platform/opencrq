import type { AppliedTolerance, ExceedancePoint, ExceedanceReading, RiskToleranceLike, ToleranceSource } from '@app/module/client';
import { isOutsideTolerance } from '@app/module/client';

export type ToleranceReference = 'today' | 'period-end' | 'closing';

export interface ReviewToleranceReading {
  probability: number | null,
  beyondTail: boolean | null,
  curve: ReadonlyArray<ExceedancePoint>,
}

export interface ReviewToleranceScenario {
  /** Null for a scenario deleted since the review closed. */
  scenarioId: string | null,
  name: string,
  tolerance: (RiskToleranceLike & { source: ToleranceSource }) | null,
  reference: ReviewToleranceReading | null,
  withoutBuild: ReviewToleranceReading | null,
  /** The scenario's latest run is not the run the curves come from. */
  olderThanHeadline: boolean,
}

export interface AssessedScenario {
  scenarioId: string | null,
  name: string,
  applied: AppliedTolerance,
  reference: ExceedanceReading,
  withoutBuild: ExceedanceReading,
  outsideAtReference: boolean,
  outsideWithoutBuild: boolean,
  /** Outside without the build work, within with it. */
  broughtBack: boolean,
  chart: ToleranceChartModel | null,
  olderThanHeadline: boolean,
}

export interface ReviewToleranceSummary {
  /** Scenarios with an applied tolerance and both readings, the base every count is out of. */
  assessed: number,
  outsideAtReference: number,
  outsideWithoutBuild: number,
  broughtBack: number,
  /** Every assessed scenario: brought back first, then outside at the reference, then within, each by name. */
  rows: Array<AssessedScenario>,
}

const exceedanceReading = (reading: ReviewToleranceReading | null): ExceedanceReading | null => (
  reading === null || reading.probability === null || reading.beyondTail === null
    ? null
    : { probability: reading.probability, beyondTail: reading.beyondTail }
);

export type ToleranceCurveKey = 'reference' | 'withoutBuild';

export interface ToleranceCurveRead {
  reading: ExceedanceReading,
  /**
   * The higher read goes above and right of its point, the lower one below and left: a falling curve
   * leaves both corners clear, so neither label sits on a curve.
   */
  side: 'above' | 'below',
}

export interface ToleranceCurveSeries {
  key: ToleranceCurveKey,
  curve: ReadonlyArray<ExceedancePoint>,
  /** At the tolerance amount, null when the scenario applies no tolerance. */
  read: ToleranceCurveRead | null,
}

export interface ToleranceChartModel {
  tolerance: RiskToleranceLike | null,
  series: [ToleranceCurveSeries, ToleranceCurveSeries],
  /** What the axes must reach: both curves and the tolerance point. */
  lossMax: number,
  probabilityMax: number,
}

const readSides = (reference: ExceedanceReading | null, withoutBuild: ExceedanceReading | null): Record<ToleranceCurveKey, 'above' | 'below'> =>
  reference !== null && withoutBuild !== null && reference.probability > withoutBuild.probability
    ? { reference: 'above', withoutBuild: 'below' }
    : { reference: 'below', withoutBuild: 'above' };

/** Null when either curve is missing, as for a scenario not priced for the review: there is nothing to draw. */
export const toleranceChartModel = (scenario: ReviewToleranceScenario): ToleranceChartModel | null => {
  const { reference, withoutBuild } = scenario;
  if (reference === null || withoutBuild === null || reference.curve.length === 0 || withoutBuild.curve.length === 0) {
    return null;
  }
  const tolerance = scenario.tolerance === null
    ? null
    : { annualLoss: scenario.tolerance.annualLoss, maxExceedanceProbability: scenario.tolerance.maxExceedanceProbability };
  const referenceRead = tolerance === null ? null : exceedanceReading(reference);
  const withoutBuildRead = tolerance === null ? null : exceedanceReading(withoutBuild);
  const sides = readSides(referenceRead, withoutBuildRead);
  const curves = [reference.curve, withoutBuild.curve];
  return {
    tolerance,
    series: [
      { key: 'reference', curve: reference.curve, read: referenceRead === null ? null : { reading: referenceRead, side: sides.reference } },
      { key: 'withoutBuild', curve: withoutBuild.curve, read: withoutBuildRead === null ? null : { reading: withoutBuildRead, side: sides.withoutBuild } },
    ],
    lossMax: Math.max(...curves.map((curve) => curve[curve.length - 1].loss), tolerance?.annualLoss ?? 0),
    probabilityMax: Math.max(...curves.map((curve) => curve[0].probability), tolerance?.maxExceedanceProbability ?? 0),
  };
};

const assess = (scenario: ReviewToleranceScenario): AssessedScenario | null => {
  const reference = exceedanceReading(scenario.reference);
  const withoutBuild = exceedanceReading(scenario.withoutBuild);
  if (scenario.tolerance === null || reference === null || withoutBuild === null) {
    return null;
  }
  const { source, ...tolerance } = scenario.tolerance;
  const outsideAtReference = isOutsideTolerance(reference, tolerance);
  const outsideWithoutBuild = isOutsideTolerance(withoutBuild, tolerance);
  return {
    scenarioId: scenario.scenarioId,
    name: scenario.name,
    applied: { tolerance, source },
    reference,
    withoutBuild,
    outsideAtReference,
    outsideWithoutBuild,
    broughtBack: outsideWithoutBuild && !outsideAtReference,
    chart: toleranceChartModel(scenario),
    olderThanHeadline: scenario.olderThanHeadline,
  };
};

const toleranceRank = (scenario: AssessedScenario): number => {
  if (scenario.broughtBack) {
    return 0;
  }
  return scenario.outsideAtReference ? 1 : 2;
};

const byToleranceRankThenByName = (a: AssessedScenario, b: AssessedScenario): number =>
  toleranceRank(a) - toleranceRank(b) || a.name.localeCompare(b.name);

export const hasAppliedTolerance = (scenarios: ReadonlyArray<ReviewToleranceScenario>): boolean =>
  scenarios.some((scenario) => scenario.tolerance !== null);

export const reviewToleranceSummary = (scenarios: ReadonlyArray<ReviewToleranceScenario>): ReviewToleranceSummary => {
  const assessed = scenarios.map(assess).filter((scenario) => scenario !== null);
  return {
    assessed: assessed.length,
    outsideAtReference: assessed.filter((scenario) => scenario.outsideAtReference).length,
    outsideWithoutBuild: assessed.filter((scenario) => scenario.outsideWithoutBuild).length,
    broughtBack: assessed.filter((scenario) => scenario.broughtBack).length,
    rows: assessed.sort(byToleranceRankThenByName),
  };
};

/** Half the height a caption line takes, and the diamond's half diagonal, in pixels. */
const LABEL_HALF_HEIGHT = 6;
const DIAMOND_REACH = 8;

/**
 * Above or below its dot, as the read's side says, and moved past the tolerance diamond when the
 * diamond sits on that line: a reading just outside the tolerance would print over it.
 */
export const readingLabelBaseline = (side: 'above' | 'below', dotY: number, diamondY: number): number => {
  const baseline = dotY + (side === 'above' ? -6 : 14);
  const middle = baseline - LABEL_HALF_HEIGHT + 1;
  if (Math.abs(middle - diamondY) >= LABEL_HALF_HEIGHT + DIAMOND_REACH) {
    return baseline;
  }
  return side === 'above' ? diamondY - DIAMOND_REACH - 4 : diamondY + DIAMOND_REACH + 2 * LABEL_HALF_HEIGHT;
};
