/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BudgetReviewBriefCard } from './budget-review-brief-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof BudgetReviewBriefCard>[0];
type Figures = NonNullable<Props['figures']>;
type Figure = Figures['figures'][number];
type Tolerance = NonNullable<Props['tolerance']>;
type Scenario = Tolerance['scenarios'][number];

const figure = (overrides: Partial<Figure>): Figure => ({
  basket: 'ensemble',
  lineId: null,
  state: 'priced',
  aleReductionMean: null,
  aleReductionP10: null,
  aleReductionP90: null,
  spent: 0,
  returnPercent: null,
  annualSpent: overrides.spent ?? 0,
  amortizedReturnPercent: null,
  pricedScenarioCount: 2,
  pricedAt: '2026-10-04T00:00:00.000Z',
  ...overrides,
});

const figures = (build: Partial<Figure> = {}, ensemble: Partial<Figure> = {}): Figures => ({
  status: 'open',
  closedAt: null,
  scopeScenarioCount: 2,
  toRepriceCount: 0,
  olderThanHeadlineNames: [],
  figures: [
    figure({ basket: 'build', aleReductionMean: 5_200_000, spent: 1_400_000, ...build }),
    figure({ basket: 'ensemble', aleReductionMean: 22_000_000, spent: 4_000_000, ...ensemble }),
  ],
});

const TOLERANCE = { annualLoss: 20_000_000, maxExceedanceProbability: 0.05, source: 'scope' as const };
const reading = (probability: number) => ({ probability, beyondTail: false, curve: [] });
const scenario = (name: string, reference: number, withoutBuild: number, overrides: Partial<Scenario> = {}): Scenario => ({
  scenarioId: `id-${name}`,
  name,
  tolerance: TOLERANCE,
  reference: reading(reference),
  withoutBuild: reading(withoutBuild),
  olderThanHeadline: false,
  ...overrides,
});

const tolerance = (overrides: Partial<Tolerance> = {}): Tolerance => ({
  reference: 'today',
  state: 'priced',
  scenarios: [scenario('Core banking breach', 0.038, 0.062), scenario('Retail lending breach', 0.2, 0.227)],
  ...overrides,
});

const LINES: Props['review']['lines'] = [
  { nature: 'build', amountSpent: 900_000 },
  { nature: 'build', amountSpent: 500_000 },
  { nature: 'run', amountSpent: 2_600_000 },
];

const review = (overrides: Partial<Props['review']> = {}): Props['review'] => ({
  periodStart: '2025-11-01',
  periodEnd: '2026-10-31',
  status: 'open',
  organization: { name: 'Acme Bank' },
  lines: LINES,
  ...overrides,
});

const renderCard = (props: Partial<Props> = {}) => render(
  createElement(BudgetReviewBriefCard, { review: review(), figures: figures(), tolerance: tolerance(), ...props }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

const SPENT = 'From Nov 1, 2025 to Oct 31, 2026, Acme Bank spent $4.0M.';

const sentence = (): string => screen.getByText(/^From /).textContent ?? '';

/** A figure's value and the line under it, found by its label. */
const figureTile = (label: string): { value: string, sub: string | null } => {
  const [, value, sub] = Array.from(screen.getByText(label).closest('span')!.parentElement!.children);
  return { value: value.textContent ?? '', sub: sub?.textContent ?? null };
};

describe('BudgetReviewBriefCard', () => {
  it('says what was spent over the period, what the build work removed and how many scenarios it brought back', () => {
    renderCard();

    expect(sentence()).toBe(`${SPENT} The build work, $1.4M, removes $5.2M of annual loss and brings 1 of 2 scenarios back within their risk tolerance.`);
  });

  it('agrees the tolerance clause with a single assessed scenario', () => {
    renderCard({ tolerance: tolerance({ scenarios: [scenario('Core banking breach', 0.038, 0.062)] }) });

    expect(sentence()).toBe(`${SPENT} The build work, $1.4M, removes $5.2M of annual loss and brings 1 of 1 scenario back within its risk tolerance.`);
  });

  it('makes no tolerance claim when the build work brings no scenario back', () => {
    renderCard({ tolerance: tolerance({ scenarios: [scenario('Core banking breach', 0.2, 0.25)] }) });

    expect(sentence()).toBe(`${SPENT} The build work, $1.4M, removes $5.2M of annual loss.`);
  });

  it('says a loss avoided of exactly zero leaves the annual loss unchanged', () => {
    renderCard({ figures: figures({ aleReductionMean: 0 }) });

    expect(sentence()).toBe(`${SPENT} The build work, $1.4M, leaves the annual loss unchanged.`);
  });

  it('drops the build clause without a build line', () => {
    renderCard({ review: review({ lines: [{ nature: 'run', amountSpent: 2_600_000 }] }) });

    expect(sentence()).toBe('From Nov 1, 2025 to Oct 31, 2026, Acme Bank spent $2.6M.');
    expect(figureTile('Outside tolerance today')).toEqual({ value: '1 of 2 scenarios', sub: null });
  });

  it('drops the tolerance clause, and says so in the third figure, when no tolerance is set', () => {
    renderCard({ tolerance: tolerance({ scenarios: [scenario('Core banking breach', 0.038, 0.062, { tolerance: null })] }) });

    expect(sentence()).toBe(`${SPENT} The build work, $1.4M, removes $5.2M of annual loss.`);
    expect(figureTile('Outside tolerance today')).toEqual({ value: 'No risk tolerance is set on this scope.', sub: null });
  });

  it('states no stale amount while the build figure is expired, and marks the figures expired', () => {
    renderCard({ figures: figures({ state: 'expired' }, { state: 'expired' }), tolerance: tolerance({ state: 'expired' }) });

    expect(sentence()).toBe(`${SPENT} The build work cost $1.4M. What it removes awaits a new simulation.`);
    expect(screen.getAllByText('Expired')).toHaveLength(2);
  });

  it('says a build work that raises the annual loss raises it', () => {
    renderCard({ figures: figures({ aleReductionMean: -300_000 }) });

    expect(sentence()).toBe(`${SPENT} The build work, $1.4M, raises the annual loss by $300K.`);
  });

  it('shows the spend split by nature, the loss avoided with its build share, and the scenarios outside tolerance', () => {
    renderCard();

    expect(figureTile('Spent')).toEqual({ value: '$4.0M', sub: 'of which $1.4M build, $2.6M run' });
    expect(figureTile('Loss avoided per year')).toEqual({ value: '$22.0M', sub: 'of which $5.2M by the build work' });
    expect(figureTile('Outside tolerance today')).toEqual({ value: '1 of 2 scenarios', sub: '2 without the period\'s build work' });
  });

  it('sizes the loss avoided arrows to the figure and to the line under it', () => {
    renderCard();

    const tile = screen.getByText('Loss avoided per year').closest('span')!.parentElement!;
    expect(Array.from(tile.querySelectorAll('svg.lucide-arrow-down'), (arrow) => arrow.getAttribute('width'))).toEqual(['24', '12']);
  });

  it('reads a closed review the same, at closing and without the figure states', () => {
    renderCard({
      review: review({ status: 'closed' }),
      figures: { ...figures(), status: 'closed', closedAt: '2026-10-31T00:00:00.000Z' },
      tolerance: tolerance({ reference: 'closing' }),
    });

    expect(sentence()).toBe(`${SPENT} The build work, $1.4M, removes $5.2M of annual loss and brings 1 of 2 scenarios back within their risk tolerance.`);
    expect(figureTile('Outside tolerance at closing').value).toBe('1 of 2 scenarios');
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Not priced')).toBeNull();
  });

  it('says no line is entered yet rather than a spend of nothing', () => {
    renderCard({ review: review({ lines: [] }) });

    expect(screen.getByText('No budget line is entered for this fiscal year yet.')).toBeTruthy();
  });
});
