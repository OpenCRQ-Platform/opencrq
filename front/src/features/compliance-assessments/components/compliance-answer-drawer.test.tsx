/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Shared from '../../../components/shared';
import type { TrpcCall } from '../../../providers/trpc-test-harness';
import type { AnswerDrawerTarget } from './compliance-answer-drawer';
import type { AssessmentAnswer } from './compliance-assessment-types';
import { createTestQueryClient, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ComplianceAnswerDrawer } from './compliance-answer-drawer';

vi.mock('../../../components/shared', async (importOriginal) => ({
  ...await importOriginal<typeof Shared>(),
  OwnerSelect: () => null,
  useFormDrawerNavigationGuard: () => {},
}));

vi.mock('@filigran/ui', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useToast: () => ({ toast: () => {} }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const ASSESSMENT_ID = '00000000-0000-0000-0000-0000000000a1';
const REQUIREMENT_ID = '00000000-0000-0000-0000-0000000000r1';

const ANSWER: AssessmentAnswer = {
  id: '00000000-0000-0000-0000-0000000000b1',
  requirementId: REQUIREMENT_ID,
  owner: null,
  dueDate: null,
  level: 2,
  notApplicable: false,
  comment: 'Loaded',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const target = (answer: AssessmentAnswer): AnswerDrawerTarget => ({
  requirement: {
    id: REQUIREMENT_ID,
    parentId: null,
    code: 'PR.AA-01',
    title: 'Identities are managed',
    kind: 'subcategory',
    isRequirement: true,
    position: 0,
  },
  path: [],
  answer,
  controls: [],
});

const drawer = (answer: AssessmentAnswer) => (
  <ComplianceAnswerDrawer assessmentId={ASSESSMENT_ID} locked={false} target={target(answer)} onClose={() => {}} />
);

const SAVE = 'complianceAssessments.answerRequirement';

const saves = (calls: Array<TrpcCall>) => calls.filter((call) => call.path === SAVE);

const staleWrite = () => TRPCClientError.from({
  error: { message: 'stale write', code: -32009, data: { reason: 'STALE_WRITE' } },
});

/**
 * The server refuses the first save as stale, then accepts. The assessment page holds the stored answers
 * in the cache the drawer refreshes after a refusal, so they are put there before the drawer opens.
 */
const renderStaleDrawer = (stored: AssessmentAnswer) => {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData([['complianceAssessments', 'getAssessment'], { input: { id: ASSESSMENT_ID }, type: 'query' }], { answers: [stored] });
  let attempts = 0;
  return renderWithTrpc(drawer(ANSWER), {
    queryClient,
    answers: {
      [SAVE]: () => {
        attempts += 1;
        if (attempts === 1) {
          throw staleWrite();
        }
        return null;
      },
    },
  });
};

const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });

const comment = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' });

describe('ComplianceAnswerDrawer', () => {
  it('saves against the version the form was filled from, not one refreshed under it', async () => {
    const { rerender, calls } = renderWithTrpc(drawer(ANSWER));
    rerender(drawer({ ...ANSWER, comment: 'Theirs', updatedAt: '2026-10-02T10:00:00.000Z' }));

    fireEvent.change(comment(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]?.input).toMatchObject({ comment: 'Mine', updatedAt: ANSWER.updatedAt });
  });

  it('shows no saved value when the two writers changed different fields', async () => {
    const stored = { ...ANSWER, dueDate: '2026-12-31', updatedAt: '2026-10-02T10:00:00.000Z' };
    const { calls } = renderStaleDrawer(stored);

    fireEvent.change(comment(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.click(saveButton());
    await waitFor(() => expect(saves(calls)).toHaveLength(2));
    expect(screen.queryByRole('note')).toBeNull();
    expect(saves(calls)[1]?.input).toMatchObject({ dueDate: '2026-12-31', comment: 'Mine', updatedAt: stored.updatedAt });
  });

  it('rebases the draft on a stale write and shows the value saved meanwhile on a field both changed', async () => {
    const stored = { ...ANSWER, dueDate: '2026-12-31', comment: 'Theirs', updatedAt: '2026-10-02T10:00:00.000Z' };
    const { calls } = renderStaleDrawer(stored);

    fireEvent.change(comment(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('Theirs');
    expect(comment().value).toBe('Mine');

    fireEvent.click(screen.getByRole('button', { name: 'Use saved value' }));
    expect(comment().value).toBe('Theirs');
    expect(screen.queryByRole('note')).toBeNull();

    fireEvent.change(comment(), { target: { value: 'Mine, having read theirs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(2));
    expect(saves(calls)[1]?.input).toMatchObject({
      dueDate: '2026-12-31',
      comment: 'Mine, having read theirs',
      updatedAt: stored.updatedAt,
    });
  });
});
