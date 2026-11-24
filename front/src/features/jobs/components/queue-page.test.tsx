/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { QueuePage } from './queue-page';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type QueueSections = RouterOutputs['jobs']['listQueue'];
type QueueRunRow = QueueSections['running']['items'][number];
type QueuePendingRow = QueueSections['pending']['items'][number];

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const runRow = (overrides: Partial<QueueRunRow> & Pick<QueueRunRow, 'id' | 'kind'>): QueueRunRow => ({
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

const pendingRow = (overrides: Partial<QueuePendingRow> & Pick<QueuePendingRow, 'id' | 'kind'>): QueuePendingRow => ({
  ...runRow(overrides),
  status: 'queued',
  claimability: 'next',
  ...overrides,
});

// Two kinds per section, ordered so the second entry sorts BEFORE the first alphabetically: a
// section that got secretly re-sorted (or swapped with another section's array) would show
// "kind-alpha-*" first, which none of these fixtures do.
const PENDING_PAGE_1 = [pendingRow({ id: 'pending-1', kind: 'kind-zulu-pending' }), pendingRow({ id: 'pending-2', kind: 'kind-alpha-pending' })];
const PENDING_PAGE_2 = [pendingRow({ id: 'pending-3', kind: 'kind-yankee-pending' }), pendingRow({ id: 'pending-4', kind: 'kind-bravo-pending' })];
const RISK_SCENARIO_ID = '019edb28-0011-7000-8000-000000000001';
const RISK_SCENARIO_NAME = 'Ransomware on the billing system';

const RUNNING_ROWS = [runRow({ id: 'running-1', kind: 'kind-zulu-running', status: 'running' }), runRow({ id: 'running-2', kind: 'kind-alpha-running', status: 'running' })];
const FAILED_ROWS = [runRow({ id: 'failed-1', kind: 'kind-zulu-failed', status: 'dlq' })];
const SUCCEEDED_ROWS = [
  runRow({ id: 'succeeded-1', kind: 'kind-zulu-succeeded', status: 'succeeded' }),
  runRow({ id: 'partial-1', kind: 'kind-yankee-partial', status: 'partial' }),
];

const page = <T extends { id: string }>(items: Array<T>, input: { page: number, limit: number }, total: number) => ({
  items, total, page: input.page, limit: input.limit,
});

interface QueueQueryInput {
  pending: { page: number, limit: number },
  running: { page: number, limit: number },
  failed: { page: number, limit: number },
  succeeded: { page: number, limit: number },
}

const renderQueuePage = (runningRows: Array<QueueRunRow> = RUNNING_ROWS) => {
  const answers = {
    'riskScenarios.getNamesByIds': [{ id: RISK_SCENARIO_ID, name: RISK_SCENARIO_NAME }],
    'jobs.listQueue': (queueInput: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this fake link stands in for the server, which is what would normally validate `op.input` against `QueuePageInput`
      const input = queueInput as QueueQueryInput;
      const pendingItems = input.pending.page === 2 ? PENDING_PAGE_2 : PENDING_PAGE_1;
      return {
        pending: page(pendingItems, input.pending, 15),
        running: page(runningRows, input.running, runningRows.length),
        failed: page(FAILED_ROWS, input.failed, FAILED_ROWS.length),
        succeeded: page(SUCCEEDED_ROWS, input.succeeded, SUCCEEDED_ROWS.length),
        serverNow: '2026-09-15T10:05:00.000Z',
      };
    },
  };

  const rootRoute = createRootRoute({
    component: (): ReactNode => <QueuePage />,
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) });
  const utils = renderWithTrpc(<RouterProvider router={router} />, { answers });

  const lastQueueCall = () => {
    const last = utils.calls.filter((c) => c.path === 'jobs.listQueue').at(-1);
    if (!last) {
      throw new Error('jobs.listQueue was never called');
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- read back the same shape the fake link above accepts
    return last.input as QueueQueryInput;
  };

  return { ...utils, lastQueueCall };
};

const sectionOf = (title: string): HTMLElement => screen.getByRole('region', { name: title });

describe('QueuePage', () => {
  it('renders each of the four sections from its own data, in the server-given order', async () => {
    renderQueuePage();

    await waitFor(() => {
      expect(within(sectionOf('Pending')).queryByText('kind-zulu-pending')).not.toBeNull();
    });

    const pendingKinds = within(sectionOf('Pending')).getAllByText(/^kind-/).map((el) => el.textContent);
    expect(pendingKinds).toEqual(['kind-zulu-pending', 'kind-alpha-pending']);

    const runningKinds = within(sectionOf('Running')).getAllByText(/^kind-/).map((el) => el.textContent);
    expect(runningKinds).toEqual(['kind-zulu-running', 'kind-alpha-running']);

    expect(within(sectionOf('Failed')).getByText('kind-zulu-failed')).toBeDefined();
    expect(within(sectionOf('Succeeded')).getByText('kind-zulu-succeeded')).toBeDefined();
  });

  // The section lists partial segments with the runs that succeeded (#157): each row carries its own
  // status chip, so a partial segment never reads as a success.
  it('shows each finished run its own status in the Succeeded section, partial segments included', async () => {
    renderQueuePage();

    await waitFor(() => {
      expect(within(sectionOf('Succeeded')).queryByText('kind-yankee-partial')).not.toBeNull();
    });

    const succeededSection = within(sectionOf('Succeeded'));
    expect(succeededSection.getByRole('columnheader', { name: 'Status' })).toBeDefined();
    expect(succeededSection.getByText('Partial')).toBeDefined();
    // 'Succeeded' is also the section title: the chip is the second occurrence.
    expect(succeededSection.getAllByText('Succeeded').length).toBeGreaterThanOrEqual(2);
    // Status sits right after Kind, as on the Runs tab, so the date keeps its width.
    const headers = succeededSection.getAllByRole('columnheader').map((el) => el.textContent?.trim());
    expect(headers.indexOf('Status')).toBe(headers.indexOf('Kind') + 1);
  });

  it('paginating the pending section does not repaginate the other three', async () => {
    const { lastQueueCall } = renderQueuePage();

    await waitFor(() => {
      expect(within(sectionOf('Pending')).queryByText('kind-zulu-pending')).not.toBeNull();
    });

    const pendingNextButton = within(sectionOf('Pending')).getByRole('button', { name: 'Go to next page' });
    expect(pendingNextButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(pendingNextButton);

    await waitFor(() => expect(lastQueueCall().pending.page).toBe(2));

    // The request itself: only pending's page moved.
    expect(lastQueueCall()).toMatchObject({
      pending: { page: 2 },
      running: { page: 1 },
      failed: { page: 1 },
      succeeded: { page: 1 },
    });

    // And on screen: pending shows its second page, the other three are unmoved.
    await waitFor(() => {
      expect(within(sectionOf('Pending')).queryByText('kind-yankee-pending')).not.toBeNull();
    });
    expect(within(sectionOf('Pending')).queryByText('kind-zulu-pending')).toBeNull();
    expect(within(sectionOf('Running')).getByText('kind-zulu-running')).toBeDefined();
    expect(within(sectionOf('Failed')).getByText('kind-zulu-failed')).toBeDefined();
    expect(within(sectionOf('Succeeded')).getByText('kind-zulu-succeeded')).toBeDefined();
  });

  it('resolves a payload reference to its name in the Related to column, as a link', async () => {
    const runningRowWithReference = [
      runRow({
        id: 'running-1',
        kind: 'crq-simulation',
        status: 'running',
        payload: `{"riskScenarioId":"${RISK_SCENARIO_ID}"}`,
      }),
    ];
    renderQueuePage(runningRowWithReference);

    const nameElement = await screen.findByText(RISK_SCENARIO_NAME);
    expect(nameElement.tagName).toBe('A');
  });
});
