/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DependencyGraphModel } from '../../asset-dependencies/dependency-graph-utils';
import { NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { RiskScenarioTargets } from './risk-scenario-targets';

const TENANT_ID = '00000000-0000-0000-0000-00000000000f';
const ORGANIZATION_ID = '00000000-0000-0000-0000-00000000000e';

vi.mock('../../../hooks', () => ({
  usePersistedView: <T extends string>(_id: string, defaultView: T) => {
    const [view, setView] = useState(defaultView);
    return { view, setView };
  },
  usePersistedPageSize: (_id: string, pageSize: number) => ({ pageSize }),
  usePersistedSorting: (_id: string, sorting: Array<{ id: string, desc: boolean }>) => ({ sorting }),
}));

interface MockColumn {
  id: string,
  accessorFn?: (row: unknown) => unknown,
  cell: (context: { row: { original: unknown }, getValue: () => unknown }) => ReactNode,
}

vi.mock('../../../components/ui/data-page-layout', () => ({
  DataPageLayout: ({ data, columns, isPlaceholderData, onServerPageChange }: {
    data: Array<{ id: string }>,
    columns: Array<MockColumn>,
    isPlaceholderData: boolean,
    onServerPageChange: (pagination: { pageIndex: number }) => void,
  }) => (
    <>
      <button type="button" onClick={() => onServerPageChange({ pageIndex: 1 })}>Next page</button>
      <table data-placeholder={String(isPlaceholderData)}>
        <tbody>
          <tr><th>header</th></tr>
          {data.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.id}>{column.cell({ row: { original: row }, getValue: () => column.accessorFn?.(row) })}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  ),
}));

const openEdit = vi.fn();
vi.mock('./risk-scenario-edit-context', () => ({
  useOpenRiskScenarioEdit: () => openEdit,
}));

vi.mock('../../asset-dependencies', () => ({
  LinkRoleChips: ({ roles }: { roles: Array<string> }) => <span>{roles.join(',')}</span>,
  DependencyGraphDepthSelect: () => null,
  DependencyGraphCard: ({ model, emptyState }: { model: DependencyGraphModel | null, emptyState: ReactNode }) => (
    model !== null && model.links.length === 0
      ? <div>{emptyState}</div>
      : <div data-testid="graph">{model?.nodes.filter((node) => node.kind === 'primary').map((node) => node.label).join(',')}</div>
  ),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Link: ({ to, params, children }: { to: string, params: Record<string, string>, children: ReactNode }) => (
    <a data-to={to} data-params={JSON.stringify(params)}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ organizationId: ORGANIZATION_ID }),
}));

vi.mock('../../../providers/tenant-provider', () => ({
  useTenant: () => ({ tenantId: TENANT_ID }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LEDGER = { id: '00000000-0000-0000-0000-0000000000a1', name: 'Ledger' };
const PAYMENTS = { id: '00000000-0000-0000-0000-0000000000a2', name: 'Payments' };
const STORE_ID = '00000000-0000-0000-0000-0000000000b1';

const graphOf = (primaryAssets: Array<{ id: string, name: string }>, linked: boolean) => ({
  primaryAssets,
  assets: linked
    ? [{
      id: STORE_ID,
      name: 'db-core-prod',
      categoryId: 'host',
      criticality: 'high',
      exposure: 'internal',
      ownerName: null,
      firstSeenAt: null,
      lastSeenAt: null,
    }]
    : [],
  links: linked
    ? primaryAssets.map((asset, index) => ({ id: `l${index}`, dependentId: asset.id, providerId: STORE_ID, kind: 'depends_on' }))
    : [],
  truncated: [],
  hiddenAssetCount: 0,
});

const RANSOMWARE = { availability: 'full', integrity: 'lower', confidentiality: 'full', traceability: 'none' } as const;
const READS = { availability: 'lower', integrity: 'lower', confidentiality: 'full', traceability: 'none' } as const;

const targetRow = (id: string, name: string, impact: number, overrides: Record<string, unknown> = {}) => ({
  supportingAssetId: id,
  supportingAssetName: name,
  depth: 0,
  via: [LEDGER],
  roles: ['reads'],
  outOfScope: false,
  impact,
  contributions: [{
    primaryAssetId: LEDGER.id,
    primaryAssetName: LEDGER.name,
    hops: 0,
    chain: [],
    roles: ['reads'],
    criteria: READS,
    outcomeTotal: 2.5,
    transmittedTotal: 1.75,
    share: 0.7,
    contribution: impact,
  }],
  ...overrides,
});

const listOf = (primaryAssets: Array<{ id: string, name: string }>, items: Array<ReturnType<typeof targetRow>>) => ({
  attackOutcome: { id: '00000000-0000-0000-0000-0000000000d1', name: 'Ransomware', criteriaReached: RANSOMWARE },
  primaryAssets,
  items,
  total: items.length,
  directCount: items.filter((row) => row.depth === 0).length,
  transitiveCount: items.filter((row) => row.depth > 0).length,
  page: 1,
  limit: 50,
});

const renderWith = (
  graph: ReturnType<typeof graphOf>,
  list: unknown = listOf([LEDGER], [targetRow(STORE_ID, 'db-core-prod', 0.359)]),
) => renderWithTrpc(<RiskScenarioTargets riskScenarioId="00000000-0000-0000-0000-0000000000c1" />, {
  answers: {
    'riskScenarios.getDependencyGraph': graph,
    'riskScenarios.listDerivedSupportingAssets': list,
  },
});

describe('RiskScenarioTargets', () => {
  it('should open on the graph, rooted on every primary asset of the scenario', async () => {
    renderWith(graphOf([LEDGER, PAYMENTS], true));

    await waitFor(() => expect(screen.getByTestId('graph').textContent).toBe('Ledger,Payments'));
  });

  it('should show the table of targeted supporting assets once the list is chosen', async () => {
    const page1 = listOf([LEDGER], [targetRow(STORE_ID, 'db-core-prod', 0.359)]);
    const { calls } = renderWith(
      graphOf([LEDGER, PAYMENTS], true),
      (input: { page: number }) => (input.page === 1 ? page1 : NEVER),
    );
    const listCalls = () => calls.filter((call) => call.path === 'riskScenarios.listDerivedSupportingAssets');

    fireEvent.click(await screen.findByLabelText('List view'));

    expect(screen.queryByTestId('graph')).toBeNull();
    expect(await screen.findByText('1 direct and 0 transitive supporting assets derived from dependency chains.')).toBeTruthy();
    expect(listCalls().at(-1)?.input).toEqual(
      { riskScenarioId: '00000000-0000-0000-0000-0000000000c1', page: 1, limit: 50, sortBy: 'impact', sortDesc: true },
    );
    expect(screen.getByText('db-core-prod')).toBeTruthy();
    expect(screen.getByRole('table').dataset.placeholder).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(listCalls().at(-1)?.input).toMatchObject({ page: 2 }));
    expect(screen.getByText('db-core-prod')).toBeTruthy();
    expect(screen.getByRole('table').dataset.placeholder).toBe('true');
  });

  it('should offer no button to add a dependency', async () => {
    renderWith(graphOf([LEDGER], true));
    await screen.findByTestId('graph');

    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
  });

  it('should name the sole primary asset and open its dependencies when it has none', async () => {
    renderWith(graphOf([LEDGER], false));

    expect(await screen.findByText('No dependency is declared for Ledger.')).toBeTruthy();
    const open = screen.getByText('Open Ledger').closest('a');
    expect(open?.dataset.to).toBe('/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId/dependencies');
    expect(JSON.parse(open?.dataset.params ?? '{}')).toEqual({
      tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, primaryAssetId: LEDGER.id,
    });
  });

  it('should name no primary asset when several have no dependency', async () => {
    renderWith(graphOf([LEDGER, PAYMENTS], false));

    expect(await screen.findByText('No dependency is declared for the primary assets of this scenario.')).toBeTruthy();
    expect(screen.queryByText(/^Open /)).toBeNull();
  });

  it('should lead a scenario with no primary asset to its Edit drawer, in both views', async () => {
    renderWith(graphOf([], false), listOf([], []));

    fireEvent.click(await screen.findByRole('button', { name: 'Target a primary asset' }));
    expect(openEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('List view'));
    expect(await screen.findByText('This scenario targets no primary asset')).toBeTruthy();
  });

  it('should wait rather than claim no primary asset while the list has neither data nor an error', async () => {
    renderWith(graphOf([LEDGER], true), NEVER);

    fireEvent.click(await screen.findByLabelText('List view'));

    expect(screen.queryByText('This scenario targets no primary asset')).toBeNull();
    expect(screen.queryByText(/No dependency is declared/)).toBeNull();
  });

  it('should keep the no dependency message in the list when the primary assets have none', async () => {
    renderWith(graphOf([LEDGER], false), listOf([LEDGER], []));

    fireEvent.click(await screen.findByLabelText('List view'));

    expect(await screen.findByText('No dependency is declared for Ledger.')).toBeTruthy();
  });

  it('should keep the rows in the order the server ranked them, and read the truncated figure', async () => {
    renderWith(graphOf([LEDGER], true), listOf([LEDGER], [
      targetRow('00000000-0000-0000-0000-0000000000b4', 'Zulu', 1),
      targetRow('00000000-0000-0000-0000-0000000000b2', 'Alpha', 0.5),
      targetRow('00000000-0000-0000-0000-0000000000b3', 'Bravo', 0.5, { outOfScope: true }),
      targetRow(STORE_ID, 'db-core-prod', 0.359),
    ]));

    fireEvent.click(await screen.findByLabelText('List view'));

    const rowNames = () => screen.getAllByRole('row').slice(1).map((row) => row.querySelector('td')?.textContent);
    await waitFor(() => expect(rowNames()).toEqual(['Zulu', 'Alpha', 'BravoOut of scope', 'db-core-prod']));
    expect(screen.getByRole('img', { name: 'Impact if compromised: 35% of the scenario\'s loss, Low' })).toBeTruthy();
  });
});
