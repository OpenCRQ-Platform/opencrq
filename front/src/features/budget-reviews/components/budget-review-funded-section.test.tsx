/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BudgetReviewFundedSection } from './budget-review-funded-section';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof BudgetReviewFundedSection>[0];
type Line = Props['lines'][number];
type Postures = NonNullable<Props['postures']>;
type PostureControl = Postures['controls'][number];

const LINE_ID = '00000000-0000-0000-0000-0000000000a1';
const BUILD_LINE_ID = '00000000-0000-0000-0000-0000000000a2';
const CONTROL_ID = '00000000-0000-0000-0000-0000000000c1';

const line = (overrides: Partial<Line> = {}): Line => ({
  id: LINE_ID,
  reviewId: '00000000-0000-0000-0000-0000000000b1',
  name: 'EDR on the production servers',
  nature: 'build',
  amountSpent: 180_000,
  createdAt: '2026-03-01T00:00:00.000Z',
  amortizationYears: null,
  capabilityIds: [CONTROL_ID],
  csfFunctions: ['PR', 'DE'],
  ...overrides,
});

const postureControl = (overrides: Partial<PostureControl> = {}): PostureControl => ({
  capabilityId: '00000000-0000-0000-0000-0000000000c2',
  externalId: 'CTRL-2',
  name: 'Offline backups',
  start: { strengthRung: 'L1', coverageBucket: 'L1' },
  end: { strengthRung: 'L2', coverageBucket: 'L2' },
  moved: true,
  buildLine: null,
  runLines: [],
  ...overrides,
});

const postures = (controls: Array<PostureControl>, overrides: Partial<Postures> = {}): Postures => ({
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  logStartsAt: '2025-09-01T00:00:00.000Z',
  logCoversPeriodStart: true,
  controls,
  ...overrides,
});

const renderCard = (props: Partial<Props> = {}) => render(
  createElement(BudgetReviewFundedSection, {
    number: 1,
    lines: [line()],
    figures: {
      status: 'open',
      closedAt: null,
      scopeScenarioCount: 2,
      toRepriceCount: 0,
      olderThanHeadlineNames: [],
      figures: [{
        basket: 'line',
        lineId: LINE_ID,
        state: 'priced',
        aleReductionMean: 520_000,
        aleReductionP10: 330_000,
        aleReductionP90: 740_000,
        spent: 180_000,
        returnPercent: 188.9,
        annualSpent: 180_000,
        amortizedReturnPercent: 188.9,
        pricedScenarioCount: 2,
        pricedAt: '2026-10-04T00:00:00.000Z',
      }],
    },
    postures: postures([postureControl()]),
    closed: false,
    onAddLine: vi.fn(),
    onOpenLine: vi.fn(),
    onAssignMoved: vi.fn(),
    ...props,
  }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

describe('BudgetReviewFundedSection', () => {
  it('shows a line with its spend, its loss avoided and spread, and the return the API computed', () => {
    renderCard();
    const card = within(screen.getByRole('article', { name: 'EDR on the production servers' }));

    expect(card.getByText('$180K')).toBeTruthy();
    expect(card.getByText('$520K')).toBeTruthy();
    expect(card.getByText('$330K to $740K')).toBeTruthy();
    expect(card.getByText('+188.9%')).toBeTruthy();
  });

  it('opens a line from its name, and only on an open review', () => {
    const onOpenLine = vi.fn();
    renderCard({ onOpenLine });

    fireEvent.click(screen.getByRole('button', { name: 'EDR on the production servers' }));
    expect(onOpenLine).toHaveBeenCalledWith(line());
    cleanup();

    renderCard({ closed: true });
    expect(screen.queryByRole('button', { name: 'EDR on the production servers' })).toBeNull();
  });

  it('groups the lines by nature, build first, each group defined and counted', () => {
    renderCard({
      lines: [
        line({ id: 'run-1', nature: 'run', name: 'Outsourced SOC', amountSpent: 2_600_000 }),
        line({ name: 'EDR rollout', amountSpent: 900_000 }),
        line({ id: 'build-2', name: 'PAM rollout', amountSpent: 500_000 }),
      ],
    });

    expect(screen.getByText('3 lines · $4.0M')).toBeTruthy();
    const build = within(screen.getByRole('region', { name: 'Build' }));
    expect(build.getByText("the period's posture changes")).toBeTruthy();
    expect(build.getByText('2 lines · $1.4M')).toBeTruthy();
    expect(build.getByText('EDR rollout')).toBeTruthy();
    expect(build.queryByText('Outsourced SOC')).toBeNull();
    const run = within(screen.getByRole('region', { name: 'Run' }));
    expect(run.getByText('the controls kept running, against their absence')).toBeTruthy();
    expect(run.getByText('1 line · $2.6M')).toBeTruthy();
    const [first, second] = screen.getAllByRole('region');
    expect(first.contains(screen.getByText('EDR rollout'))).toBe(true);
    expect(second.contains(screen.getByText('Outsourced SOC'))).toBe(true);
  });

  it('leaves out a nature with no line', () => {
    renderCard();

    expect(screen.getByRole('region', { name: 'Build' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Run' })).toBeNull();
  });

  it("reads an amortized build line's period and amortized return inside its spend and return cells", () => {
    renderCard({
      lines: [line({ amortizationYears: 3 })],
      figures: {
        status: 'open',
        closedAt: null,
        scopeScenarioCount: 2,
        toRepriceCount: 0,
        olderThanHeadlineNames: [],
        figures: [{
          basket: 'line',
          lineId: LINE_ID,
          state: 'priced',
          aleReductionMean: 520_000,
          aleReductionP10: 330_000,
          aleReductionP90: 740_000,
          spent: 180_000,
          returnPercent: 188.9,
          annualSpent: 60_000,
          amortizedReturnPercent: 766.7,
          pricedScenarioCount: 2,
          pricedAt: '2026-10-04T00:00:00.000Z',
        }],
      },
    });

    expect(screen.getByText('amortized over 3 years')).toBeTruthy();
    expect(screen.getByText('amortized +766.7%')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /Amortized over|Build amortized|Nature/ })).toBeNull();
  });

  it('always shows the spend by NIST CSF function on its wheel, and names the functions a line touches', () => {
    renderCard();

    expect(screen.getByRole('img', { name: 'NIST CSF wheel of the spend by function' }).getAttribute('width')).toBe('240');
    expect(within(screen.getByRole('article', { name: 'EDR on the production servers' })).getByText('Protect, Detect')).toBeTruthy();
  });

  it('says there is no line yet, with no line card and no CSF wheel', () => {
    renderCard({ lines: [] });

    expect(screen.getByText("No budget line yet: add one for each project or standing cost this period's budget paid for.")).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('img', { name: 'NIST CSF wheel of the spend by function' })).toBeNull();
  });

  it('shows a line\'s controls as their identifier pills, three at most', () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5'].map((suffix) => `00000000-0000-0000-0000-0000000000${suffix}`);
    renderCard({
      lines: [line({ capabilityIds: ids })],
      postures: postures(ids.map((capabilityId, index) => postureControl({
        capabilityId,
        externalId: `CTRL-${index}`,
        name: `Control ${index}`,
      }))),
    });

    expect(screen.getByText('CTRL-0')).toBeTruthy();
    expect(screen.getByText('CTRL-1')).toBeTruthy();
    expect(screen.getByText('CTRL-2')).toBeTruthy();
    expect(screen.queryByText('CTRL-3')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('shows two controls sharing an identifier as two pills', () => {
    const ids = ['c1', 'c2'].map((suffix) => `00000000-0000-0000-0000-0000000000${suffix}`);
    renderCard({
      lines: [line({ capabilityIds: ids })],
      postures: postures(ids.map((capabilityId) => postureControl({ capabilityId, externalId: 'CTRL-1' }))),
    });

    expect(screen.getAllByText('CTRL-1')).toHaveLength(2);
  });

  it('counts a line\'s controls and keeps its chevron while their postures load', () => {
    const ids = ['c1', 'c2', 'c3'].map((suffix) => `00000000-0000-0000-0000-0000000000${suffix}`);
    renderCard({ lines: [line({ capabilityIds: ids })], postures: undefined });

    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show its 3 controls' }));
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('unfolds a build line into its controls\' moves, without opening the line', () => {
    const onOpenLine = vi.fn();
    renderCard({ onOpenLine, postures: postures([postureControl({ capabilityId: CONTROL_ID, name: 'Endpoint detection', buildLine: { id: LINE_ID, name: 'EDR' } })]) });

    const toggle = screen.getByRole('button', { name: 'Show its control' });
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide its control');
    expect(screen.getByText('Endpoint detection')).toBeTruthy();
    expect(screen.getByText('Basic →')).toBeTruthy();
    expect(screen.getByText('Intermediate')).toBeTruthy();
    expect(screen.getByText('Partial →')).toBeTruthy();
    expect(screen.getByText('Broad')).toBeTruthy();
    expect(onOpenLine).not.toHaveBeenCalled();
  });

  it('reads a run line\'s control at the period\'s start, and names the build line its progress is counted in', () => {
    const onOpenLine = vi.fn();
    const buildLine = line({ id: BUILD_LINE_ID, name: 'EDR rollout', capabilityIds: [CONTROL_ID] });
    renderCard({
      onOpenLine,
      lines: [line({ nature: 'run', name: 'Outsourced SOC', capabilityIds: [CONTROL_ID] }), buildLine],
      postures: postures([postureControl({ capabilityId: CONTROL_ID, name: 'Endpoint detection', buildLine: { id: BUILD_LINE_ID, name: 'EDR rollout' } })]),
    });

    fireEvent.click(within(screen.getByRole('article', { name: 'Outsourced SOC' })).getByRole('button', { name: 'Show its control' }));

    expect(screen.getByText('Basic')).toBeTruthy();
    expect(screen.queryByText('Intermediate')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Progress counted in “EDR rollout”' }));
    expect(onOpenLine).toHaveBeenCalledWith(buildLine);
  });

  it('says why a line not simulated yet has no figure', () => {
    renderCard({
      figures: {
        status: 'open',
        closedAt: null,
        scopeScenarioCount: 2,
        toRepriceCount: 2,
        olderThanHeadlineNames: [],
        figures: [{
          basket: 'line',
          lineId: LINE_ID,
          state: 'not-priced',
          aleReductionMean: null,
          aleReductionP10: null,
          aleReductionP90: null,
          spent: 180_000,
          returnPercent: null,
          annualSpent: 180_000,
          amortizedReturnPercent: null,
          pricedScenarioCount: 0,
          pricedAt: null,
        }],
      },
    });

    expect(screen.getByText('Not priced')).toBeTruthy();
  });

  it('counts the controls that moved with no build line, and opens the build line drawer from there', () => {
    const onAssignMoved = vi.fn();
    renderCard({ onAssignMoved });

    expect(screen.getByText('1 control moved during the period with no build line.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(onAssignMoved).toHaveBeenCalledOnce();
  });

  it('says a level the build line left unchanged', () => {
    renderCard({ postures: postures([postureControl({ capabilityId: CONTROL_ID, end: { strengthRung: 'L2', coverageBucket: 'L1' } })]) });

    fireEvent.click(screen.getByRole('button', { name: 'Show its control' }));

    expect(screen.getByText('Partial, unchanged')).toBeTruthy();
  });

  it('drops the banner once every moved control belongs to a build line', () => {
    renderCard({ postures: postures([postureControl({ buildLine: { id: LINE_ID, name: 'EDR' } })]) });

    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
  });

  it('says which work goes uncounted when the posture history begins after the fiscal year start, closed or not', () => {
    const late = postures([], { logCoversPeriodStart: false, logStartsAt: '2026-03-15T12:00:00.000Z' });
    renderCard({ postures: late });
    expect(screen.getByText(/^Posture changes are recorded only since .*: work delivered between .* and that date is not counted\.$/)).toBeTruthy();
    cleanup();

    renderCard({ postures: late, closed: true });
    expect(screen.getByText(/^Posture changes are recorded only since/)).toBeTruthy();
  });

  it('offers no edit on a closed review', () => {
    renderCard({ closed: true });

    expect(screen.queryByRole('button', { name: 'Add a line' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
  });
});
