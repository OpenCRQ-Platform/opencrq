import type { AggregatedControlMove, WhatIfMoveRow } from '../crq-indicators/control-aggregation';
import type { RiskTolerance } from '../organizations/constants';
import type { AnnualLossDistributionLike, ToleranceGap } from './loss-exceedance';
import { aggregateTopControlMoves } from '../crq-indicators/control-aggregation';
import { deriveLikelihood, toUtcDayKey } from './aggregation';
import { buildExceedanceCurve, compareToleranceGaps, isOutsideTolerance, readExceedance, readToleranceGap, resolveAppliedTolerance } from './loss-exceedance';

export interface ScenarioRunReading {
  runId: string,
  riskScenarioId: string,
  createdAt: Date,
  aleMean: number | null,
  lefMean: number | null,
  lefP10: number | null,
  lefP90: number | null,
  lossEventYearShare: number | null,
}

export interface RiskTreatmentPoint {
  date: string,
  aleMean: number | null,
  /** The sampled share of years with a loss event, null for a run without an annual loss distribution. */
  likelihood: number | null,
  /** `1 − e^−LEF` at the LEF band's ends, over the worlds the likelihood was sampled in. */
  likelihoodP10: number | null,
  likelihoodP90: number | null,
  /**
   * The probability that the year's loss exceeds the amount of the tolerance applied today, read from
   * that run's distribution: null without a tolerance or a distribution. The tolerance keeps no history.
   */
  exceedance: number | null,
}

export interface RiskTreatmentScenario {
  id: string,
  name: string,
  organizationId: string,
  attackOutcomeName: string,
  noMappedAsset: boolean,
  scopeTolerance: RiskTolerance | null,
  ownTolerance: RiskTolerance | null,
}

export interface LossExceedanceDistribution {
  mean: number,
  lossYearShare: number,
  quantiles: Array<{ probability: number, loss: number }>,
}

export interface RiskTreatmentCard {
  scenarioId: string,
  name: string,
  organizationId: string,
  attackOutcomeName: string,
  noMappedAsset: boolean,
  /** Whether a run priced the scenario: a scenario mapping no asset never is. */
  simulated: boolean,
  aleMean: number | null,
  topControlMoves: Array<AggregatedControlMove>,
  scopeTolerance: RiskTolerance | null,
  ownTolerance: RiskTolerance | null,
}

/**
 * The last run before the window opens the series on the window's first day, unless a run of that
 * day replaces it, so the change over the window spans the same stretch as the scope-level trend.
 *
 * `windowRuns` holds at most one run per scenario and UTC day.
 */
export const buildScenarioRunSeries = <TRun extends { riskScenarioId: string, createdAt: Date }>(
  seedRuns: ReadonlyArray<TRun>,
  windowRuns: ReadonlyArray<TRun>,
  windowStart: Date,
): Map<string, Array<TRun & { date: string }>> => {
  const startKey = toUtcDayKey(windowStart);
  const series = new Map<string, Array<TRun & { date: string }>>();
  for (const run of [...windowRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const points = series.get(run.riskScenarioId) ?? [];
    points.push({ ...run, date: toUtcDayKey(run.createdAt) });
    series.set(run.riskScenarioId, points);
  }
  for (const seed of seedRuns) {
    const points = series.get(seed.riskScenarioId) ?? [];
    if (points[0]?.date !== startKey) {
      points.unshift({ ...seed, date: startKey });
    }
    series.set(seed.riskScenarioId, points);
  }
  return series;
};

export const assembleRiskTreatmentCards = (
  scenarios: ReadonlyArray<RiskTreatmentScenario>,
  latestRuns: ReadonlyArray<{ runId: string, riskScenarioId: string, aleMean: number | null }>,
  whatIfRows: ReadonlyArray<WhatIfMoveRow>,
  movesLimit: number,
): Array<RiskTreatmentCard> => {
  const whatIfByScenario = Map.groupBy(whatIfRows, (row) => row.riskScenarioId);
  const latestByScenario = new Map(latestRuns.map((run) => [run.riskScenarioId, run]));
  const cards = scenarios.map((scenario): RiskTreatmentCard => {
    const latest = latestByScenario.get(scenario.id);
    return {
      scenarioId: scenario.id,
      name: scenario.name,
      organizationId: scenario.organizationId,
      attackOutcomeName: scenario.attackOutcomeName,
      noMappedAsset: scenario.noMappedAsset,
      simulated: latest !== undefined,
      aleMean: latest?.aleMean ?? null,
      topControlMoves: aggregateTopControlMoves([...whatIfByScenario.get(scenario.id) ?? []]).slice(0, movesLimit),
      scopeTolerance: scenario.scopeTolerance,
      ownTolerance: scenario.ownTolerance,
    };
  });
  const rank = (card: RiskTreatmentCard): number => card.aleMean ?? Number.NEGATIVE_INFINITY;
  return cards.sort((a, b) => (rank(a) === rank(b) ? a.name.localeCompare(b.name) : rank(b) - rank(a)));
};

/** `annualLossByRunId` holds every run of the series when the scenario is under a tolerance. */
export const buildRiskTreatmentPoints = (
  series: ReadonlyArray<ScenarioRunReading & { date: string }>,
  applied: RiskTolerance | null,
  annualLossByRunId: ReadonlyMap<string, LossExceedanceDistribution>,
): Array<RiskTreatmentPoint> =>
  series.map((run) => {
    const distribution = annualLossByRunId.get(run.runId);
    return {
      date: run.date,
      aleMean: run.aleMean,
      likelihood: run.lossEventYearShare,
      likelihoodP10: deriveLikelihood(run.lefP10),
      likelihoodP90: deriveLikelihood(run.lefP90),
      exceedance: applied === null || distribution === undefined
        ? null
        : readExceedance(buildExceedanceCurve(distribution), applied.annualLoss).probability,
    };
  });

export interface ToleranceGapScenario {
  id: string,
  name: string,
  organizationId: string,
  organizationName: string | null,
  scopeTolerance: RiskTolerance | null,
  ownTolerance: RiskTolerance | null,
}

export interface ToleranceGapRow extends ToleranceGap {
  scenarioId: string,
  name: string,
  organizationId: string,
  organizationName: string | null,
  scopeTolerance: RiskTolerance | null,
  ownTolerance: RiskTolerance | null,
}

export interface ToleranceGapScope {
  organizationId: string,
  organizationName: string | null,
}

export interface ToleranceGapRanking {
  rows: Array<ToleranceGapRow>,
  noToleranceCount: number,
  /** The scopes holding the scenarios with no tolerance, each once. */
  noToleranceScopes: Array<ToleranceGapScope>,
}

/** A scenario under a threshold whose latest run kept no distribution has nothing to read, so it is neither ranked nor counted. */
export const rankToleranceGaps = (
  scenarios: ReadonlyArray<ToleranceGapScenario>,
  annualLossByScenario: ReadonlyMap<string, AnnualLossDistributionLike>,
): ToleranceGapRanking => {
  let noToleranceCount = 0;
  const noToleranceScopes = new Map<string, ToleranceGapScope>();
  const rows: Array<ToleranceGapRow> = [];
  for (const scenario of scenarios) {
    const { id, name, organizationId, organizationName, scopeTolerance, ownTolerance } = scenario;
    if (scopeTolerance === null && ownTolerance === null) {
      noToleranceCount += 1;
      noToleranceScopes.set(organizationId, { organizationId, organizationName });
      continue;
    }
    const gap = readToleranceGap(annualLossByScenario.get(id) ?? null, scopeTolerance, ownTolerance);
    if (gap !== null) {
      rows.push({ ...gap, scenarioId: id, name, organizationId, organizationName, scopeTolerance, ownTolerance });
    }
  }
  rows.sort((left, right) => compareToleranceGaps(left, right) || left.name.localeCompare(right.name));
  return { rows, noToleranceCount, noToleranceScopes: [...noToleranceScopes.values()] };
};

export interface ToleranceScopeCount {
  organizationId: string,
  /** Scenarios with a tolerance applied, whether or not a run has priced them. */
  assessed: number,
  outside: number,
}

/**
 * Each scenario is read on its own latest run against its own applied tolerance, never against the
 * sum of several scenarios. A scenario whose latest run kept no distribution cannot be outside, and a
 * scope with no tolerance applied at all has no row.
 */
export const countToleranceByScope = (
  scenarios: ReadonlyArray<{ id: string, organizationId: string, scopeTolerance: RiskTolerance | null, ownTolerance: RiskTolerance | null }>,
  annualLossByScenario: ReadonlyMap<string, AnnualLossDistributionLike>,
): Array<ToleranceScopeCount> => {
  const counts = new Map<string, ToleranceScopeCount>();
  for (const { id, organizationId, scopeTolerance, ownTolerance } of scenarios) {
    const applied = resolveAppliedTolerance(scopeTolerance, ownTolerance);
    if (applied === null) {
      continue;
    }
    const count = counts.get(organizationId) ?? { organizationId, assessed: 0, outside: 0 };
    count.assessed += 1;
    const distribution = annualLossByScenario.get(id);
    if (distribution !== undefined && isOutsideTolerance(readExceedance(buildExceedanceCurve(distribution), applied.tolerance.annualLoss), applied.tolerance)) {
      count.outside += 1;
    }
    counts.set(organizationId, count);
  }
  return [...counts.values()];
};
