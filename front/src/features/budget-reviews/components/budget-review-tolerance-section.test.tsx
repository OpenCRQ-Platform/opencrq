/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BudgetReviewToleranceSection } from './budget-review-tolerance-section';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: ({ children }: { children: ReactNode }) => createElement('a', { href: '#' }, children),
  };
});

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ effectiveTheme: 'dark' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
});

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof BudgetReviewToleranceSection>[0];
type Tolerance = NonNullable<Props['tolerance']>;
type Scenario = Tolerance['scenarios'][number];

const SCOPE_TOLERANCE = { annualLoss: 2_000_000, maxExceedanceProbability: 0.05, source: 'scope' as const };

const curve = (atTolerance: number) => [{ loss: 0, probability: atTolerance * 3 }, { loss: 2_000_000, probability: atTolerance }, { loss: 8_000_000, probability: 0.001 }];
const reading = (probability: number, beyondTail = false) => ({ probability, beyondTail, curve: curve(probability) });

const scenario = (name: string, reference: number, withoutBuild: number, overrides: Partial<Scenario> = {}): Scenario => ({
  scenarioId: `00000000-0000-0000-0000-${name.length.toString().padStart(12, '0')}`,
  name,
  tolerance: SCOPE_TOLERANCE,
  reference: reading(reference),
  withoutBuild: reading(withoutBuild),
  olderThanHeadline: false,
  ...overrides,
});

const tolerance = (overrides: Partial<Tolerance> = {}): Tolerance => ({
  reference: 'today',
  state: 'priced',
  scenarios: [
    scenario('Ransomware on the ERP', 0.03, 0.09),
    scenario('Mail compromise', 0.12, 0.15),
    scenario('Wire fraud', 0.08, 0.14, { tolerance: { annualLoss: 500_000, maxExceedanceProbability: 0.1, source: 'scenario' } }),
    scenario('Website outage', 0.01, 0.02),
  ],
  ...overrides,
});

const renderCard = (props: Partial<Props> = {}) => render(
  createElement(BudgetReviewToleranceSection, { number: 3, tolerance: tolerance(), closed: false, onSetTolerance: vi.fn(), ...props }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

const figure = (heading: string): HTMLElement => {
  const label = screen.getByText(heading);
  const field = label.closest('div')?.parentElement;
  if (!field) {
    throw new Error(`No figure under ${heading}`);
  }
  return field;
};

describe('BudgetReviewToleranceSection', () => {
  it('asks the board question as the third section of the page', () => {
    renderCard();

    expect(screen.getByRole('heading', { level: 2, name: 'Are we within our risk tolerance?' })).toBeTruthy();
  });

  it('counts an open review\'s scenarios today, without the build work, and brought back by it', () => {
    renderCard();

    expect(within(figure('Outside tolerance today')).getByText('1')).toBeTruthy();
    expect(within(figure('Outside tolerance without the period\'s build work')).getByText('3')).toBeTruthy();
    expect(within(figure('Brought back within tolerance by the build work')).getByText('2')).toBeTruthy();
    expect(screen.getAllByText('out of 4 scenarios')).toHaveLength(3);
  });

  it('lists every scenario, brought back ones first and within ones last, with their threshold and readings', () => {
    renderCard();

    const names = screen.getAllByRole('link').map((link) => link.textContent);
    expect(names).toEqual(['Ransomware on the ERP', 'Wire fraud', 'Mail compromise', 'Website outage']);
    expect(screen.getAllByText('$2.0M, 5% at most · scope')).toHaveLength(3);
    expect(screen.getByText('$500K, 10% at most · scenario')).toBeTruthy();
    expect(screen.getByText('Probability of exceeding today')).toBeTruthy();
    expect(screen.getByText('9%')).toBeTruthy();
    expect(screen.getAllByText('Within tolerance')).toHaveLength(4);
    expect(screen.getAllByText('Outside tolerance')).toHaveLength(4);
  });

  it('lists the scenarios when every one is within tolerance in both readings', () => {
    renderCard({ tolerance: tolerance({ scenarios: [scenario('Website outage', 0.01, 0.02), scenario('Ransomware on the ERP', 0.03, 0.04)] }) });

    expect(within(figure('Outside tolerance today')).getByText('0')).toBeTruthy();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Ransomware on the ERP', 'Website outage']);
    expect(screen.getAllByText('Within tolerance')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /Show the loss exceedance curve of/ })).toHaveLength(2);
  });

  it('marks only the scenarios whose curves come from a run older than their latest', () => {
    renderCard({
      tolerance: tolerance({
        scenarios: [
          scenario('Ransomware on the ERP', 0.03, 0.09, { olderThanHeadline: true }),
          scenario('Mail compromise', 0.12, 0.15),
        ],
      }),
    });

    expect(screen.getAllByText('Older than the ALE')).toHaveLength(1);
  });

  it('shows no mark when every scenario reads its latest run', () => {
    renderCard();

    expect(screen.queryByText('Older than the ALE')).toBeNull();
  });

  it('reads a closed review at the fiscal year end and drops the figure state', () => {
    renderCard({
      closed: true,
      onSetTolerance: undefined,
      tolerance: tolerance({ reference: 'period-end', state: 'expired' }),
    });

    expect(screen.getByText('Outside tolerance at the fiscal year end')).toBeTruthy();
    expect(screen.getByText('Probability of exceeding at the fiscal year end')).toBeTruthy();
    expect(screen.queryByText('Outside tolerance today')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('shows a reading past the tail as an upper bound', () => {
    renderCard({
      tolerance: tolerance({ scenarios: [scenario('Ransomware on the ERP', 0.03, 0.09, { reference: reading(0.001, true) })] }),
    });

    expect(screen.getByText('Below 0.1%')).toBeTruthy();
  });

  it('says no tolerance is set and offers to set one when no scenario applies any', () => {
    const onSetTolerance = vi.fn();
    const noTolerance = { tolerance: null, reference: { probability: null, beyondTail: null, curve: [] }, withoutBuild: { probability: null, beyondTail: null, curve: [] } };
    renderCard({ onSetTolerance, tolerance: tolerance({ scenarios: [scenario('Ransomware on the ERP', 0, 0, noTolerance)] }) });

    expect(screen.getByText('No risk tolerance is set on this scope.')).toBeTruthy();
    expect(screen.queryByText('Outside tolerance today')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set a risk tolerance' }));
    expect(onSetTolerance).toHaveBeenCalledOnce();
  });

  it('marks a review not priced and counts nothing', () => {
    renderCard({
      tolerance: tolerance({
        state: 'not-priced',
        scenarios: [scenario('Ransomware on the ERP', 0, 0, { reference: null, withoutBuild: null })],
      }),
    });

    expect(screen.getByText('Not priced')).toBeTruthy();
    expect(screen.getAllByText('out of 0 scenarios')).toHaveLength(3);
    expect(screen.getByText('The scenarios are not priced against their tolerance for this review yet: re-simulate them.')).toBeTruthy();
  });

  it('unfolds a row onto its loss exceedance curves, read at the tolerance amount', () => {
    renderCard();

    const toggle = screen.getByRole('button', { name: 'Show the loss exceedance curve of Ransomware on the ERP' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('img', { name: /^Probability that the year's loss/ })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('img', {
      name: "Probability that the year's loss exceeds each amount: 3% today, 9% without the build work, tolerance 5% at $2.0M",
    })).toBeTruthy();
    expect(screen.getByText('Loss exceedance curve')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Risk tolerance point')).toBeTruthy();
    expect(screen.getByText('3% today')).toBeTruthy();
    expect(screen.getByText('9% without the build work')).toBeTruthy();
  });

  it("marks each curve's reading at the tolerance amount by its verdict, and thickens the stretch outside tolerance", () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Show the loss exceedance curve of Ransomware on the ERP' }));

    const chart = screen.getByRole('img', { name: /^Probability that the year's loss/ });
    const dots = Array.from(chart.querySelectorAll('circle'), (dot) => dot.getAttribute('fill'));
    expect(dots).toEqual(['var(--fds-color-feedback-success-primary)', 'var(--fds-color-feedback-error-primary)']);
    expect(chart.querySelectorAll('polyline[stroke-width="3"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Risk tolerance point' })).toBeTruthy();
  });

  it("labels a closed review's curve at the fiscal year end", () => {
    renderCard({ closed: true, onSetTolerance: undefined, tolerance: tolerance({ reference: 'period-end' }) });

    fireEvent.click(screen.getByRole('button', { name: 'Show the loss exceedance curve of Ransomware on the ERP' }));

    expect(screen.getByText('At the fiscal year end')).toBeTruthy();
    expect(screen.getByText('3% at the fiscal year end')).toBeTruthy();
  });

  it('reads a review closed before its period end at its closing', () => {
    renderCard({ closed: true, onSetTolerance: undefined, tolerance: tolerance({ reference: 'closing' }) });

    expect(screen.getByText('Outside tolerance at closing')).toBeTruthy();
    expect(screen.getByText('Probability of exceeding at closing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the loss exceedance curve of Ransomware on the ERP' }));
    expect(screen.getByText('At closing')).toBeTruthy();
    expect(screen.getByText('3% at closing')).toBeTruthy();
  });

  it('names a scenario deleted since the review closed without linking it', () => {
    renderCard({
      closed: true,
      onSetTolerance: undefined,
      tolerance: tolerance({ reference: 'period-end', scenarios: [scenario('Retired scenario', 0.03, 0.09, { scenarioId: null })] }),
    });

    expect(screen.getByText('Retired scenario')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('gives no toggle to a row with nothing to draw', () => {
    renderCard({
      tolerance: tolerance({
        scenarios: [
          scenario('Ransomware on the ERP', 0.03, 0.09, { withoutBuild: { probability: 0.09, beyondTail: false, curve: [] } }),
          scenario('Mail compromise', 0.12, 0.15),
          scenario('Not priced yet', 0, 0, { reference: null, withoutBuild: null }),
        ],
      }),
    });

    expect(screen.getByText('Ransomware on the ERP')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show the loss exceedance curve of Ransomware on the ERP' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show the loss exceedance curve of Not priced yet' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the loss exceedance curve of Mail compromise' })).toBeTruthy();
  });

  it("says a closed review's scenarios were not priced at closing, without asking to re-simulate", () => {
    renderCard({
      closed: true,
      onSetTolerance: undefined,
      tolerance: tolerance({ reference: 'period-end', scenarios: [scenario('Ransomware on the ERP', 0, 0, { reference: null, withoutBuild: null })] }),
    });

    expect(screen.getByText('The scenarios were not priced against their tolerance at closing.')).toBeTruthy();
    expect(screen.queryByText(/re-simulate/)).toBeNull();
  });

  it('renders nothing once the review is gone', () => {
    const { container } = renderCard({ tolerance: null });

    expect(container.childElementCount).toBe(0);
  });
});
