import type { FinancialProfileAnswers } from './validation';

export const SECTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type SectionKey = typeof SECTION_KEYS[number];

export const QUESTION_IDS = [
  'Q1', 'Q2', 'Q3',
  'Q5', 'Q6', 'Q7', 'Q8', 'Q16',
  'Q9a', 'Q9b', 'Q9c', 'Q20',
  'Q10',
  'Q11a', 'Q11b', 'Q12', 'Q19',
  'Q13', 'Q14',
  'Q15',
  'Q18',
] as const;
export type QuestionId = typeof QUESTION_IDS[number];

export const SECTION_QUESTIONS: Record<SectionKey, ReadonlyArray<QuestionId>> = {
  A: ['Q1', 'Q2', 'Q3'],
  B: ['Q5', 'Q6', 'Q7', 'Q8', 'Q16'],
  C: ['Q9a', 'Q9b', 'Q9c', 'Q20'],
  D: ['Q10'],
  E: ['Q11a', 'Q11b', 'Q12', 'Q19'],
  F: ['Q13', 'Q14'],
  G: ['Q15'],
  H: ['Q18'],
};

/**
 * A card counts as answered only when every field that is the sole unlock of a driver is set.
 * Q9b and Q9c are not gated on Q9a: payment-card assessments read the card band with no gate
 * dependency, and conditional surfacing would move the progress denominator under the CISO.
 */
export const isQuestionAnswered = (id: QuestionId, values: FinancialProfileAnswers): boolean => {
  switch (id) {
    case 'Q1': return values.annualRevenue !== null;
    case 'Q2': return values.grossMarginPct !== null;
    case 'Q3': return values.operatingDaysBand !== null;
    case 'Q5': return values.itDependentRevenuePct !== null;
    case 'Q6': return values.timeToRevenueImpactBand !== null;
    case 'Q7': return values.fullRestoreBand !== null;
    case 'Q8': return values.revenueRecaptureBand !== null;
    case 'Q16': return values.restoreTestRecency !== null;
    case 'Q9a': return values.recordsHeldGate === false || (values.recordsHeldGate === true && values.individualsBand !== null);
    case 'Q9b': return values.cardTransactionsBand !== null;
    case 'Q9c': return values.sensitiveRecordsBand !== null;
    case 'Q20': return values.largestRepositoryBand !== null;
    case 'Q10': return values.regulatoryRegime !== null;
    case 'Q11a': return values.customerCountBand !== null && values.b2cRevenuePct !== null;
    case 'Q11b': return values.recurringRevenuePct !== null;
    case 'Q12': return values.contractedRevenueBand !== null;
    case 'Q19': return values.contractualLiabilityCapBand !== null;
    case 'Q13': return values.paymentFlowDailyValueBand !== null;
    case 'Q14': return values.rdIpValueBand !== null;
    case 'Q15': return values.ransomPaymentPosture !== null;
    case 'Q18': return values.worstOutageBand !== null && values.costliestIncidentBand !== null;
    default: return false;
  }
};

export interface FinancialProfileProgress {
  answeredCount: number,
  totalCount: number,
}

export const computeProgress = (values: FinancialProfileAnswers): FinancialProfileProgress => ({
  answeredCount: QUESTION_IDS.filter((id) => isQuestionAnswered(id, values)).length,
  totalCount: QUESTION_IDS.length,
});

/** What a collapsed section of the accordion states about itself, so it can be judged unopened. */
export const sectionProgress = (section: SectionKey, values: FinancialProfileAnswers): FinancialProfileProgress => {
  const questions = SECTION_QUESTIONS[section];
  return {
    answeredCount: questions.filter((id) => isQuestionAnswered(id, values)).length,
    totalCount: questions.length,
  };
};
