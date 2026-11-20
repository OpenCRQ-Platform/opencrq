import type { StrengthRung } from '@app/module/client';

export interface ControlPostureCounts {
  capabilityCount: number,
  notAssessed: number,
  byRung: Record<StrengthRung, number>,
}

interface ResolvedRung {
  strengthRung: StrengthRung,
  strengthSource: 'tenant' | 'scope',
  tenantStrengthRung: StrengthRung | null,
}

/** A capability no one assessed resolves to `L0`: it counts as not assessed, never as not deployed. */
export const countControlPosture = (postures: ReadonlyArray<ResolvedRung>): ControlPostureCounts => {
  const byRung: Record<StrengthRung, number> = { L0: 0, L1: 0, L2: 0, L3: 0 };
  let notAssessed = 0;
  for (const posture of postures) {
    if (posture.strengthSource === 'tenant' && posture.tenantStrengthRung === null) {
      notAssessed += 1;
    } else {
      byRung[posture.strengthRung] += 1;
    }
  }
  return { capabilityCount: postures.length, notAssessed, byRung };
};

export interface TestTally {
  held: number,
  total: number,
}

/** `null` without a result: not tested, never a score of 0. */
export const testScore = (tally: TestTally | null): number | null =>
  (tally === null || tally.total === 0 ? null : Math.round((tally.held / tally.total) * 100));

export const testScoreChange = (current: TestTally | null, previous: TestTally | null): number | null => {
  const now = testScore(current);
  const then = testScore(previous);
  return now === null || then === null ? null : now - then;
};

export interface AssessmentProgressCounts {
  requirementCount: number,
  answeredCount: number,
  notApplicableCount: number,
}

export const applicableRequirementCount = (maturity: AssessmentProgressCounts): number =>
  maturity.requirementCount - maturity.notApplicableCount;

export const answeredPercent = (maturity: AssessmentProgressCounts): number => {
  const applicable = applicableRequirementCount(maturity);
  return applicable <= 0 ? 0 : Math.round((maturity.answeredCount / applicable) * 100);
};
