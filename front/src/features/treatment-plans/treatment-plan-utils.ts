import { i18n } from '@lingui/core';
import type { CoverageBucket, CrqControlWhatIfDimension, StrengthRung, TreatmentPlanStatus } from '@app/module/client';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '@app/module/client';
import { formatDollarChange } from '../../utils/format-currency';
import { toCalendarDate } from '../../utils/date-utils';

export interface PlanScopeRow {
  capabilityId: string,
  currentStrengthRung: StrengthRung,
  currentCoverageBucket: CoverageBucket,
  targetStrengthRung: StrengthRung | null,
  targetCoverageBucket: CoverageBucket | null,
}

export type PlanMoveAxis = 'strength' | 'coverage';

export const PLAN_MOVE_AXES: ReadonlyArray<PlanMoveAxis> = ['strength', 'coverage'];

const axisTarget = (row: PlanScopeRow, axis: PlanMoveAxis): string | null => {
  switch (axis) {
    case 'strength': return row.targetStrengthRung;
    case 'coverage': return row.targetCoverageBucket;
  }
};

export const isAxisAimed = (row: PlanScopeRow, axis: PlanMoveAxis): boolean => axisTarget(row, axis) !== null;

/**
 * Membership is read off the targets rather than stored beside them: a control in the plan with no
 * axis named is a move the API refuses, so the two can never disagree.
 */
export const isInPlan = (row: PlanScopeRow): boolean => PLAN_MOVE_AXES.some((axis) => isAxisAimed(row, axis));

/**
 * The axes of a control read as one row each, so one row carries one target and one decision. A
 * control moving its strength alone is then one aimed row beside unaimed ones rather than a set of
 * slots of which most are empty.
 */
export const planMoveRows = <T extends PlanScopeRow>(rows: Array<T>): Array<T & { id: string, axis: PlanMoveAxis }> =>
  rows.flatMap((row) => PLAN_MOVE_AXES.map((axis) => ({ ...row, axis, id: `${row.capabilityId}:${axis}` })));

export type PlanMoveWarning = 'needs-strength' | 'needs-coverage';

/**
 * A control declared at no strength, or covering nothing, instantiates no edge whatever the other
 * axis says, so a plan that aims one and leaves the other on the floor buys nothing at all. Read
 * on the posture the plan would leave behind, and only on the axis the reader has aimed.
 */
export const planMoveWarning = (row: PlanScopeRow, axis: PlanMoveAxis): PlanMoveWarning | null => {
  if (!isAxisAimed(row, axis)) {
    return null;
  }
  if ((row.targetStrengthRung ?? row.currentStrengthRung) === 'L0') {
    return 'needs-strength';
  }
  if ((row.targetCoverageBucket ?? row.currentCoverageBucket) === 'L0') {
    return 'needs-coverage';
  }
  return null;
};

export interface PlanAxisGains {
  strengthAleReduction: number | null,
  coverageAleReduction: number | null,
  deployAleReduction: number | null,
}

/**
 * What one row's own axis is worth. A control deployed nowhere is priced on its anchor step alone,
 * which moves strength and coverage at once, so both of those rows read that one figure.
 */
export const planAxisGain = (gains: PlanAxisGains, axis: PlanMoveAxis): number | null => {
  switch (axis) {
    case 'strength': return gains.deployAleReduction ?? gains.strengthAleReduction;
    case 'coverage': return gains.deployAleReduction ?? gains.coverageAleReduction;
  }
};

/** Every rung but the declared one, which is what leaving the axis unchanged already says. */
export const targetStrengthOptions = (current: StrengthRung): Array<StrengthRung> =>
  STRENGTH_RUNGS.filter((rung) => rung !== current);

export const targetCoverageOptions = (current: CoverageBucket): Array<CoverageBucket> =>
  COVERAGE_BUCKETS.filter((bucket) => bucket !== current);

export const GAIN_SCORE_MAX = 5;

/** The best one-rung gain the scope offers, which every score below is read against. */
export const bestPlanGain = (gains: Array<number | null>): number | null =>
  gains.reduce<number | null>(
    (best, gain) => (gain !== null && (best === null || gain > best) ? gain : best),
    null,
  );

/**
 * Where a candidate's one-rung gain sits against the best one, out of five.
 *
 * Proportional rather than by rank: the list arrives in rank order, so what a score adds is how far
 * ahead the leader is. A control the runs never priced keeps a null, which is a different claim
 * from a control priced at nothing.
 */
export const planGainScore = (gain: number | null, best: number | null): number | null => {
  if (gain === null) {
    return null;
  }
  if (best === null || best <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(GAIN_SCORE_MAX, (gain / best) * GAIN_SCORE_MAX));
};

/** A full replacement of the plan's set of moves, never a patch of it. */
export const planScopePayload = (rows: Array<PlanScopeRow>) => rows
  .filter(isInPlan)
  .map((row) => ({
    capabilityId: row.capabilityId,
    targetStrengthRung: row.targetStrengthRung,
    targetCoverageBucket: row.targetCoverageBucket,
  }));

export const isPlanScopeDirty = (rows: Array<PlanScopeRow>, initial: Array<PlanScopeRow>): boolean => {
  const before = new Map(initial.map((row) => [row.capabilityId, row]));
  return rows.some((row) => {
    const was = before.get(row.capabilityId);
    if (!was) {
      return isInPlan(row);
    }
    return row.targetStrengthRung !== was.targetStrengthRung
      || row.targetCoverageBucket !== was.targetCoverageBucket;
  });
};

/**
 * A plan's end date against today. Overdue is derived and never stored: a stored copy is wrong the
 * day after it is written. The day is the reader's own, an end date naming a calendar day and no
 * instant, so a UTC reading would move the chip by a few hours either side of midnight.
 */
export const isOverdue = (endDate: string | null, today = new Date()): boolean => {
  if (endDate === null) {
    return false;
  }
  return endDate < toCalendarDate(today);
};

/**
 * A saving reads as a fall in exposure, so a positive reduction prints with a minus. A negative one
 * is a plan that raises the exposure and prints with a plus, rather than as a double negative.
 */
export const formatAleReduction = (value: number): string => formatDollarChange(-value);

// Built per call: a module-level formatter would read the locale before the catalogue activates.
// The unit style, not `style: 'percent'`, since that one divides by 100 and shifts the rounding of a half.
export const formatReturnPercent = (value: number): string =>
  new Intl.NumberFormat(i18n.locale || 'en', { style: 'unit', unit: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value);

/**
 * The sign of the figure as printed, so a return that rounds to 0% is not coloured as a loss or a
 * gain. Rounded half away from zero, as Intl does, where `Math.round` would round -0.5 up to 0.
 */
export const returnPercentSign = (value: number): number =>
  Math.round(Math.abs(value) * 10) === 0 ? 0 : Math.sign(value);

export interface PlanKpiRow {
  status: TreatmentPlanStatus,
  endDate: string | null,
  costYear1: number | null,
  returnPercent: number | null,
}

export interface PlanKpis {
  planCount: number,
  activeCount: number,
  overdueActiveCount: number,
  returnCount: number,
  negativeReturnCount: number,
  activeCostYear1: number,
  totalCostYear1: number,
}

/**
 * ALE reductions are never summed: two plans moving the same control both claim its reduction. A
 * return counts as negative by its printed sign, so the band never counts a plan whose card shows 0%.
 */
export const planKpis = (rows: Array<PlanKpiRow>, today = new Date()): PlanKpis => {
  const active = rows.filter((row) => row.status === 'active');
  const withReturn = rows.flatMap((row) => (row.returnPercent === null ? [] : [row.returnPercent]));
  const sumCost = (plans: Array<PlanKpiRow>): number => plans.reduce((sum, plan) => sum + (plan.costYear1 ?? 0), 0);
  return {
    planCount: rows.length,
    activeCount: active.length,
    overdueActiveCount: active.filter((row) => isOverdue(row.endDate, today)).length,
    returnCount: withReturn.length,
    negativeReturnCount: withReturn.filter((value) => returnPercentSign(value) < 0).length,
    activeCostYear1: sumCost(active),
    totalCostYear1: sumCost(rows),
  };
};

const DAY_MS = 86_400_000;

const calendarDayNumber = (value: string): number => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
};

/**
 * How much of the span from the start date to the due date has passed, in percent, read on the
 * reader's calendar day as `isOverdue` is. Zero when either date is missing.
 */
export const planElapsedPercent = (startDate: string | null, endDate: string | null, today = new Date()): number => {
  if (startDate === null || endDate === null) {
    return 0;
  }
  const start = calendarDayNumber(startDate);
  const end = calendarDayNumber(endDate);
  const now = calendarDayNumber(toCalendarDate(today));
  if (end <= start) {
    return now >= end ? 100 : 0;
  }
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
};

export interface PlanSimulationState {
  toRepriceCount: number,
  runningCount: number,
}

export type ResimulationControl = 'hidden' | 'ready' | 'running';

/**
 * `awaitingRefresh` covers the enqueue and the read of the state it leaves, during which the state on
 * hand still says nothing is running.
 */
export const resimulationControl = (state: PlanSimulationState | null | undefined, awaitingRefresh: boolean): ResimulationControl => {
  if (awaitingRefresh || (state?.runningCount ?? 0) > 0) {
    return 'running';
  }
  return (state?.toRepriceCount ?? 0) > 0 ? 'ready' : 'hidden';
};

/** One lever a scenario's run priced for a control, or the control alone when it carries none. */
export interface PlanLever {
  capabilityId: string,
  dimension: CrqControlWhatIfDimension | null,
  upgradedStrength: StrengthRung | null,
  upgradedCoverage: CoverageBucket | null,
}

export interface PlanLeverPrefill {
  axes: Array<PlanMoveAxis>,
  targetStrengthRung: StrengthRung | null,
  targetCoverageBucket: CoverageBucket | null,
}

const leverAxes = (dimension: CrqControlWhatIfDimension): Array<PlanMoveAxis> => {
  switch (dimension) {
    case 'strength': return ['strength'];
    case 'coverage': return ['coverage'];
    case 'deploy': return ['strength', 'coverage'];
  }
};

/** Two levers of one control make one move. A control with no lever brings every axis in unchanged, for the reader to aim. */
export const leverPrefills = (levers: Array<PlanLever>): Map<string, PlanLeverPrefill> => {
  const byCapability = new Map<string, PlanLeverPrefill>();
  for (const lever of levers) {
    const held = byCapability.get(lever.capabilityId)
      ?? { axes: [], targetStrengthRung: null, targetCoverageBucket: null };
    const moved = lever.dimension === null ? [] : leverAxes(lever.dimension);
    const brought = moved.length === 0 ? PLAN_MOVE_AXES : moved;
    byCapability.set(lever.capabilityId, {
      axes: [...held.axes, ...brought.filter((axis) => !held.axes.includes(axis))],
      targetStrengthRung: moved.includes('strength') ? lever.upgradedStrength : held.targetStrengthRung,
      targetCoverageBucket: moved.includes('coverage') ? lever.upgradedCoverage : held.targetCoverageBucket,
    });
  }
  return byCapability;
};

export type HeldPlanMove = Pick<PlanScopeRow, 'targetStrengthRung' | 'targetCoverageBucket'>;

/**
 * A pre-fill no target menu offers is dropped: the suggestion was priced on a run the posture has
 * since moved onto the suggested rung.
 */
export const prefilledTargets = (row: PlanScopeRow, prefill: PlanLeverPrefill): HeldPlanMove => ({
  targetStrengthRung: prefill.targetStrengthRung === row.currentStrengthRung ? null : prefill.targetStrengthRung,
  targetCoverageBucket: prefill.targetCoverageBucket === row.currentCoverageBucket ? null : prefill.targetCoverageBucket,
});

/** Mirrors the server's merge, which keeps the target on file for every axis an addition leaves unset. */
export const keptPlanTargets = (row: PlanScopeRow, held: HeldPlanMove): HeldPlanMove => ({
  targetStrengthRung: row.targetStrengthRung === null ? held.targetStrengthRung : null,
  targetCoverageBucket: row.targetCoverageBucket === null ? held.targetCoverageBucket : null,
});

export const mergedPlanRow = <T extends PlanScopeRow>(row: T, held: HeldPlanMove | undefined): T => ({
  ...row,
  targetStrengthRung: row.targetStrengthRung ?? held?.targetStrengthRung ?? null,
  targetCoverageBucket: row.targetCoverageBucket ?? held?.targetCoverageBucket ?? null,
});
