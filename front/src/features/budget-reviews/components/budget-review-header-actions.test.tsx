/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BudgetReviewHeaderActions } from './budget-review-header-actions';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof BudgetReviewHeaderActions>[0];

const renderActions = (overrides: Partial<Props> = {}) => {
  const props: Props = {
    status: 'open',
    closeHint: null,
    onEdit: vi.fn(),
    onClose: vi.fn(),
    onReopen: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider i18n={i18n}>
      <BudgetReviewHeaderActions {...props} />
    </I18nProvider>,
  );
  return props;
};

describe('BudgetReviewHeaderActions', () => {
  it('offers to reopen a closed review, and nothing that edits it', () => {
    const props = renderActions({ status: 'closed' });

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(props.onReopen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close the review' })).toBeNull();
  });

  it('offers to edit and close an open review, and not to reopen it', () => {
    const props = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Close the review' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('disables closing while something blocks it', () => {
    renderActions({ closeHint: 'Add at least one budget line before closing.' });

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close the review' }).disabled).toBe(true);
  });
});
