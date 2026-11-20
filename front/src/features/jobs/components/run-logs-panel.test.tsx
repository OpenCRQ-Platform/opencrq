/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  stripSearchParams,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JobLogGroup, JobLogLineData } from '../run-types';
import { LOGS_LIST_SEARCH_DEFAULTS, logsListSearchSchema } from '../logs-list-search';
import { RunLogsPanel } from './run-logs-panel';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const line = (overrides: Partial<JobLogLineData> & Pick<JobLogLineData, 'id' | 'level' | 'message'>): JobLogLineData => ({
  detail: null,
  occurredAt: '2026-09-15T10:00:00.000Z',
  ...overrides,
});

const group: JobLogGroup = {
  runId: 'run-1',
  status: 'succeeded',
  startedAt: '2026-09-15T09:59:00.000Z',
  lines: [
    line({ id: 'line-error', level: 'error', message: 'boom failure' }),
    line({ id: 'line-trace', level: 'trace', message: 'startup trace' }),
  ],
};

/**
 * The panel reads its filters off the address, so it is mounted on a route carrying the same
 * schema its two real hosts declare rather than rendered bare.
 */
const renderPanel = () => {
  const rootRoute = createRootRoute({
    validateSearch: logsListSearchSchema,
    search: { middlewares: [stripSearchParams(LOGS_LIST_SEARCH_DEFAULTS)] },
    component: () => (
      <I18nProvider i18n={i18n}>
        <RunLogsPanel data={{ groups: [group] }} isPending={false} error={null} retention="runs" />
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
};

describe('RunLogsPanel', () => {
  it('keeps only the lines matching the search and drops the rest', async () => {
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByPlaceholderText('Filter these lines...')).toBeDefined());

    fireEvent.change(screen.getByPlaceholderText('Filter these lines...'), { target: { value: 'boom' } });
    fireEvent.blur(screen.getByPlaceholderText('Filter these lines...'));

    await waitFor(() => expect(container.textContent).not.toContain('startup trace'));
    expect(container.textContent).toContain('boom failure');
  });

  it('narrows the visible lines to the selected level without shrinking the levels still on offer', async () => {
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle the options' })).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Toggle the options' }));
    fireEvent.click(screen.getByRole('option', { name: 'error' }));
    await waitFor(() => expect(container.textContent).not.toContain('startup trace'));

    // The filter took effect: the trace line is gone, the error line stays.
    expect(container.textContent).toContain('boom failure');
    expect(container.textContent).not.toContain('startup trace');

    // Selecting "error" must not have removed "trace" from the choices the dropdown still offers.
    const listbox = screen.getByRole('listbox', { name: 'Suggestions' });
    expect(within(listbox).getByRole('option', { name: 'error' })).toBeDefined();
    expect(within(listbox).getByRole('option', { name: 'trace' })).toBeDefined();
  });
});
