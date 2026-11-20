/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BudgetReviewReturnSection } from './budget-review-return-section';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof BudgetReviewReturnSection>[0];
type Figures = NonNullable<Props['figures']>;
type Figure = Figures['figures'][number];

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
  amortizedReturnPercent: overrides.returnPercent ?? null,
  pricedScenarioCount: 3,
  pricedAt: '2026-10-04T00:00:00.000Z',
  ...overrides,
});

const figures = (rows: Array<Figure>, overrides: Partial<Figures> = {}): Figures => ({
  status: 'open',
  closedAt: null,
  scopeScenarioCount: 3,
  toRepriceCount: 0,
  olderThanHeadlineNames: [],
  figures: rows,
  ...overrides,
});

const renderCard = (props: Partial<Props> = {}) => render(
  createElement(BudgetReviewReturnSection, {
    figures: figures([
      figure({ basket: 'build', aleReductionMean: 1_300_000, aleReductionP10: 900_000, aleReductionP90: 1_800_000, spent: 400_000, returnPercent: 225 }),
      figure({ basket: 'run', aleReductionMean: 4_600_000, spent: 900_000, returnPercent: 411.1 }),
      figure({ basket: 'ensemble', aleReductionMean: 5_400_000, spent: 1_300_000, returnPercent: 315.4 }),
    ]),
    lines: [{ nature: 'build', amountSpent: 400_000 }, { nature: 'run', amountSpent: 450_000 }, { nature: 'run', amountSpent: 450_000 }],
    resimulation: 'hidden',
    onResimulate: vi.fn(),
    number: 2,
    ...props,
  }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

/** The spent, loss avoided and return cells of the row headed by `heading`. */
const cellsOf = (heading: string): Array<string> => {
  const row = screen.getByText(heading).closest<HTMLElement>('[role="row"]')!;
  return within(row).getAllByRole('cell').map((cell) => cell.textContent ?? '');
};

describe('BudgetReviewReturnSection', () => {
  it('reads as a table whose columns follow the computation, spent then loss avoided then return', () => {
    renderCard();

    const table = screen.getByRole('table', { name: 'What it returned' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Nature', 'Spent', 'Loss avoided per year', 'Return']);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
  });

  it("shows each row's spend, loss avoided with its spread and return as the API computed them", () => {
    renderCard();

    expect(cellsOf('Build')).toEqual(['$400K1 line', '$1.3M$900K to $1.8M', '+225%Prudent (p10): +125%']);
    expect(cellsOf('Run')).toEqual(['$900K2 lines', '$4.6M', '+411.1%']);
    expect(cellsOf('Overall')).toEqual(['$1.3M3 lines', '$5.4M', '+315.4%']);
    expect(screen.getByText('+225%').className).toContain('text-green-600');
  });

  it("sizes the loss avoided arrow to its row's figure", () => {
    renderCard();

    const arrowSize = (heading: string) => {
      const row = screen.getByText(heading).closest<HTMLElement>('[role="row"]')!;
      return within(row).getAllByRole('cell')[1].querySelector('svg')?.getAttribute('width');
    };
    expect(arrowSize('Build')).toBe('24');
    expect(arrowSize('Run')).toBe('18');
    expect(arrowSize('Overall')).toBe('14');
  });

  it('shows the prudent return, on the p10 of the loss avoided, only where a p10 and a spend exist', () => {
    renderCard();

    expect(screen.getAllByText(/^Prudent \(p10\):/)).toHaveLength(1);
    expect(screen.getByText('Prudent (p10): +125%')).toBeTruthy();
  });

  it('shows no prudent return without a p10 or without a spend', () => {
    renderCard({
      figures: figures([
        figure({ basket: 'build', aleReductionMean: 10, aleReductionP10: 5, spent: 0 }),
        figure({ basket: 'run', aleReductionMean: 10, spent: 4 }),
      ]),
    });

    expect(screen.queryByText(/^Prudent \(p10\):/)).toBeNull();
  });

  it('counts the lines of each nature, and every line under the overall column', () => {
    renderCard();

    expect(screen.getByText('1 line')).toBeTruthy();
    expect(screen.getByText('2 lines')).toBeTruthy();
    expect(screen.getByText('3 lines')).toBeTruthy();
  });

  it('reads the build row first, then run, then the overall basket said not to be the sum', () => {
    renderCard();

    const chips = screen.getAllByText(/^(Build|Run|Overall)$/).map((chip) => chip.textContent);
    expect(chips).toEqual(['Build', 'Run', 'Overall']);
    expect(screen.getByText('priced as one basket, not the sum')).toBeTruthy();
  });

  it("reads an amortized build basket's yearly spend and amortized return beside its prudent one", () => {
    renderCard({
      figures: figures([
        figure({ basket: 'build', aleReductionMean: 1_300_000, aleReductionP10: 900_000, spent: 400_000, returnPercent: 225, annualSpent: 100_000, amortizedReturnPercent: 1_200 }),
      ]),
    });

    expect(screen.getByText('1 line · $100K a year amortized')).toBeTruthy();
    expect(screen.getByText('Prudent (p10): +125% · amortized +1,200%')).toBeTruthy();
  });

  it('leaves out the row of a nature with no line', () => {
    renderCard({ lines: [{ nature: 'run', amountSpent: 900_000 }] });

    expect(screen.queryByText('Build')).toBeNull();
    expect(screen.getByText('Run')).toBeTruthy();
  });

  it('holds what it is given under the figures, in the same section', () => {
    render(
      createElement(BudgetReviewReturnSection, {
        figures: figures([]),
        lines: [],
        resimulation: 'hidden',
        onResimulate: vi.fn(),
        number: 2,
        children: createElement('p', null, 'Risk chart'),
      }),
      { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
    );

    expect(screen.getByText('Risk chart')).toBeTruthy();
  });

  it('says when the figures are expired and offers to re-simulate', () => {
    renderCard({
      figures: figures([figure({ basket: 'ensemble', state: 'expired', aleReductionMean: 10, spent: 1, returnPercent: 900 })]),
      resimulation: 'ready',
    });

    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Re-simulate scenarios' })).toBeTruthy();
  });

  it('offers no re-simulation on a closed review, whose figures stay as they were at closing', () => {
    renderCard({
      figures: figures([figure({ basket: 'ensemble', state: 'expired' })], { status: 'closed', closedAt: '2026-10-04T00:00:00.000Z' }),
      resimulation: 'ready',
    });

    expect(screen.queryByRole('button', { name: 'Re-simulate scenarios' })).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });
});
