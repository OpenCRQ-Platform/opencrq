import { describe, expect, it } from 'vitest';
import { answeredPercent, applicableRequirementCount, countControlPosture, testScore, testScoreChange } from './defenses-utils';

describe('countControlPosture', () => {
  it('counts a capability no one assessed apart from the not deployed rung', () => {
    const counts = countControlPosture([
      { strengthRung: 'L0', strengthSource: 'tenant', tenantStrengthRung: null },
      { strengthRung: 'L0', strengthSource: 'tenant', tenantStrengthRung: 'L0' },
      { strengthRung: 'L2', strengthSource: 'tenant', tenantStrengthRung: 'L2' },
      { strengthRung: 'L3', strengthSource: 'tenant', tenantStrengthRung: 'L3' },
    ]);
    expect(counts).toEqual({ capabilityCount: 4, notAssessed: 1, byRung: { L0: 1, L1: 0, L2: 1, L3: 1 } });
  });

  it('puts a capability on the rung its scope override declares', () => {
    const counts = countControlPosture([
      { strengthRung: 'L3', strengthSource: 'scope', tenantStrengthRung: 'L1' },
      { strengthRung: 'L2', strengthSource: 'scope', tenantStrengthRung: null },
    ]);
    expect(counts).toEqual({ capabilityCount: 2, notAssessed: 0, byRung: { L0: 0, L1: 0, L2: 1, L3: 1 } });
  });

  it('adds the rungs and the not assessed up to the capability count', () => {
    const counts = countControlPosture([
      { strengthRung: 'L0', strengthSource: 'tenant', tenantStrengthRung: null },
      { strengthRung: 'L1', strengthSource: 'tenant', tenantStrengthRung: 'L1' },
      { strengthRung: 'L1', strengthSource: 'scope', tenantStrengthRung: null },
    ]);
    const rungTotal = Object.values(counts.byRung).reduce((sum, value) => sum + value, 0);
    expect(rungTotal + counts.notAssessed).toBe(counts.capabilityCount);
  });
});

describe('testScore', () => {
  it('is the share of results that held, out of 100', () => {
    expect(testScore({ held: 418, total: 674 })).toBe(62);
  });

  it('reads no result as not tested rather than 0', () => {
    expect(testScore(null)).toBeNull();
    expect(testScore({ held: 0, total: 0 })).toBeNull();
    expect(testScore({ held: 0, total: 3 })).toBe(0);
  });
});

describe('testScoreChange', () => {
  it('is the difference of the two scores, in points', () => {
    expect(testScoreChange({ held: 62, total: 100 }, { held: 58, total: 100 })).toBe(4);
    expect(testScoreChange({ held: 48, total: 100 }, { held: 51, total: 100 })).toBe(-3);
  });

  it('has no change without a score a month ago', () => {
    expect(testScoreChange({ held: 62, total: 100 }, null)).toBeNull();
  });
});

describe('assessment progress', () => {
  it('reads the answered requirements out of the applicable ones', () => {
    const maturity = { requirementCount: 110, answeredCount: 38, notApplicableCount: 4 };
    expect(applicableRequirementCount(maturity)).toBe(106);
    expect(answeredPercent(maturity)).toBe(36);
  });

  it('reads 0% when nothing is applicable', () => {
    expect(answeredPercent({ requirementCount: 2, answeredCount: 0, notApplicableCount: 2 })).toBe(0);
  });
});
