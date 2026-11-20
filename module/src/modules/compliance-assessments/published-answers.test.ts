import { describe, expect, it } from 'vitest';
import type { PublishedAnswerState } from './published-answers';
import { latestPublishedAnswers } from './published-answers';

const T2 = { assessmentId: '0199a000-0000-7000-8000-000000000002', publishedAt: new Date('2026-04-01') };
const T4 = { assessmentId: '0199a000-0000-7000-8000-000000000004', publishedAt: new Date('2026-10-01') };

const state = (
  assessment: { assessmentId: string, publishedAt: Date },
  requirementId: string,
  level: number | null,
  notApplicable = false,
): PublishedAnswerState => ({ ...assessment, requirementId, level, notApplicable });

describe('latestPublishedAnswers', () => {
  it('takes the answer of the most recently published assessment', () => {
    const answers = latestPublishedAnswers([state(T4, 'PR.AA-01', 4), state(T2, 'PR.AA-01', 1)]);
    expect(answers.get('PR.AA-01')?.level).toBe(4);
  });

  it('keeps an earlier answer for a requirement the later assessment left unanswered', () => {
    const answers = latestPublishedAnswers([state(T2, 'PR.AA-01', 2), state(T4, 'PR.AA-01', null)]);
    expect(answers.get('PR.AA-01')?.level).toBe(2);
  });

  it('keeps an earlier answer for a requirement the later assessment holds no row for', () => {
    const answers = latestPublishedAnswers([state(T2, 'PR.AA-01', 2), state(T4, 'PR.AA-03', 3)]);
    expect(answers.get('PR.AA-01')?.level).toBe(2);
    expect(answers.get('PR.AA-03')?.level).toBe(3);
  });

  it('drops a requirement the later assessment marked not applicable', () => {
    const answers = latestPublishedAnswers([state(T2, 'PR.AA-01', 2), state(T4, 'PR.AA-01', null, true)]);
    expect(answers.has('PR.AA-01')).toBe(false);
  });

  it('breaks a tie on publication time by the later assessment id', () => {
    const sameTime = { ...T2, assessmentId: '0199a000-0000-7000-8000-000000000003' };
    const answers = latestPublishedAnswers([state(T2, 'PR.AA-01', 1), state(sameTime, 'PR.AA-01', 3)]);
    expect(answers.get('PR.AA-01')?.level).toBe(3);
  });

  it('names the assessment the feeding answer comes from, an earlier one when the later left it unanswered', () => {
    const answers = latestPublishedAnswers([
      state(T2, 'PR.AA-01', 2),
      state(T4, 'PR.AA-01', null),
      state(T2, 'PR.AA-03', 1),
      state(T4, 'PR.AA-03', 3),
    ]);
    expect(answers.get('PR.AA-01')).toMatchObject({ assessmentId: T2.assessmentId, level: 2 });
    expect(answers.get('PR.AA-03')).toMatchObject({ assessmentId: T4.assessmentId, level: 3 });
  });

  it('keeps the fields the caller passed along', () => {
    const answers = latestPublishedAnswers([{ ...state(T2, 'PR.AA-01', 2), assessmentName: 'Q2 2026' }]);
    expect(answers.get('PR.AA-01')?.assessmentName).toBe('Q2 2026');
  });
});
