/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BudgetReviewIdentityCard } from './budget-review-identity-card';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: ({ children }: { children: ReactNode }) => createElement('a', { href: '#' }, children),
  };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof BudgetReviewIdentityCard>[0];

const review = (overrides: Partial<Props['review']> = {}): Props['review'] => ({
  organizationId: '00000000-0000-0000-0000-0000000000a1',
  organization: { id: '00000000-0000-0000-0000-0000000000a1', name: 'Acme Bank' },
  owner: { id: '00000000-0000-0000-0000-0000000000a2', name: 'Alice Martin' },
  periodStart: '2025-11-01',
  periodEnd: '2026-10-31',
  closedAt: null,
  context: 'Security budget of the payment platform.',
  ...overrides,
});

const renderCard = (props: Partial<Props> = {}) => render(
  createElement(BudgetReviewIdentityCard, { review: review(), pricedAt: '2026-10-06T20:18:00.000Z', ...props }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

describe('BudgetReviewIdentityCard', () => {
  it('titles the card inside it and names the scope, the owner, the period and the context', () => {
    renderCard();

    expect(screen.getByRole('heading', { level: 2, name: 'Identity' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Acme Bank' })).toBeTruthy();
    expect(screen.getByText('Alice Martin')).toBeTruthy();
    expect(screen.getByText(/^Nov 1, 2025 to Oct 31, 2026$/)).toBeTruthy();
    expect(screen.getByText('Security budget of the payment platform.')).toBeTruthy();
  });

  it('says when an open review was priced, and nothing of a closing', () => {
    renderCard();

    expect(screen.getByText('Priced on')).toBeTruthy();
    expect(screen.queryByText('Closed on')).toBeNull();
  });

  it('says when a closed review was closed instead of when it was priced', () => {
    renderCard({ review: review({ closedAt: '2026-11-19T10:00:00.000Z' }) });

    expect(screen.getByText('Closed on')).toBeTruthy();
    expect(screen.getByText('Nov 19, 2026')).toBeTruthy();
    expect(screen.queryByText('Priced on')).toBeNull();
  });

  it('marks a review never priced with an empty value', () => {
    renderCard({ pricedAt: null });

    expect(screen.getByText('Priced on').nextElementSibling?.textContent).toBe('-');
  });
});
