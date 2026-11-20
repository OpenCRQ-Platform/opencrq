/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Shared from '../../../components/shared';
import type { TrpcCall } from '../../../providers/trpc-test-harness';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { BudgetReviewEditDrawer } from './budget-review-edit-drawer';

vi.mock('../../../components/shared', async (importOriginal) => ({
  ...await importOriginal<typeof Shared>(),
  OwnerSelect: () => null,
}));

vi.mock('../ui/fiscal-year-start-fields', () => ({
  FiscalYearStartFields: ({ year, month, onChange }: { year: number, month: number, onChange: (year: number, month: number) => void }) => (
    <>
      <button type="button" onClick={() => onChange(year, month + 1)}>Next month</button>
      <button type="button" onClick={() => onChange(year, month - 1)}>Previous month</button>
    </>
  ),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const REVIEW = {
  id: '00000000-0000-0000-0000-0000000000b1',
  name: 'Fiscal year 2025-2026',
  ownerId: null,
  context: null,
  periodStart: '2025-04-01',
};

const drawer = (review: typeof REVIEW) => <BudgetReviewEditDrawer open onOpenChange={() => {}} review={review} />;

const renderDrawer = () => renderWithTrpc(drawer(REVIEW));

const saves = (calls: Array<TrpcCall>) => calls.filter((call) => call.path === 'budgetReviews.updateBudgetReview');

const NOTICE = /the figures will have to be re-simulated/;

describe('BudgetReviewEditDrawer', () => {
  it('warns only while the chosen period differs from the stored one', () => {
    renderDrawer();
    expect(screen.queryByText(NOTICE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText(NOTICE).textContent).toContain('2026');

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('sends the period start only when it moved', async () => {
    const { calls } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]?.input).toEqual({ id: REVIEW.id, values: { name: REVIEW.name, ownerId: null, context: null } });

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(2));
    expect(saves(calls)[1]?.input).toEqual({
      id: REVIEW.id,
      values: { name: REVIEW.name, ownerId: null, context: null, periodStart: '2025-05-01' },
    });
  });

  it('leaves the period alone when the review moves elsewhere while the form is untouched', async () => {
    const { rerender, calls } = renderDrawer();
    rerender(drawer({ ...REVIEW, periodStart: '2025-07-01' }));

    expect(screen.queryByText(NOTICE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]?.input).toEqual({ id: REVIEW.id, values: { name: REVIEW.name, ownerId: null, context: null } });
  });
});
