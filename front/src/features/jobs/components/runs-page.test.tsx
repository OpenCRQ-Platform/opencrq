/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  stripSearchParams,
} from '@tanstack/react-router';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { FAILED, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { RUNS_LIST_SEARCH_DEFAULTS, runsListSearchSchema } from '../runs-list-search';
import { RunsPage } from './runs-page';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type RunRow = RouterOutputs['jobs']['listAllRuns']['items'][number];

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const run = (overrides: Partial<RunRow> & Pick<RunRow, 'id' | 'kind'>): RunRow => ({
  status: 'succeeded',
  enqueuedAt: '2026-09-15T10:00:00.000Z',
  startedAt: '2026-09-15T10:00:01.000Z',
  claimedAt: '2026-09-15T10:00:01.000Z',
  finishedAt: '2026-09-15T10:00:05.000Z',
  processedTotal: 0,
  expectedTotal: null,
  currentStep: null,
  attempt: 0,
  maxAttempts: 3,
  priority: 0,
  runAfter: '2026-09-15T10:00:00.000Z',
  heartbeatAt: null,
  leaseExpiresAt: null,
  lastError: null,
  errorCount: 0,
  stepCounts: [],
  triggeredBy: 'user',
  triggeredById: null,
  absorbedAsk: false,
  interactive: false,
  payload: null,
  ...overrides,
});

/**
 * A page of 30 fixed runs, enough that the default page size of 25 leaves a second page — the
 * precondition the pagination-reset test needs, so the page really was somewhere else beforehand.
 */
const FIXED_ROWS: Array<RunRow> = [run({ id: 'run-1', kind: 'cve-first' })];

const RISK_SCENARIO_ID = '019edb28-0011-7000-8000-000000000001';
const RISK_SCENARIO_NAME = 'Ransomware on the billing system';
const SERVICE_ACCOUNT_ID = 'b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f';
const SERVICE_ACCOUNT_NAME = 'CVE sync';

/** An answer given as a promise is delivered when it resolves, so a test can hold a lookup pending. */
const renderRunsPage = (
  initialPath = '/',
  rows: Array<RunRow> = FIXED_ROWS,
  hasManageSecurity = true,
  answerOverrides: Record<string, unknown> = {},
) => {
  const answers: Record<string, unknown> = {
    'jobs.listAllRuns': { items: rows, total: 30 },
    'capabilities.hasManageSecurity': hasManageSecurity,
    'riskScenarios.getNamesByIds': [{ id: RISK_SCENARIO_ID, name: RISK_SCENARIO_NAME }],
    'serviceAccounts.getNamesByIds': [{ id: SERVICE_ACCOUNT_ID, name: SERVICE_ACCOUNT_NAME }],
    ...answerOverrides,
  };

  const rootRoute = createRootRoute({
    validateSearch: runsListSearchSchema,
    search: { middlewares: [stripSearchParams(RUNS_LIST_SEARCH_DEFAULTS)] },
    component: (): ReactNode => <RunsPage />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const utils = renderWithTrpc(<RouterProvider router={router} />, { answers });

  const lastRunsCall = (): Record<string, unknown> => {
    const calls_ = utils.calls.filter((c) => c.path === 'jobs.listAllRuns');
    const last = calls_.at(-1);
    if (!last) {
      throw new Error('jobs.listAllRuns was never called');
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this fake link stands in for the server, which is what would normally validate `op.input` against `RunQueryInput`
    return last.input as Record<string, unknown>;
  };

  return { ...utils, lastRunsCall };
};

describe('RunsPage', () => {
  it('resets the page to 1 and re-issues the query with the filter, after having paged away from page 1', async () => {
    const { lastRunsCall } = renderRunsPage();

    await waitFor(() => expect(lastRunsCall()).toMatchObject({ offset: 0 }));

    const nextPageButton = await screen.findByRole('button', { name: 'Go to next page' });
    await waitFor(() => expect(nextPageButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(nextPageButton);

    // Confirm the precondition the test exists to prove: the page really moved before filtering.
    await waitFor(() => expect(lastRunsCall()).toMatchObject({ offset: 25 }));

    const searchField = screen.getByPlaceholderText('Search runs...');
    fireEvent.change(searchField, { target: { value: 'cve' } });
    fireEvent.blur(searchField);

    await waitFor(() => expect(lastRunsCall()).toMatchObject({ offset: 0, search: 'cve' }));
  });

  it('keeps an active filter across a page change', async () => {
    const { lastRunsCall } = renderRunsPage('/?kinds=cve-first');

    await waitFor(() => expect(lastRunsCall()).toMatchObject({ offset: 0, kinds: ['cve-first'] }));

    const nextPageButton = await screen.findByRole('button', { name: 'Go to next page' });
    await waitFor(() => expect(nextPageButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(nextPageButton);

    await waitFor(() => expect(lastRunsCall()).toMatchObject({ offset: 25, kinds: ['cve-first'] }));
  });

  it('resolves a payload reference to its name in the Related to column, as a link', async () => {
    const rows = [run({ id: 'run-1', kind: 'crq-simulation', payload: `{"riskScenarioId":"${RISK_SCENARIO_ID}"}` })];
    renderRunsPage('/', rows);

    const nameElement = await screen.findByText(RISK_SCENARIO_NAME);
    expect(nameElement.tagName).toBe('A');
  });

  describe('date window', () => {
    const startOfDay = (date: string): string => new Date(`${date}T00:00:00.000`).toISOString();
    const dateField = (label: string): Promise<HTMLElement> => screen.findByRole('button', { name: label });

    it('shows the window of the address in the language of the application, under a label of its own', async () => {
      const { lastRunsCall } = renderRunsPage('/?dateFrom=2026-09-01&dateTo=2026-09-30');

      expect((await dateField('Start of the date window')).textContent).toContain('Sep 1, 2026');
      expect((await dateField('End of the date window')).textContent).toContain('Sep 30, 2026');
      await waitFor(() => expect(lastRunsCall()).toMatchObject({ enqueuedFrom: startOfDay('2026-09-01') }));
    });

    it('filters from the day picked in the calendar', async () => {
      const { lastRunsCall } = renderRunsPage('/?dateFrom=2026-09-01');

      fireEvent.click(await dateField('Start of the date window'));
      fireEvent.click(within(await screen.findByRole('grid')).getByText('15'));

      await waitFor(() => expect(lastRunsCall()).toMatchObject({ enqueuedFrom: startOfDay('2026-09-15') }));
    });

    it('drops the bound when the day is cleared', async () => {
      const { lastRunsCall } = renderRunsPage('/?dateFrom=2026-09-01');
      await waitFor(() => expect(lastRunsCall()).toMatchObject({ enqueuedFrom: startOfDay('2026-09-01') }));

      fireEvent.click(await dateField('Start of the date window'));
      fireEvent.click(await screen.findByText('Clear the date'));

      await waitFor(() => expect(lastRunsCall()).toMatchObject({ enqueuedFrom: null }));
    });
  });

  describe('service account references', () => {
    const connectorRows = [run({
      id: 'run-1',
      kind: 'cve-first',
      triggeredBy: 'connector',
      triggeredById: SERVICE_ACCOUNT_ID,
      payload: `{"serviceAccountId":"${SERVICE_ACCOUNT_ID}"}`,
    })];

    it('asks for the service account\'s name and shows it, with MANAGE_SECURITY', async () => {
      const { calls } = renderRunsPage('/', connectorRows, true);

      expect(await screen.findByText(SERVICE_ACCOUNT_NAME)).toBeDefined();
      expect(calls.some((c) => c.path === 'serviceAccounts.getNamesByIds')).toBe(true);
    });

    it('never asks for it and shows "Service account", with no link and no id prefix, without MANAGE_SECURITY', async () => {
      const { calls } = renderRunsPage('/', connectorRows, false);

      const credits = await screen.findAllByText('Service account');
      expect(credits.some((element) => element.closest('a') !== null)).toBe(false);
      expect(screen.queryByText(SERVICE_ACCOUNT_ID.slice(0, 8))).toBeNull();
      // Wait until the page has settled on its answer, the capability probe or the lookup it gates,
      // so the absence asserted below is not just a request that has not left yet.
      await waitFor(() => expect(calls.some((c) => c.path === 'capabilities.hasManageSecurity' || c.path === 'serviceAccounts.getNamesByIds')).toBe(true));
      expect(calls.some((c) => c.path === 'serviceAccounts.getNamesByIds')).toBe(false);
      expect(screen.queryByText(SERVICE_ACCOUNT_NAME)).toBeNull();
    });

    it('links the id prefix while the name is loading, then the name once it lands, with MANAGE_SECURITY', async () => {
      let deliverNames: (rows: Array<{ id: string, name: string }>) => void = () => undefined;
      const names = new Promise((resolve) => {
        deliverNames = resolve;
      });
      renderRunsPage('/', connectorRows, true, { 'serviceAccounts.getNamesByIds': names });

      const prefix = await screen.findByText(SERVICE_ACCOUNT_ID.slice(0, 8));
      expect(prefix.closest('a')).not.toBeNull();

      deliverNames([{ id: SERVICE_ACCOUNT_ID, name: SERVICE_ACCOUNT_NAME }]);

      const name = await screen.findByText(SERVICE_ACCOUNT_NAME);
      expect(name.closest('a')).not.toBeNull();
    });

    it('links the id prefix, never "Service account", while the MANAGE_SECURITY probe is loading', async () => {
      let answerProbe: (hasManageSecurity: boolean) => void = () => undefined;
      const probe = new Promise((resolve) => {
        answerProbe = resolve;
      });
      renderRunsPage('/', connectorRows, true, { 'capabilities.hasManageSecurity': probe });
      const cellOf = (element: HTMLElement): HTMLElement => {
        const cell = element.closest('td');
        if (cell === null) {
          throw new Error('the reference is not in a table cell');
        }
        return cell;
      };

      // Scoped to the reference's cell: the Triggered by column labels the connector trigger "Service account" too.
      const prefix = await screen.findByText(SERVICE_ACCOUNT_ID.slice(0, 8));
      expect(prefix.closest('a')).not.toBeNull();
      expect(within(cellOf(prefix)).queryByText('Service account')).toBeNull();

      answerProbe(true);

      const name = await screen.findByText(SERVICE_ACCOUNT_NAME);
      expect(within(cellOf(name)).queryByText('Service account')).toBeNull();
    });

    it('keeps the id prefix link when the name lookup fails, with MANAGE_SECURITY', async () => {
      const { calls } = renderRunsPage('/', connectorRows, true, { 'serviceAccounts.getNamesByIds': FAILED });

      await waitFor(() => expect(calls.some((c) => c.path === 'serviceAccounts.getNamesByIds')).toBe(true));
      const prefix = await screen.findByText(SERVICE_ACCOUNT_ID.slice(0, 8));
      expect(prefix.closest('a')).not.toBeNull();
    });
  });
});
