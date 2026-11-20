import { describe, expect, it } from 'vitest';
import { computeProgress, isQuestionAnswered, QUESTION_IDS, SECTION_KEYS, SECTION_QUESTIONS, sectionProgress } from './questionnaire-progress';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS } from './validation';

describe('isQuestionAnswered — sole-unlock rules', () => {
  it('reports Q9a answered when the gate is false, with no individuals band', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, recordsHeldGate: false };
    expect(isQuestionAnswered('Q9a', values)).toBe(true);
  });

  it('reports Q9a unanswered when the gate is true but the individuals band is blank', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, recordsHeldGate: true };
    expect(isQuestionAnswered('Q9a', values)).toBe(false);
  });

  it('reports Q9a answered when the gate is true and the individuals band is set', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, recordsHeldGate: true, individualsBand: '1m_5m' as const };
    expect(isQuestionAnswered('Q9a', values)).toBe(true);
  });

  it('reports Q9b answered from its own band, with no dependency on Q9a', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, cardTransactionsBand: 'none' as const };
    expect(isQuestionAnswered('Q9b', values)).toBe(true);
    expect(isQuestionAnswered('Q9b', EMPTY_FINANCIAL_PROFILE_ANSWERS)).toBe(false);
  });

  it('reports Q9c answered by "none", with no dependency on Q9a', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, sensitiveRecordsBand: 'none' as const };
    expect(isQuestionAnswered('Q9c', values)).toBe(true);
  });

  it('reports Q11a answered only once both the customer band and the B2C share are set', () => {
    expect(isQuestionAnswered('Q11a', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, customerCountBand: 'under_1k' as const })).toBe(false);
    expect(isQuestionAnswered('Q11a', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, b2cRevenuePct: 40 })).toBe(false);
    expect(isQuestionAnswered('Q11a', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, customerCountBand: 'under_1k' as const, b2cRevenuePct: 40 })).toBe(true);
  });

  it('reports Q11b answered from its own share alone', () => {
    expect(isQuestionAnswered('Q11b', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, recurringRevenuePct: 20 })).toBe(true);
  });

  it('reports Q18 answered only once both bands are set', () => {
    expect(isQuestionAnswered('Q18', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, worstOutageBand: 'none' as const })).toBe(false);
    expect(isQuestionAnswered('Q18', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, worstOutageBand: 'none' as const, costliestIncidentBand: 'none' as const })).toBe(true);
  });

  it('reports Q16, Q19 and Q20 answered from their single field', () => {
    expect(isQuestionAnswered('Q16', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, restoreTestRecency: 'never' as const })).toBe(true);
    expect(isQuestionAnswered('Q19', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, contractualLiabilityCapBand: 'no_cap' as const })).toBe(true);
    expect(isQuestionAnswered('Q20', { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, largestRepositoryBand: 'under_100k' as const })).toBe(true);
  });

  it('reports Q13 answered from its primary band, not its secondary gate', () => {
    const gateOnly = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, outOfBandVerificationGate: true };
    expect(isQuestionAnswered('Q13', gateOnly)).toBe(false);
  });
});

describe('progress', () => {
  it('counts answered cards out of the full question set', () => {
    const progress = computeProgress(EMPTY_FINANCIAL_PROFILE_ANSWERS);
    expect(progress).toEqual({ answeredCount: 0, totalCount: 21 });
  });
});

describe('section progress', () => {
  it('splits the question set across the sections without losing one', () => {
    expect(SECTION_KEYS.flatMap((section) => SECTION_QUESTIONS[section])).toEqual([...QUESTION_IDS]);
    expect(SECTION_KEYS.reduce((total, section) => total + sectionProgress(section, EMPTY_FINANCIAL_PROFILE_ANSWERS).totalCount, 0)).toBe(QUESTION_IDS.length);
  });

  it('counts a section from its own answers only', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, annualRevenue: 1_000_000, grossMarginPct: 40, regulatoryRegime: 'none' as const };
    expect(sectionProgress('A', values)).toEqual({ answeredCount: 2, totalCount: 3 });
    expect(sectionProgress('D', values)).toEqual({ answeredCount: 1, totalCount: 1 });
    expect(sectionProgress('B', values)).toEqual({ answeredCount: 0, totalCount: 5 });
  });
});
