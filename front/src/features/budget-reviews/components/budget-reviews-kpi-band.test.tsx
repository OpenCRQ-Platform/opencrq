/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReviewKpiFigures, ReviewKpiRow, ToleranceScopeCount } from '../budget-review-kpi-utils';
import { BudgetReviewsKpiBand } from './budget-reviews-kpi-band';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const figures = (overrides: Partial<ReviewKpiFigures> = {}): ReviewKpiFigures => ({
  spent: 0,
  aleReductionMean: null,
  aleReductionP10: null,
  aleReductionP90: null,
  returnPercent: null,
  state: 'priced',
  ...overrides,
});

const review = (
  overrides: Partial<ReviewKpiFigures> & Partial<Pick<ReviewKpiRow, 'organizationId' | 'name' | 'periodStart' | 'lineCount'>> = {},
  build: Partial<ReviewKpiFigures> = {},
): ReviewKpiRow => {
  const { organizationId, name, periodStart, lineCount, ...rest } = overrides;
  return {
    ...figures(rest),
    organizationId: organizationId ?? 'scope-a',
    name: name ?? 'Fiscal year 2026',
    periodStart: periodStart ?? '2026-01-01',
    lineCount: lineCount ?? 1,
    build: figures(build),
  };
};

const count = (organizationId: string, assessed: number, outside: number): ToleranceScopeCount => ({ organizationId, assessed, outside });

const renderBand = (props: Parameters<typeof BudgetReviewsKpiBand>[0]) => render(
  createElement(BudgetReviewsKpiBand, props),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

const card = (label: string) => {
  const element = screen.getByText(label).closest('[class*="min-w-0"]');
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No card labelled ${label}`);
  }
  return within(element);
};

describe('BudgetReviewsKpiBand, in a risk scope', () => {
  const latest = review(
    { name: 'Fiscal year 2026', periodStart: '2026-01-01', spent: 1_300_000, aleReductionMean: 5_400_000, aleReductionP10: 3_700_000, aleReductionP90: 7_500_000 },
    { spent: 400_000, aleReductionMean: 1_300_000, aleReductionP10: 900_000, aleReductionP90: 1_800_000, returnPercent: 225 },
  );
  const previous = review({ name: 'Fiscal year 2025', periodStart: '2025-01-01', spent: 1_100_000, aleReductionMean: 3_900_000 });

  it('should state the four figures of the latest review', () => {
    renderBand({ reviews: [previous, latest], toleranceCounts: [count('scope-a', 2, 1)], tenantWide: false });

    expect(card('Outside tolerance').getByText('1')).toBeTruthy();
    expect(card('Outside tolerance').getByText('out of 2 scenarios')).toBeTruthy();
    expect(card('Loss avoided per year').getByText('$5.4M')).toBeTruthy();
    expect(card('Loss avoided per year').getByText('Fiscal year 2026, $3.7M to $7.5M')).toBeTruthy();
    expect(card('Build return').getByText('+225%')).toBeTruthy();
    expect(card('Build return').getByText('Prudent (p10): +125%')).toBeTruthy();
    expect(card('Spent').getByText('$1.3M')).toBeTruthy();
    expect(card('Spent').getByText('including $400K of build work')).toBeTruthy();
  });

  it('should compare the loss avoided with the previous review of the scope', () => {
    renderBand({ reviews: [latest, previous], toleranceCounts: [], tenantWide: false });

    expect(screen.getByText('+38.5% on Fiscal year 2025')).toBeTruthy();
  });

  it('should show no trend with a single review, and say when no risk tolerance is set', () => {
    renderBand({ reviews: [latest], toleranceCounts: [], tenantWide: false });

    expect(screen.queryByText(/ on Fiscal year/)).toBeNull();
    expect(screen.getByText('No risk tolerance is set on this scope.')).toBeTruthy();
  });

  it('should print a dash for a figure that is not priced, and keep the review name', () => {
    renderBand({
      reviews: [review({ name: 'Fiscal year 2026', aleReductionMean: null, state: 'not-priced' })],
      toleranceCounts: [],
      tenantWide: false,
    });

    expect(card('Loss avoided per year').getByText('-')).toBeTruthy();
    expect(card('Loss avoided per year').getByText('Fiscal year 2026')).toBeTruthy();
    expect(card('Loss avoided per year').getByText('Not priced')).toBeTruthy();
    expect(card('Build return').getByText('-')).toBeTruthy();
  });

  it('should show a loss that grew as a rise, not as a saving', () => {
    renderBand({ reviews: [review({ aleReductionMean: -50_000 })], toleranceCounts: [], tenantWide: false });

    expect(card('Loss avoided per year').getByText('$50K')).toBeTruthy();
    expect(card('Loss avoided per year').queryByText('+$50K')).toBeNull();
    expect(card('Loss avoided per year').getByText('$50K').closest('span')?.className).toContain('text-red');
  });

  it('should keep the year under way over an empty review opened early for the next one', () => {
    renderBand({
      reviews: [previous, latest, review({ name: 'Fiscal year 2027', periodStart: '2027-01-01', lineCount: 0, aleReductionMean: null, state: 'not-priced' })],
      toleranceCounts: [],
      tenantWide: false,
    });

    expect(card('Loss avoided per year').getByText('Fiscal year 2026, $3.7M to $7.5M')).toBeTruthy();
    expect(screen.getByText('+38.5% on Fiscal year 2025')).toBeTruthy();
  });

  it('should mark an expired figure instead of a trend', () => {
    renderBand({ reviews: [{ ...latest, state: 'expired' }, previous], toleranceCounts: [], tenantWide: false });

    expect(card('Loss avoided per year').getByText('Expired')).toBeTruthy();
    expect(screen.queryByText(/ on Fiscal year/)).toBeNull();
  });

  it('should show skeletons while the reviews load, and the tolerance card alone while its scenarios do', () => {
    const { container, unmount } = renderBand({ reviews: undefined, toleranceCounts: undefined, tenantWide: false });
    expect(screen.queryByText('Spent')).toBeNull();
    expect(container.querySelectorAll('[class*="h-[138px]"]')).toHaveLength(4);
    unmount();

    const loaded = renderBand({ reviews: [latest], toleranceCounts: undefined, tenantWide: false });
    expect(loaded.container.querySelectorAll('[class*="h-[138px]"]')).toHaveLength(1);
    expect(screen.getByText('Spent')).toBeTruthy();
  });

  it('should print a dash for the tolerance count when the scenarios could not be read', () => {
    renderBand({ reviews: [latest], toleranceCounts: null, tenantWide: false });

    expect(card('Outside tolerance').getByText('-')).toBeTruthy();
  });
});

describe('BudgetReviewsKpiBand, across every risk scope', () => {
  const reviews = [
    review({ organizationId: 'scope-a', periodStart: '2025-01-01', spent: 900_000, aleReductionMean: 9_000_000 }),
    review(
      { organizationId: 'scope-a', periodStart: '2026-01-01', spent: 1_000_000, aleReductionMean: 3_000_000, aleReductionP10: 1, aleReductionP90: 2 },
      { spent: 100_000, aleReductionMean: 300_000, returnPercent: 200 },
    ),
    review(
      { organizationId: 'scope-b', periodStart: '2026-01-01', spent: 500_000, aleReductionMean: 1_000_000 },
      { spent: 300_000, aleReductionMean: 150_000, returnPercent: -50 },
    ),
  ];

  it('should sum the latest review of each scope, with no band', () => {
    renderBand({ reviews, toleranceCounts: [count('scope-a', 2, 2), count('scope-b', 1, 0)], tenantWide: true });

    expect(card('Outside tolerance').getByText('2')).toBeTruthy();
    expect(card('Outside tolerance').getByText('out of 3 scenarios, in 1 scope')).toBeTruthy();
    expect(card('Loss avoided per year').getByText('$4.0M')).toBeTruthy();
    expect(card('Loss avoided per year').getByText('latest reviews of 2 scopes')).toBeTruthy();
    expect(card('Build return').getByText('+12.5%')).toBeTruthy();
    expect(card('Build return').getByText('1 scope below 0%')).toBeTruthy();
    expect(card('Spent').getByText('$1.5M')).toBeTruthy();
    expect(card('Spent').getByText('including $400K of build work')).toBeTruthy();
    expect(screen.queryByText(/ to \$/)).toBeNull();
    expect(screen.queryByText(/ on 2025/)).toBeNull();
  });
});
