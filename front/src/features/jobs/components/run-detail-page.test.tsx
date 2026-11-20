/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { RunDetailPage } from './run-detail-page';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type RunDetail = NonNullable<RouterOutputs['jobs']['getRun']>;

// `Link`'s `to`/`from` are typed against the app's own generated route tree, which this file has
// no part in; only whether the right run id is targeted matters here, so the mock keeps that one
// fact (`params.runId`) and drops routing altogether — the same trade run-logs-panel-adjacent
// component tests already make for `<Link>`.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, params }: { children: ReactNode, params?: { runId?: string, jobKind?: string } }) => (
      <a data-run-id={params?.runId} data-job-kind={params?.jobKind}>{children}</a>
    ),
  };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const run = (overrides: Partial<RunDetail> & Pick<RunDetail, 'id' | 'kind'>): RunDetail => ({
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
  triggeredBy: 'user',
  triggeredById: null,
  absorbedAsk: false,
  interactive: false,
  payload: null,
  answeredById: null,
  ...overrides,
});

const USER_ID = 'a4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f';
const USER_NAME = 'Jamie Rivera';
const SERVICE_ACCOUNT_ID = 'b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f';
const SERVICE_ACCOUNT_NAME = 'CVE sync';
const RISK_SCENARIO_ID = '019edb28-0011-7000-8000-000000000001';
const RISK_SCENARIO_NAME = 'Ransomware on the billing system';

const NAMES_BY_ID: Record<string, Array<{ id: string, name: string }>> = {
  'tenants.getTenantUserNamesByIds': [{ id: USER_ID, name: USER_NAME }],
  'serviceAccounts.getNamesByIds': [{ id: SERVICE_ACCOUNT_ID, name: SERVICE_ACCOUNT_NAME }],
  'riskScenarios.getNamesByIds': [{ id: RISK_SCENARIO_ID, name: RISK_SCENARIO_NAME }],
};

const LOG_MESSAGE = 'Imported 12 vulnerabilities';

const logsFor = (runId: string) => ({
  groups: [{
    runId,
    status: 'succeeded' as const,
    startedAt: '2026-09-15T10:00:01.000Z',
    lines: [{ id: 'line-1', level: 'trace' as const, message: LOG_MESSAGE, detail: null, occurredAt: '2026-09-15T10:00:02.000Z' }],
  }],
});

const renderRunDetailPage = (initialRun: RunDetail, hasManageSecurity = true) => {
  const answers: Record<string, unknown> = {
    ...NAMES_BY_ID,
    'jobs.getRun': initialRun,
    'jobs.listRunLogs': logsFor(initialRun.id),
    'capabilities.hasManageSecurity': hasManageSecurity,
  };
  // A `$tenantId` segment so `useRunReferences` — gated on a real tenant id, as it is in every
  // route this page actually renders under — resolves user and service account references.
  const rootRoute = createRootRoute({});
  const tenantRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenantId',
    component: (): ReactNode => <RunDetailPage initialRun={initialRun} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tenantRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  const utils = renderWithTrpc(<RouterProvider router={router} />, { answers });
  return { ...utils, router };
};

describe('RunDetailPage — absorbed-ask section', () => {
  it('renders the absorbed-ask mention and the link to the successor, for a survivor that has one', async () => {
    const survivor = run({
      id: 'run-survivor',
      kind: 'cve-first',
      absorbedAsk: true,
      answeredById: 'run-successor',
      triggeredBy: 'user',
      triggeredById: null,
    });

    const { router } = renderRunDetailPage(survivor);
    await router.load();

    expect(await screen.findByText('Another request arrived while this run was working.')).toBeDefined();
    const link = screen.getByText('Answered by this run').closest('a');
    expect(link?.getAttribute('data-run-id')).toBe('run-successor');

    expect(screen.queryByText('Answers an ask absorbed by this run.')).toBeNull();
  });

  it('renders the mention with no link when the successor has not been reserved yet', async () => {
    const survivor = run({
      id: 'run-survivor',
      kind: 'cve-first',
      absorbedAsk: true,
      answeredById: null,
    });

    const { router } = renderRunDetailPage(survivor);
    await router.load();

    expect(await screen.findByText('Another request arrived while this run was working.')).toBeDefined();
    expect(screen.queryByText('Answered by this run')).toBeNull();
  });

  it('renders the reverse link on the successor that answers an absorbed ask', async () => {
    const successor = run({
      id: 'run-successor',
      kind: 'cve-first',
      absorbedAsk: false,
      triggeredBy: 'system',
      triggeredById: 'run-survivor',
    });

    const { router } = renderRunDetailPage(successor);
    await router.load();

    expect(await screen.findByText('Answers an ask absorbed by this run.')).toBeDefined();
    const link = screen.getByText('The run it answers').closest('a');
    expect(link?.getAttribute('data-run-id')).toBe('run-survivor');

    expect(screen.queryByText('Another request arrived while this run was working.')).toBeNull();
  });

  it('renders neither mention for an ordinary run', async () => {
    const ordinary = run({
      id: 'run-ordinary',
      kind: 'cve-first',
      absorbedAsk: false,
      triggeredBy: 'user',
      triggeredById: null,
    });

    const { router } = renderRunDetailPage(ordinary);
    await router.load();

    // Something else on the page proves the run actually rendered — an all-null assertion set
    // would otherwise pass just as well against a page that rendered nothing at all.
    expect(await screen.findByText('Identity')).toBeDefined();
    expect(screen.queryByText('Absorbed ask')).toBeNull();
    expect(screen.queryByText('Another request arrived while this run was working.')).toBeNull();
    expect(screen.queryByText('Answers an ask absorbed by this run.')).toBeNull();
  });
});

describe('RunDetailPage — triggered by id', () => {
  it('resolves a user trigger to the tenant member\'s name, as a link', async () => {
    const userTriggered = run({
      id: 'run-1',
      kind: 'cve-first',
      triggeredBy: 'user',
      triggeredById: USER_ID,
    });

    renderRunDetailPage(userTriggered);

    const nameElement = await screen.findByText(USER_NAME);
    expect(nameElement.tagName).toBe('A');
  });

  it('resolves a connector trigger to the service account\'s name, as a link', async () => {
    const connectorTriggered = run({
      id: 'run-1',
      kind: 'cve-first',
      triggeredBy: 'connector',
      triggeredById: SERVICE_ACCOUNT_ID,
    });

    renderRunDetailPage(connectorTriggered);

    const nameElement = await screen.findByText(SERVICE_ACCOUNT_NAME);
    expect(nameElement.tagName).toBe('A');
  });

  it('shows a connector trigger as "Service account" alone, with no "Triggered by id" field, without asking for the name, when MANAGE_SECURITY is missing', async () => {
    const connectorTriggered = run({
      id: 'run-1',
      kind: 'cve-first',
      triggeredBy: 'connector',
      triggeredById: SERVICE_ACCOUNT_ID,
    });

    const { calls } = renderRunDetailPage(connectorTriggered, false);

    await screen.findAllByText('Service account');
    // The id field shows its prefix until the capability probe answers, then leaves.
    await waitFor(() => expect(screen.queryByText('Triggered by id')).toBeNull());
    expect(screen.getAllByText('Service account')).toHaveLength(1);
    expect(screen.queryByText(SERVICE_ACCOUNT_ID.slice(0, 8))).toBeNull();
    expect(calls.map((call) => call.path)).toContain('capabilities.hasManageSecurity');
    expect(calls.map((call) => call.path)).not.toContain('serviceAccounts.getNamesByIds');
    expect(screen.queryByText(SERVICE_ACCOUNT_NAME)).toBeNull();
  });

  it('labels the "Triggered by" field of a connector run "Service account", not "Manual sync"', async () => {
    const connectorTriggered = run({
      id: 'run-1',
      kind: 'cve-first',
      triggeredBy: 'connector',
      triggeredById: SERVICE_ACCOUNT_ID,
    });

    renderRunDetailPage(connectorTriggered);

    await screen.findByText(SERVICE_ACCOUNT_NAME);
    expect(screen.getAllByText('Service account').length).toBeGreaterThan(0);
    expect(screen.queryByText('Manual sync')).toBeNull();
  });

  it('leaves a system trigger answering an absorbed ask as the raw run id, not a resolved reference', async () => {
    const systemTriggered = run({
      id: 'run-successor',
      kind: 'cve-first',
      triggeredBy: 'system',
      triggeredById: 'run-survivor',
    });

    renderRunDetailPage(systemTriggered);

    expect(await screen.findAllByText('run-survivor')).not.toHaveLength(0);
  });
});

describe('RunDetailPage — payload references', () => {
  it('resolves a payload reference to its name in the Related to field, as a link', async () => {
    const scenarioRun = run({
      id: 'run-1',
      kind: 'crq-simulation',
      payload: `{"riskScenarioId":"${RISK_SCENARIO_ID}"}`,
    });

    renderRunDetailPage(scenarioRun);

    const nameElement = await screen.findByText(RISK_SCENARIO_NAME);
    expect(nameElement.tagName).toBe('A');
  });

  it('shows an empty value in the Related to field for a payload with no reference', async () => {
    const plainRun = run({ id: 'run-1', kind: 'cve-first', payload: '{"batchSize":10}' });

    renderRunDetailPage(plainRun);

    expect(await screen.findByText('Parameters')).toBeDefined();
    expect(screen.queryByText(RISK_SCENARIO_NAME)).toBeNull();
  });
});

describe('RunDetailPage — logs', () => {
  it('shows the lines this run wrote, without the retention note of a kind\'s log history', async () => {
    renderRunDetailPage(run({ id: 'run-1', kind: 'cve-first' }));

    expect(await screen.findByText(LOG_MESSAGE)).toBeDefined();
    expect(screen.queryByText('Older runs are not kept.')).toBeNull();
  });
});

describe('RunDetailPage — progress', () => {
  it('shows the progress and the current step of a running run', async () => {
    renderRunDetailPage(run({
      id: 'run-1',
      kind: 'cve-first',
      status: 'running',
      finishedAt: null,
      processedTotal: 25,
      expectedTotal: 100,
      currentStep: 'Fetching EPSS scores',
    }));

    expect(await screen.findByRole('progressbar', { name: 'Progress' })).toBeDefined();
    expect(screen.getByText('25 %')).toBeDefined();
    expect(screen.getByText('Fetching EPSS scores')).toBeDefined();
  });

  it('shows no progress for a run that never reported an expected total', async () => {
    renderRunDetailPage(run({ id: 'run-1', kind: 'cve-first' }));

    expect(await screen.findByText('Chronology')).toBeDefined();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
