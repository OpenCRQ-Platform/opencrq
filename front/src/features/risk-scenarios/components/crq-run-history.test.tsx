/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { CrqRunHistory } from './crq-run-history';

const RISK_SCENARIO_ID = '00000000-0000-0000-0000-0000000000a1';
const persisted: { pageSize: number, sorting: Array<{ id: string, desc: boolean }> | null } = { pageSize: 50, sorting: null };

vi.mock('../../../hooks', () => ({
  usePersistedPageSize: () => ({ pageSize: persisted.pageSize }),
  usePersistedSorting: (_id: string, sorting: Array<{ id: string, desc: boolean }>) => ({ sorting: persisted.sorting ?? sorting }),
}));

vi.mock('../../../components/ui/data-page-layout', () => ({
  DataPageLayout: () => null,
}));

vi.mock('../../../components', () => ({
  SectionCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  persisted.pageSize = 50;
  persisted.sorting = null;
});

const renderHistory = () => {
  const rendered = renderWithTrpc(<CrqRunHistory riskScenarioId={RISK_SCENARIO_ID} />, {
    answers: { 'crqIndicators.listRunHistory': { items: [], total: 270 } },
  });
  const lastRequest = () => rendered.calls.filter((call) => call.path === 'crqIndicators.listRunHistory').at(-1)?.input;
  return { ...rendered, lastRequest };
};

describe('CrqRunHistory', () => {
  it('should ask for as many runs as the table pages by, after Reset table brings the page size back', async () => {
    const { rerender, lastRequest } = renderHistory();
    await waitFor(() => expect(lastRequest()).toMatchObject({ page: 1, limit: 50 }));

    persisted.pageSize = 20;
    rerender(<CrqRunHistory riskScenarioId={RISK_SCENARIO_ID} />);

    await waitFor(() => expect(lastRequest()).toMatchObject({ page: 1, limit: 20 }));
  });

  it('should ask for the order the Date header shows', async () => {
    const { rerender, lastRequest } = renderHistory();
    await waitFor(() => expect(lastRequest()).toMatchObject({ sortDesc: true }));

    persisted.sorting = [{ id: 'createdAt', desc: false }];
    rerender(<CrqRunHistory riskScenarioId={RISK_SCENARIO_ID} />);

    await waitFor(() => expect(lastRequest()).toMatchObject({ sortDesc: false }));
  });
});
