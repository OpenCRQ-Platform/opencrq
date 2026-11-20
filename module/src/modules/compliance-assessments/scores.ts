import { MATURITY_LEVELS } from './constants';

export interface AnswerState {
  level: number | null,
  notApplicable: boolean,
}

export interface MaturitySummary {
  requirementCount: number,
  /** Answered on a level. */
  answeredCount: number,
  notApplicableCount: number,
  /** Null when nothing is answered, never 0. */
  meanLevel: number | null,
  /** Answer count, indexed by level. */
  distribution: Array<number>,
}

/** Unanswered and not applicable requirements are left out of the mean: progress is what shows them. */
export const summariseMaturity = (
  requirementIds: ReadonlyArray<string>,
  answers: ReadonlyMap<string, AnswerState>,
): MaturitySummary => {
  const distribution = MATURITY_LEVELS.map(() => 0);
  let notApplicableCount = 0;
  let levelSum = 0;
  let answeredCount = 0;
  for (const id of requirementIds) {
    const answer = answers.get(id);
    if (answer?.notApplicable) {
      notApplicableCount += 1;
    } else if (answer && answer.level !== null) {
      answeredCount += 1;
      levelSum += answer.level;
      distribution[answer.level] = (distribution[answer.level] ?? 0) + 1;
    }
  }
  return {
    requirementCount: requirementIds.length,
    answeredCount,
    notApplicableCount,
    meanLevel: answeredCount === 0 ? null : levelSum / answeredCount,
    distribution,
  };
};
