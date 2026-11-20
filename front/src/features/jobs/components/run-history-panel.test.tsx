/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JobRunHistory, JobRunListItem } from '../run-types';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { RunHistoryPanel } from './run-history-panel';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const RISK_SCENARIO_ID = '019edb28-0011-7000-8000-000000000001';
const RISK_SCENARIO_NAME = 'Ransomware on the billing system';

const run = (overrides: Partial<JobRunListItem> & Pick<JobRunListItem, 'id' | 'kind'>): JobRunListItem => ({
  status: 'running',
  enqueuedAt: '2026-09-15T10:00:00.000Z',
  startedAt: '2026-09-15T10:00:01.000Z',
  claimedAt: '2026-09-15T10:00:01.000Z',
  finishedAt: null,
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
  triggeredBy: 'user',
  triggeredById: null,
  ...overrides,
});

const history = (inProgress: Array<JobRunListItem>): JobRunHistory => ({
  inProgress,
  completed: [],
  inProgressCount: inProgress.length,
  completedCount: 0,
  serverNow: '2026-09-15T10:05:00.000Z',
});

const renderPanel = (data: JobRunHistory) => {
  const answers = { 'riskScenarios.getNamesByIds': [{ id: RISK_SCENARIO_ID, name: RISK_SCENARIO_NAME }] };

  const rootRoute = createRootRoute({});
  const tenantRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenantId',
    component: (): ReactNode => (
      <RunHistoryPanel
        data={data}
        isPending={false}
        error={null}
        dataUpdatedAt={Date.now()}
        unit={null}
        neverRanLabel="never ran"
        inProgressTitle={(count) => `In progress (${count})`}
        completedTitle={(count) => `Completed (${count})`}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tenantRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return renderWithTrpc(<RouterProvider router={router} />, { answers });
};

describe('RunHistoryPanel — Related to', () => {
  it('resolves a payload reference to its name, as a link, for the kind-scoped runs table', async () => {
    const runs = [run({
      id: 'run-1',
      kind: 'crq-simulation',
      payload: `{"riskScenarioId":"${RISK_SCENARIO_ID}"}`,
    })];

    renderPanel(history(runs));

    const nameElement = await screen.findByText(RISK_SCENARIO_NAME);
    expect(nameElement.tagName).toBe('A');
  });

  it('shows no Related to block for a run whose payload names nothing', async () => {
    const runs = [run({ id: 'run-1', kind: 'cve-first', payload: '{"batchSize":10}' })];

    renderPanel(history(runs));

    expect(await screen.findByText((content) => content.startsWith('cve-first'))).toBeDefined();
    expect(screen.queryByText('Related to')).toBeNull();
  });
});
