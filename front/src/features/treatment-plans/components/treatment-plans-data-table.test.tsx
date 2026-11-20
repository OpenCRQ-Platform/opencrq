/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { TreatmentPlansDataTable } from './treatment-plans-data-table';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn(), useSearch: () => ({}) };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const SCOPE_ID = '00000000-0000-0000-0000-0000000000aa';

const plan = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-00000000000b',
  organizationId: SCOPE_ID,
  name: 'Harden privileged access',
  status: 'draft',
  ownerId: null,
  startDate: null,
  endDate: null,
  rationale: null,
  costOneOff: null,
  costRecurringAnnual: null,
  promisedAleReduction: null,
  promisedAt: null,
  scopeVersion: 1,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  moves: [],
  organization: { id: SCOPE_ID, name: 'Payment platform' },
  owner: null,
  totalAleReduction: 486_000,
  expired: false,
  pricedAt: new Date('2026-09-17T00:00:00Z'),
  costYear1: 156_000,
  returnPercent: 211.5,
  ...overrides,
});

const renderTable = (organizationId: string | undefined, plans: Array<unknown>) =>
  renderWithTrpc(createElement(TreatmentPlansDataTable, { organizationId }), { answers: { 'treatmentPlans.getTreatmentPlans': plans } });

const showView = async (view: 'Lines view' | 'Cards view') => {
  fireEvent.click(await screen.findByLabelText(view));
};

describe('TreatmentPlansDataTable', () => {
  it('should open on the cards, one per plan', async () => {
    renderTable(SCOPE_ID, [plan()]);

    await waitFor(() => expect(screen.getByText('Harden privileged access')).toBeTruthy());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('+211.5%')).toBeTruthy();
  });

  it('should state the four plan figures above the list, in both views', async () => {
    renderTable(undefined, [
      plan({ id: '00000000-0000-0000-0000-000000000001', status: 'active', endDate: '2020-01-01', costYear1: 240_000, returnPercent: -17.5 }),
      plan({ id: '00000000-0000-0000-0000-000000000002', status: 'active', costYear1: 156_000, returnPercent: 211.5 }),
      plan({ id: '00000000-0000-0000-0000-000000000003', status: 'draft', costYear1: null, returnPercent: null }),
    ]);

    for (const view of ['Cards view', 'Lines view'] as const) {
      await showView(view);
      await waitFor(() => expect(screen.getByText('out of 3 plans')).toBeTruthy());
      expect(screen.getByText('out of 2 active plans')).toBeTruthy();
      expect(screen.getByText('out of 2 plans with a return')).toBeTruthy();
      expect(screen.getByText('$396K')).toBeTruthy();
      expect(screen.getByText('active plans, out of $396K in total')).toBeTruthy();
    }
  });

  it('should leave the figures out when there is no plan to count', async () => {
    renderTable(SCOPE_ID, []);

    await waitFor(() => expect(screen.getByText('Start with a treatment plan')).toBeTruthy());
    expect(screen.queryByText('Active plans')).toBeNull();
  });

  it('should print a dash for the cost and the return of a plan with no cost', async () => {
    renderTable(SCOPE_ID, [plan({ costYear1: null, returnPercent: null, totalAleReduction: 74_000 })]);

    const card = within(await screen.findByTestId('treatment-plan-card'));
    expect(card.getByText('First-year cost').nextElementSibling?.textContent).toBe('-');
    expect(card.getByText('Return').nextElementSibling?.textContent).toBe('-');
  });

  it('should mark a late plan and a stale simulation on its card', async () => {
    renderTable(SCOPE_ID, [plan({ status: 'active', startDate: '2019-01-01', endDate: '2020-01-01', expired: true })]);

    const card = within(await screen.findByTestId('treatment-plan-card'));
    expect(card.getByText('Overdue')).toBeTruthy();
    expect(card.getByText('Expired')).toBeTruthy();
    expect(card.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('should name the risk scope only when no scope is selected', async () => {
    renderTable(undefined, [plan()]);
    await showView('Lines view');

    await waitFor(() => expect(screen.getByText('Harden privileged access')).toBeTruthy());
    expect(screen.getByText('Risk scope')).toBeTruthy();
    expect(screen.getByText('Payment platform')).toBeTruthy();
  });

  it('should drop the risk scope column inside a scope, where every row shares it', async () => {
    renderTable(SCOPE_ID, [plan()]);
    await showView('Lines view');

    await waitFor(() => expect(screen.getByText('Harden privileged access')).toBeTruthy());
    expect(screen.queryByText('Risk scope')).toBeNull();
  });

  it('should mark the simulation a figure comes from, not the figure itself', async () => {
    renderTable(SCOPE_ID, [plan({ expired: true })]);
    await showView('Lines view');

    await waitFor(() => expect(screen.getByText('Expired')).toBeTruthy());
    // The badge belongs to the date the figures were priced on, and the amount keeps its own tone.
    expect(screen.getByText('Expired').closest('td')?.textContent).toContain('Sep 17, 2026');
    expect(screen.getByText('$486K').className).not.toContain('text-default-secondary');
  });

  it('should mark a plan whose due date has passed', async () => {
    renderTable(SCOPE_ID, [plan({ endDate: '2020-01-01' })]);
    await showView('Lines view');

    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Overdue')).toBeTruthy());
  });

  it('should rank the plans by return, the ones whose return is undefined last', async () => {
    renderTable(SCOPE_ID, [
      plan({ id: '00000000-0000-0000-0000-000000000001', name: 'No cost entered', costYear1: null, returnPercent: null }),
      plan({ id: '00000000-0000-0000-0000-000000000002', name: 'Loss making', returnPercent: -17.5 }),
      plan({ id: '00000000-0000-0000-0000-000000000003', name: 'Best return', returnPercent: 237 }),
      plan({ id: '00000000-0000-0000-0000-000000000004', name: 'Cost of zero', costYear1: 0, returnPercent: null }),
    ]);
    await showView('Lines view');

    await waitFor(() => expect(screen.getByText('Best return')).toBeTruthy());
    const planNames = ['No cost entered', 'Loss making', 'Best return', 'Cost of zero'];
    const names = screen.getAllByRole('row').slice(1).map((row) => planNames.find((name) => row.textContent?.includes(name)));
    expect(names.slice(0, 2)).toEqual(['Best return', 'Loss making']);
    expect(names.slice(2).sort()).toEqual(['Cost of zero', 'No cost entered']);
  });

  it('should print the first-year cost the service summed, and a dash for the return on a cost of zero', async () => {
    renderTable(SCOPE_ID, [plan({ costYear1: 0, returnPercent: null })]);
    await showView('Lines view');

    const table = within(await screen.findByRole('table'));
    await waitFor(() => expect(table.getByText('$0')).toBeTruthy());
    expect(table.getByText('$0').closest('tr')?.textContent).toContain('-');
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  it('should say what a treatment plan is when the tenant has none', async () => {
    renderTable(SCOPE_ID, []);

    await waitFor(() => expect(screen.getByText('Start with a treatment plan')).toBeTruthy());
    expect(screen.getByText(/the set of controls you would fund/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a risk treatment plan' })).toBeTruthy();
  });

  it('should print a negative return in red', async () => {
    renderTable(SCOPE_ID, [plan({ returnPercent: -17.5 })]);
    await showView('Lines view');

    await waitFor(() => expect(screen.getByText('-17.5%')).toBeTruthy());
    expect(screen.getByText('-17.5%').className).toContain('text-red');
  });
});
