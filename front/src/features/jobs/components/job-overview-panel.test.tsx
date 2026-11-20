/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobKindDetail } from '../job-detail-types';
import { connectorSlug } from '../../integrations/connector-route-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { JobOverviewPanel } from './job-overview-panel';

// `Link`'s `to` is typed against the app's generated route tree, which this file has no part in:
// only the connector it targets matters here.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, params }: { children: ReactNode, params?: { connectorSlug?: string } }) => (
      <a data-connector-slug={params?.connectorSlug}>{children}</a>
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

const jobKind = (overrides: Partial<JobKindDetail> & Pick<JobKindDetail, 'kind'>): JobKindDetail => ({
  observed: false,
  daily: false,
  health: 'never_ran',
  activeRun: null,
  lastRun: null,
  ...overrides,
});

const renderPanel = (job: JobKindDetail) =>
  renderWithTrpc(<JobOverviewPanel kind={job.kind} />, { answers: { 'jobs.getJobKind': job } });

describe('JobOverviewPanel', () => {
  it('links a connector-backed kind to its connector', async () => {
    renderPanel(jobKind({ kind: 'cve-epss-sync' }));

    const link = (await screen.findByText('Open the connector')).closest('a');
    expect(link?.getAttribute('data-connector-slug')).toBe(connectorSlug('first'));
  });

  it('offers no connector link for a kind no connector runs', async () => {
    renderPanel(jobKind({ kind: 'crq-simulation' }));

    expect(await screen.findByText('Details')).toBeDefined();
    expect(screen.queryByText('Open the connector')).toBeNull();
  });

  it('shows the progress of the run in flight', async () => {
    renderPanel(jobKind({
      kind: 'crq-simulation',
      health: 'running',
      activeRun: {
        id: 'run-1',
        status: 'running',
        enqueuedAt: '2026-09-15T10:00:00.000Z',
        startedAt: '2026-09-15T10:00:01.000Z',
        claimedAt: '2026-09-15T10:00:01.000Z',
        finishedAt: null,
        processedTotal: 40,
        expectedTotal: 80,
        attempt: 1,
        maxAttempts: 3,
        triggeredBy: 'user',
        triggeredById: null,
        askedByOthers: false,
      },
    }));

    expect(await screen.findByText('Current run')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toBeDefined();
    expect(screen.getByText('50 %')).toBeDefined();
  });
});
