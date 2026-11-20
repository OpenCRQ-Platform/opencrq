import type { ScenarioReadinessStatus } from '../risk-scenarios/readiness';

/**
 * What one scenario's latest run says about the plan.
 *
 * - `priced`: the run carries a figure for this plan's current set of moves.
 * - `expired`: it carries one for an earlier set. The figure is kept and dated rather than dropped,
 *   because the alternative leaves the page blank until the next simulation.
 * - `not-priced`: no figure for the plan, either because no run has carried one since the plan last
 *   changed, or because the scenario is not ready to be simulated at all.
 */
export type PlanScenarioState = 'priced' | 'expired' | 'not-priced';

export interface PlanProjectionRow {
  riskScenarioId: string,
  runId: string,
  runCreatedAt: Date,
  aleMean: number | null,
  lefMean: number | null,
  planScopeVersion: number | null,
  aleReductionMean: number | null,
  aleReductionP10: number | null,
  aleReductionP90: number | null,
  /** The run the plan is read from is not the scenario's latest, whose ALE the scenario now shows. */
  olderThanHeadline: boolean,
}

export interface PlanProjectionScenario {
  id: string,
  name: string,
  readinessStatus: ScenarioReadinessStatus,
}

export interface PlanScenarioProjection {
  riskScenarioId: string,
  name: string,
  /** Why a row carries no figure, which the state alone does not say. */
  readinessStatus: ScenarioReadinessStatus,
  state: PlanScenarioState,
  runId: string | null,
  runCreatedAt: Date | null,
  lefMean: number | null,
  /** The run's own annualised loss, which is the baseline every reduction below is measured from. */
  aleMean: number | null,
  /** `aleMean` less the plan's reduction. Null when the run priced no figure for this plan. */
  aleTargetMean: number | null,
  aleReductionMean: number | null,
  aleReductionP10: number | null,
  aleReductionP90: number | null,
  /** False when no figure is shown. */
  olderThanHeadline: boolean,
}

export interface PlanProjection {
  scenarios: Array<PlanScenarioProjection>,
  /** Null when no scenario of the scope carries a figure, which is not the same as zero. */
  totalAleReduction: number | null,
  /** How many of the scope's scenarios the total is made of. */
  pricedScenarioCount: number,
  scopeScenarioCount: number,
  /** True when any figure on the page was priced against an earlier set of moves. */
  expired: boolean,
  /** The simulation the figures come from: the oldest run the total is made of. */
  pricedAt: Date | null,
}

const stateOf = (row: PlanProjectionRow | undefined, scopeVersion: number): PlanScenarioState => {
  if (!row || row.planScopeVersion === null) {
    return 'not-priced';
  }
  return row.planScopeVersion === scopeVersion ? 'priced' : 'expired';
};

/**
 * The plan's before/after over the scenarios of its own scope.
 *
 * `scenarios` holds every scenario of the scope, and one that is not ready holds no figure at all:
 * the last run of a scenario whose inputs moved since describes a scenario that no longer exists,
 * so it is dropped rather than shown as a before and an after.
 */
export const buildPlanProjection = (
  scenarios: Array<PlanProjectionScenario>,
  rows: Array<PlanProjectionRow>,
  scopeVersion: number,
): PlanProjection => {
  const rowByScenario = new Map(rows.map((row) => [row.riskScenarioId, row]));

  const projected: Array<PlanScenarioProjection> = scenarios.map((scenario) => {
    const row = scenario.readinessStatus === 'ready' ? rowByScenario.get(scenario.id) : undefined;
    const state = stateOf(row, scopeVersion);
    const reduction = state === 'not-priced' ? null : row?.aleReductionMean ?? null;
    const aleMean = row?.aleMean ?? null;
    return {
      riskScenarioId: scenario.id,
      name: scenario.name,
      readinessStatus: scenario.readinessStatus,
      state,
      runId: row?.runId ?? null,
      runCreatedAt: row?.runCreatedAt ?? null,
      lefMean: row?.lefMean ?? null,
      aleMean,
      aleTargetMean: aleMean !== null && reduction !== null ? aleMean - reduction : null,
      aleReductionMean: reduction,
      aleReductionP10: state === 'not-priced' ? null : row?.aleReductionP10 ?? null,
      aleReductionP90: state === 'not-priced' ? null : row?.aleReductionP90 ?? null,
      olderThanHeadline: state !== 'not-priced' && (row?.olderThanHeadline ?? false),
    };
  });

  const priced = projected.filter((scenario) => scenario.aleReductionMean !== null);
  const pricedRunDates = priced.map((scenario) => scenario.runCreatedAt).filter((date): date is Date => date !== null);

  return {
    scenarios: projected,
    totalAleReduction: priced.length === 0
      ? null
      : priced.reduce((total, scenario) => total + (scenario.aleReductionMean ?? 0), 0),
    pricedScenarioCount: priced.length,
    scopeScenarioCount: scenarios.length,
    expired: projected.some((scenario) => scenario.state === 'expired'),
    pricedAt: pricedRunDates.length === 0
      ? null
      : pricedRunDates.reduce((oldest, date) => (date < oldest ? date : oldest)),
  };
};

/** The other two statuses wait on the analyst, not on a simulation. */
const SIMULABLE_STATUSES: ReadonlySet<ScenarioReadinessStatus> = new Set(['not-simulated', 'stale', 'ready']);

/** A plan without a move is priced by no run, so no simulation can bring any of its scenarios up to date. */
export const scenariosToReprice = (projection: PlanProjection, hasMoves: boolean): Array<string> => (hasMoves
  ? projection.scenarios
    .filter((scenario) => SIMULABLE_STATUSES.has(scenario.readinessStatus) && (scenario.state !== 'priced' || scenario.olderThanHeadline))
    .map((scenario) => scenario.riskScenarioId)
  : []);

export interface PlanTotalRow {
  planId: string,
  riskScenarioId: string,
  planScopeVersion: number,
  aleReductionMean: number | null,
  runCreatedAt: Date,
}

export interface PlanTotal {
  totalAleReduction: number | null,
  /** At least one of the figures was priced against a set of moves the plan has since changed. */
  expired: boolean,
  /** The latest simulation the total is made of. Null when no scenario carries a figure. */
  pricedAt: Date | null,
}

/**
 * One figure per plan for the list, on both rules the plan's own page follows: a scenario that is
 * not ready carries nothing, its last run describing a scenario that no longer exists, and an
 * expired row keeps its amount and marks the plan rather than emptying a column the reader would
 * read as zero. A list summing what the page drops shows two totals for one plan.
 */
export const summarisePlanTotals = (
  rows: Array<PlanTotalRow>,
  scopeVersionByPlan: Map<string, number>,
  readyScenarioIds: ReadonlySet<string>,
): Map<string, PlanTotal> => {
  const totals = new Map<string, PlanTotal>();
  for (const row of rows) {
    if (!readyScenarioIds.has(row.riskScenarioId)) {
      continue;
    }
    const current = totals.get(row.planId) ?? { totalAleReduction: null, expired: false, pricedAt: null };
    const reduction = row.aleReductionMean;
    if (reduction === null) {
      totals.set(row.planId, current);
      continue;
    }
    totals.set(row.planId, {
      totalAleReduction: (current.totalAleReduction ?? 0) + reduction,
      expired: current.expired || row.planScopeVersion !== scopeVersionByPlan.get(row.planId),
      pricedAt: current.pricedAt === null || row.runCreatedAt > current.pricedAt ? row.runCreatedAt : current.pricedAt,
    });
  }
  return totals;
};
