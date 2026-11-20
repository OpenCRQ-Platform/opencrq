import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanKpiRow, PlanLever, PlanScopeRow } from './treatment-plan-utils';
import {
  bestPlanGain,
  formatAleReduction,
  formatReturnPercent,
  isAxisAimed,
  isInPlan,
  isOverdue,
  isPlanScopeDirty,
  keptPlanTargets,
  leverPrefills,
  mergedPlanRow,
  planAxisGain,
  planElapsedPercent,
  planGainScore,
  planKpis,
  planMoveRows,
  planMoveWarning,
  planScopePayload,
  prefilledTargets,
  resimulationControl,
  returnPercentSign,
  targetCoverageOptions,
  targetStrengthOptions,
} from './treatment-plan-utils';

const row = (overrides: Partial<PlanScopeRow> = {}): PlanScopeRow => ({
  capabilityId: 'a',
  currentStrengthRung: 'L1',
  currentCoverageBucket: 'L1',
  targetStrengthRung: null,
  targetCoverageBucket: null,
  ...overrides,
});

const NO_TARGETS = { targetStrengthRung: null, targetCoverageBucket: null };

describe('targetStrengthOptions', () => {
  it('should offer every rung but the declared one, below it included', () => {
    expect(targetStrengthOptions('L2')).toEqual(['L0', 'L1', 'L3']);
  });

  it('should still have somewhere to go from the top rung', () => {
    expect(targetStrengthOptions('L3')).toEqual(['L0', 'L1', 'L2']);
  });
});

describe('targetCoverageOptions', () => {
  it('should offer every bucket but the declared one, below it included', () => {
    expect(targetCoverageOptions('L2')).toEqual(['L0', 'L1', 'L3']);
  });

  it('should still have somewhere to go from full coverage', () => {
    expect(targetCoverageOptions('L3')).toEqual(['L0', 'L1', 'L2']);
  });
});

describe('planMoveRows', () => {
  it('should read a control as its two axes, each under an id of its own', () => {
    expect(planMoveRows([row({ capabilityId: 'mfa' })])).toEqual([
      { ...row({ capabilityId: 'mfa' }), axis: 'strength', id: 'mfa:strength' },
      { ...row({ capabilityId: 'mfa' }), axis: 'coverage', id: 'mfa:coverage' },
    ]);
  });

  it('should keep the axes of a control together, in the order the controls arrived', () => {
    const rows = planMoveRows([row({ capabilityId: 'a' }), row({ capabilityId: 'b' })]);
    expect(rows.map((entry) => entry.id))
      .toEqual(['a:strength', 'a:coverage', 'b:strength', 'b:coverage']);
  });
});

describe('isAxisAimed', () => {
  it('should read each axis on its own', () => {
    const moved = row({ targetCoverageBucket: 'L2' });
    expect(isAxisAimed(moved, 'strength')).toBe(false);
    expect(isAxisAimed(moved, 'coverage')).toBe(true);
  });
});

describe('planMoveWarning', () => {
  const undeployed = { currentStrengthRung: 'L0' as const, currentCoverageBucket: 'L0' as const };

  it('should say nothing about an axis the reader has not aimed', () => {
    expect(planMoveWarning(row({ ...undeployed, targetStrengthRung: 'L1' }), 'coverage')).toBeNull();
  });

  it('should warn the aimed axis when the posture would still cover nothing', () => {
    expect(planMoveWarning(row({ ...undeployed, targetStrengthRung: 'L1' }), 'strength')).toBe('needs-coverage');
  });

  it('should warn the aimed axis when the posture would still declare no strength', () => {
    expect(planMoveWarning(row({ ...undeployed, targetCoverageBucket: 'L2' }), 'coverage')).toBe('needs-strength');
  });

  it('should hold its peace once both axes leave the floor', () => {
    const moved = row({ ...undeployed, targetStrengthRung: 'L1', targetCoverageBucket: 'L2' });
    expect(planMoveWarning(moved, 'strength')).toBeNull();
    expect(planMoveWarning(moved, 'coverage')).toBeNull();
  });

  it('should warn a control the plan aims back down onto the floor', () => {
    expect(planMoveWarning(row({ targetCoverageBucket: 'L0' }), 'coverage')).toBe('needs-coverage');
  });
});

describe('planAxisGain', () => {
  const gains = { strengthAleReduction: 500, coverageAleReduction: 900, deployAleReduction: null };

  it('should read each axis against its own lever', () => {
    expect(planAxisGain(gains, 'strength')).toBe(500);
    expect(planAxisGain(gains, 'coverage')).toBe(900);
  });

  it('should leave an axis the run never priced apart from one priced at zero', () => {
    expect(planAxisGain({ ...gains, strengthAleReduction: null }, 'strength')).toBeNull();
    expect(planAxisGain({ ...gains, strengthAleReduction: 0 }, 'strength')).toBe(0);
  });

  it('should read strength and coverage of a control deployed nowhere against its anchor step', () => {
    const anchored = { strengthAleReduction: null, coverageAleReduction: null, deployAleReduction: 456 };
    expect(planAxisGain(anchored, 'strength')).toBe(456);
    expect(planAxisGain(anchored, 'coverage')).toBe(456);
  });
});

describe('isInPlan', () => {
  it('should hold a control aiming at any axis', () => {
    expect(isInPlan(row({ targetStrengthRung: 'L2' }))).toBe(true);
    expect(isInPlan(row({ targetCoverageBucket: 'L3' }))).toBe(true);
  });

  it('should drop a control aiming at none', () => {
    expect(isInPlan(row())).toBe(false);
  });
});

describe('bestPlanGain', () => {
  it('should take the largest gain and ignore the controls no run priced', () => {
    expect(bestPlanGain([null, 1_200, null, 900])).toBe(1_200);
  });

  it('should have no best when no candidate was priced', () => {
    expect(bestPlanGain([null, null])).toBeNull();
  });
});

describe('planGainScore', () => {
  it('should give the best candidate the full rating and the others their share of it', () => {
    expect(planGainScore(1_000, 1_000)).toBe(5);
    expect(planGainScore(500, 1_000)).toBe(2.5);
  });

  it('should keep a control no run priced apart from one priced at nothing', () => {
    expect(planGainScore(null, 1_000)).toBeNull();
    expect(planGainScore(0, 1_000)).toBe(0);
  });

  it('should floor a control whose upgrade would raise the exposure', () => {
    expect(planGainScore(-400, 1_000)).toBe(0);
  });

  it('should rate nothing when no candidate is worth anything', () => {
    expect(planGainScore(0, 0)).toBe(0);
    expect(planGainScore(120, null)).toBe(0);
  });
});

describe('planScopePayload', () => {
  it('should carry the aimed controls and their targets, and nothing else', () => {
    const rows = [
      row({ capabilityId: 'a', targetStrengthRung: 'L2' }),
      row({ capabilityId: 'b' }),
      row({ capabilityId: 'c', targetCoverageBucket: 'L3' }),
    ];

    expect(planScopePayload(rows)).toEqual([
      { capabilityId: 'a', targetStrengthRung: 'L2', targetCoverageBucket: null },
      { capabilityId: 'c', targetStrengthRung: null, targetCoverageBucket: 'L3' },
    ]);
  });
});

describe('isPlanScopeDirty', () => {
  const initial = [
    row({ capabilityId: 'a', targetStrengthRung: 'L2' }),
    row({ capabilityId: 'b' }),
  ];

  it('should be quiet when nothing moved', () => {
    expect(isPlanScopeDirty(initial, initial)).toBe(false);
  });

  it('should see a control added', () => {
    const rows = [initial[0], row({ capabilityId: 'b', targetStrengthRung: 'L3' })];

    expect(isPlanScopeDirty(rows, initial)).toBe(true);
  });

  it('should see a control removed', () => {
    const rows = [row({ capabilityId: 'a' }), initial[1]];

    expect(isPlanScopeDirty(rows, initial)).toBe(true);
  });

  it('should see a target changed on a control that stays in the plan', () => {
    const rows = [row({ capabilityId: 'a', targetStrengthRung: 'L3' }), initial[1]];

    expect(isPlanScopeDirty(rows, initial)).toBe(true);
  });

  it('should see the second axis added to a control already in the plan', () => {
    const rows = [row({ capabilityId: 'a', targetStrengthRung: 'L2', targetCoverageBucket: 'L3' }), initial[1]];

    expect(isPlanScopeDirty(rows, initial)).toBe(true);
  });
});

describe('isOverdue', () => {
  const today = new Date('2026-09-20T12:00:00Z');

  it('should be false without an end date', () => {
    expect(isOverdue(null, today)).toBe(false);
  });

  it('should be false on the day the plan is due', () => {
    expect(isOverdue('2026-09-20', today)).toBe(false);
  });

  it('should be true the day after', () => {
    expect(isOverdue('2026-09-19', today)).toBe(true);
  });

  // The day is the reader's own. Both cases pass either way under TZ=UTC, which is what the
  // pipeline runs, and separate a local reading from a UTC one anywhere else.
  it('should be false late on the due day, whatever the reader offset from UTC', () => {
    expect(isOverdue('2026-09-20', new Date(2026, 8, 20, 23, 30))).toBe(false);
  });

  it('should be true just past midnight on the day after, whatever the reader offset from UTC', () => {
    expect(isOverdue('2026-09-20', new Date(2026, 8, 21, 0, 30))).toBe(true);
  });
});

describe('formatAleReduction', () => {
  it('should print a saving as a fall in exposure', () => {
    expect(formatAleReduction(486_000)).toBe('−$486K');
  });

  it('should print a plan that raises the exposure with a plus', () => {
    expect(formatAleReduction(-12_000)).toBe('+$12K');
  });
});

describe('formatReturnPercent', () => {
  it('should sign a gain', () => {
    expect(formatReturnPercent(211.538)).toBe('+211.5%');
  });

  it('should sign a loss', () => {
    expect(formatReturnPercent(-17.5)).toBe('-17.5%');
  });

  it('should leave a plan that exactly earns its cost back unsigned', () => {
    expect(formatReturnPercent(0)).toBe('0%');
  });

  it('should drop a fraction the figure does not need', () => {
    expect(formatReturnPercent(46)).toBe('+46%');
  });

  it('should round a half away from zero, as returnPercentSign reads it', () => {
    expect(formatReturnPercent(-399.65)).toBe('-399.7%');
    expect(formatReturnPercent(0.05)).toBe('+0.1%');
  });

  describe('in French', () => {
    afterEach(() => {
      i18n.activate('en');
    });

    it('should use the decimal separator and the percent spacing of the application language', () => {
      i18n.load('fr', {});
      i18n.activate('fr');
      expect(formatReturnPercent(211.538)).toBe('+211,5 %');
      expect(formatReturnPercent(-17.5)).toBe('-17,5 %');
    });
  });
});

describe('returnPercentSign', () => {
  it('should read a return that prints as 0% as neither a gain nor a loss', () => {
    expect(returnPercentSign(-0.03)).toBe(0);
    expect(returnPercentSign(0.04)).toBe(0);
  });

  it('should follow the sign once the printed figure carries one', () => {
    expect(returnPercentSign(-0.05)).toBe(-1);
    expect(returnPercentSign(0.05)).toBe(1);
  });
});

describe('resimulationControl', () => {
  it('should offer the re-simulation while a scenario is stale and none is running', () => {
    expect(resimulationControl({ toRepriceCount: 2, runningCount: 0 }, false)).toBe('ready');
  });

  it('should show a run in flight whoever started it, stale scenarios or not', () => {
    expect(resimulationControl({ toRepriceCount: 0, runningCount: 1 }, false)).toBe('running');
    expect(resimulationControl({ toRepriceCount: 2, runningCount: 1 }, false)).toBe('running');
  });

  it('should keep running until the state is read again after the enqueue', () => {
    expect(resimulationControl({ toRepriceCount: 2, runningCount: 0 }, true)).toBe('running');
  });

  it('should hide the control when every scenario is current and none is running', () => {
    expect(resimulationControl({ toRepriceCount: 0, runningCount: 0 }, false)).toBe('hidden');
  });

  it('should hide the control while the state has not loaded', () => {
    expect(resimulationControl(undefined, false)).toBe('hidden');
    expect(resimulationControl(null, false)).toBe('hidden');
  });
});

describe('leverPrefills', () => {
  const lever = (overrides: Partial<PlanLever> = {}): PlanLever => ({
    capabilityId: 'a',
    dimension: 'strength',
    upgradedStrength: 'L2',
    upgradedCoverage: 'L1',
    ...overrides,
  });

  it('should bring the one axis a strength lever moves, pre-filled with its upgrade', () => {
    expect(leverPrefills([lever()]).get('a')).toEqual({ ...NO_TARGETS, axes: ['strength'], targetStrengthRung: 'L2' });
  });

  it('should bring both axes of a deploy lever, each pre-filled', () => {
    expect(leverPrefills([lever({ dimension: 'deploy', upgradedStrength: 'L1', upgradedCoverage: 'L1' })]).get('a'))
      .toEqual({ ...NO_TARGETS, axes: ['strength', 'coverage'], targetStrengthRung: 'L1', targetCoverageBucket: 'L1' });
  });

  it('should make one move of two levers of the same control', () => {
    const prefills = leverPrefills([lever(), lever({ dimension: 'coverage', upgradedStrength: 'L1', upgradedCoverage: 'L2' })]);

    expect(prefills.size).toBe(1);
    expect(prefills.get('a')).toEqual({ ...NO_TARGETS, axes: ['strength', 'coverage'], targetStrengthRung: 'L2', targetCoverageBucket: 'L2' });
  });

  it('should bring every axis unchanged for a control with no lever', () => {
    expect(leverPrefills([lever({ dimension: null })]).get('a'))
      .toEqual({ ...NO_TARGETS, axes: ['strength', 'coverage'] });
  });
});

describe('prefilledTargets', () => {
  it('should drop a suggested upgrade the scope already stands at', () => {
    expect(prefilledTargets(row({ currentStrengthRung: 'L2' }), { ...NO_TARGETS, axes: ['strength'], targetStrengthRung: 'L2' }))
      .toEqual(NO_TARGETS);
  });

  it('should keep a suggested upgrade that moves the posture', () => {
    expect(prefilledTargets(row(), { ...NO_TARGETS, axes: ['strength'], targetStrengthRung: 'L2' }))
      .toEqual({ ...NO_TARGETS, targetStrengthRung: 'L2' });
  });
});

describe('keptPlanTargets', () => {
  it('should keep the target on file for every axis the addition leaves unset', () => {
    expect(keptPlanTargets(row({ targetStrengthRung: 'L3' }), { targetStrengthRung: 'L2', targetCoverageBucket: 'L3' }))
      .toEqual({ targetStrengthRung: null, targetCoverageBucket: 'L3' });
  });

  it('should keep nothing when the addition sets every axis', () => {
    expect(keptPlanTargets(
      row({ targetStrengthRung: 'L3', targetCoverageBucket: 'L2' }),
      { targetStrengthRung: 'L2', targetCoverageBucket: 'L3' },
    )).toEqual(NO_TARGETS);
  });
});

describe('mergedPlanRow', () => {
  it('should read the posture the plan holds once the addition is merged', () => {
    expect(mergedPlanRow(row({ targetCoverageBucket: 'L2' }), { targetStrengthRung: 'L2', targetCoverageBucket: 'L3' }))
      .toMatchObject({ targetStrengthRung: 'L2', targetCoverageBucket: 'L2' });
  });

  it('should leave a control the plan does not hold as the drawer aims it', () => {
    expect(mergedPlanRow(row({ targetStrengthRung: 'L3' }), undefined))
      .toMatchObject({ targetStrengthRung: 'L3', targetCoverageBucket: null });
  });
});

const kpiRow = (overrides: Partial<PlanKpiRow> = {}): PlanKpiRow => ({
  status: 'active',
  endDate: null,
  costYear1: null,
  returnPercent: null,
  ...overrides,
});

describe('planKpis', () => {
  const today = new Date(2026, 9, 4);

  it('should count the active plans out of every plan of the list', () => {
    const kpis = planKpis([kpiRow(), kpiRow({ status: 'draft' }), kpiRow({ status: 'completed' })], today);

    expect(kpis.activeCount).toBe(1);
    expect(kpis.planCount).toBe(3);
  });

  it('should count as overdue only the active plans whose due date has passed', () => {
    const kpis = planKpis([
      kpiRow({ endDate: '2026-10-03' }),
      kpiRow({ endDate: '2026-10-04' }),
      kpiRow({ status: 'draft', endDate: '2020-01-01' }),
      kpiRow({ status: 'completed', endDate: '2020-01-01' }),
    ], today);

    expect(kpis.overdueActiveCount).toBe(1);
    expect(kpis.activeCount).toBe(2);
  });

  it('should count the negative returns out of the plans that have one', () => {
    const kpis = planKpis([
      kpiRow({ returnPercent: -17.5 }),
      kpiRow({ returnPercent: 212 }),
      kpiRow({ returnPercent: -0.04 }),
      kpiRow({ returnPercent: null }),
    ], today);

    expect(kpis.negativeReturnCount).toBe(1);
    expect(kpis.returnCount).toBe(3);
  });

  it('should sum the first-year cost of the active plans, and of every plan for the subtitle', () => {
    const kpis = planKpis([
      kpiRow({ costYear1: 156_000 }),
      kpiRow({ costYear1: 240_000 }),
      kpiRow({ costYear1: null }),
      kpiRow({ status: 'draft', costYear1: 92_000 }),
      kpiRow({ status: 'abandoned', costYear1: 92_000 }),
    ], today);

    expect(kpis.activeCostYear1).toBe(396_000);
    expect(kpis.totalCostYear1).toBe(580_000);
  });

  it('should state zero everywhere on an empty list', () => {
    expect(planKpis([], today)).toEqual({
      planCount: 0,
      activeCount: 0,
      overdueActiveCount: 0,
      returnCount: 0,
      negativeReturnCount: 0,
      activeCostYear1: 0,
      totalCostYear1: 0,
    });
  });
});

describe('planElapsedPercent', () => {
  const today = new Date(2026, 9, 4);

  it('should read the share of the span from the start date to the due date already past', () => {
    expect(planElapsedPercent('2026-10-01', '2026-10-07', today)).toBe(50);
  });

  it('should stay within the bar before the start and after the due date', () => {
    expect(planElapsedPercent('2026-11-01', '2026-12-01', today)).toBe(0);
    expect(planElapsedPercent('2026-01-01', '2026-03-01', today)).toBe(100);
  });

  it('should draw nothing when a date is missing', () => {
    expect(planElapsedPercent(null, '2026-12-01', today)).toBe(0);
    expect(planElapsedPercent('2026-01-01', null, today)).toBe(0);
  });

  it('should fill the bar of a plan due the day it starts once that day is reached', () => {
    expect(planElapsedPercent('2026-10-04', '2026-10-04', today)).toBe(100);
    expect(planElapsedPercent('2026-10-05', '2026-10-05', today)).toBe(0);
  });
});
