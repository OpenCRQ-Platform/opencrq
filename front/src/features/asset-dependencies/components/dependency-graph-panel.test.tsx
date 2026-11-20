/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  DependencyGraphEdge,
  DependencyGraphModel,
  DependencyGraphNode,
  DependencyGraphPayloadAsset,
} from '../dependency-graph-utils';
import { aggregateNodeId, drawnEdges, INTERNET_NODE_ID } from '../dependency-graph-utils';
import { formatDate } from '../../../utils';
import { DependencyGraphPanel } from './dependency-graph-panel';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, Link: ({ children }: { children: ReactElement }) => children, useParams: () => ({}) };
});

vi.mock('../hooks/use-primary-asset-scope', () => ({
  usePrimaryAssetScope: () => '00000000-0000-0000-0000-0000000000e1',
}));

vi.mock('../../../providers/tenant-provider', () => ({
  useTenant: () => ({ tenantId: '00000000-0000-0000-0000-00000000000f' }),
}));

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ effectiveTheme: 'light' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const SELECTED_ID = '00000000-0000-0000-0000-00000000000a';

const asset = (overrides: Partial<DependencyGraphPayloadAsset> = {}): DependencyGraphPayloadAsset => ({
  id: SELECTED_ID,
  name: 'esx-cluster-02',
  derivedName: null,
  categoryId: 'host',
  criticality: 'high',
  exposure: 'internal',
  ownerName: 'Claire Fontaine',
  firstSeenAt: '2024-03-04T00:00:00.000Z',
  lastSeenAt: '2026-09-21T00:00:00.000Z',
  postureScore: null,
  criticalFindingCount: 0,
  highFindingCount: 0,
  ...overrides,
});

const assetNode = (id: string, name: string, overrides: Partial<DependencyGraphPayloadAsset> = {}): DependencyGraphNode => ({
  id,
  label: name,
  kind: 'asset',
  level: 2,
  asset: asset({ id, name, ...overrides }),
  hiddenProviderCount: 0,
});

const internetNode = (): DependencyGraphNode => ({
  id: INTERNET_NODE_ID,
  label: 'Internet',
  kind: 'internet',
  level: 3,
  asset: null,
  hiddenProviderCount: 0,
});

/** The selected asset, linked to each provider and from each dependent. */
const modelAround = (
  selected: DependencyGraphNode,
  providers: Array<DependencyGraphNode> = [],
  dependents: Array<DependencyGraphNode> = [],
): DependencyGraphModel => ({
  nodes: [selected, ...providers, ...dependents],
  links: [
    ...providers.map((provider) => ({
      id: `p:${provider.id}`, source: selected.id, target: provider.id, kind: 'depends_on' as const, roles: null,
    })),
    ...dependents.map((dependent) => ({
      id: `d:${dependent.id}`, source: dependent.id, target: selected.id, kind: 'depends_on' as const, roles: null,
    })),
  ],
  hiddenAssetCount: 0,
});

const renderPanel = (
  node: DependencyGraphNode,
  model: DependencyGraphModel = modelAround(node),
  exposedAssetCount = 0,
  handlers: {
    onClose?: () => void,
    onSelectEdge?: (id: string) => void,
    onEditLink?: (link: DependencyGraphEdge) => void,
    opensItsPage?: boolean,
  } = {},
) =>
  render(
    <I18nProvider i18n={i18n}>
      <DependencyGraphPanel
        node={node}
        model={model}
        exposedAssetCount={exposedAssetCount}
        edges={drawnEdges(model)}
        opensItsPage={handlers.opensItsPage ?? true}
        onSelectEdge={handlers.onSelectEdge ?? vi.fn()}
        onEditLink={handlers.onEditLink ?? vi.fn()}
        onClose={handlers.onClose ?? vi.fn()}
      />
    </I18nProvider>,
  );

/** The names a neighbour list holds, in order. */
const listed = (title: string): Array<string> =>
  within(screen.getByRole('list', { name: title })).getAllByRole('listitem').map((item) => item.textContent ?? '');

describe('DependencyGraphPanel', () => {
  it('shows the asset posture on its gauge, with the way to its explanation', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02', { postureScore: 30 }));

    expect(screen.getByRole('img', { name: 'OpenCRQ Posture score: 30 out of 100, weak' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How the OpenCRQ Posture is computed' })).toBeTruthy();
  });

  it('says there is nothing to measure when the asset has no posture', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02'));

    expect(screen.getByTitle('OpenCRQ Posture: no applicable finding to measure')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'How the OpenCRQ Posture is computed' })).toBeNull();
  });

  it('counts the critical and high findings on the Findings row', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02', { criticalFindingCount: 1, highFindingCount: 3 }));

    const row = screen.getByText('Findings').closest('div');
    expect(row?.textContent).toContain('1 critical');
    expect(row?.textContent).toContain('3 high');
  });

  it('writes a dash on the Findings row when the asset has no critical or high finding', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02'));

    expect(screen.getByText('Findings').closest('div')?.querySelector('dd')?.textContent).toBe('-');
  });

  it('names the asset and writes its category under the name', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02'));

    expect(screen.getByText('esx-cluster-02')).toBeTruthy();
    expect(screen.getByText('Host')).toBeTruthy();
  });

  it('names the field every value answers', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02'));

    for (const label of ['Criticality', 'Exposure', 'Owner', 'First observation', 'Last observation']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('states the criticality, exposure and owner', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02'));

    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Internal')).toBeTruthy();
    expect(screen.getByText('Claire Fontaine')).toBeTruthy();
  });

  it('renders both observation dates through the shared formatter, which follows the app locale', () => {
    renderPanel(assetNode(SELECTED_ID, 'esx-cluster-02'));

    expect(screen.getByText(formatDate('2024-03-04T00:00:00.000Z'))).toBeTruthy();
  });

  it('lists what supports the asset and what it supports', () => {
    const selected = assetNode(SELECTED_ID, 'esx-cluster-02');
    renderPanel(selected, modelAround(
      selected,
      [assetNode('p1', 'vcenter-prod')],
      [assetNode('d1', 'srv-fact-app-01'), assetNode('d2', 'db-fact-prod')],
    ));

    expect(listed('Supported by')).toEqual(['vcenter-prod']);
    expect(listed('Supporting')).toEqual(['srv-fact-app-01', 'db-fact-prod']);
  });

  it('shows in the graph the link a neighbour stands at the other end of', () => {
    const onSelectEdge = vi.fn();
    const selected = assetNode(SELECTED_ID, 'esx-cluster-02');
    renderPanel(selected, modelAround(selected, [assetNode('p1', 'vcenter-prod')]), 0, { onSelectEdge });

    fireEvent.click(screen.getByRole('button', { name: 'Show the link with vcenter-prod in the graph' }));

    expect(onSelectEdge).toHaveBeenCalledWith('p:p1');
  });

  it('gives the roles of the link to the primary asset on its line, with a pencil that edits that link', () => {
    const onEditLink = vi.fn();
    const selected = assetNode(SELECTED_ID, 'db-fact-prod');
    const primary: DependencyGraphNode = {
      id: 'primary', label: 'Customer billing', kind: 'primary', level: 0, asset: null, hiddenProviderCount: 0,
    };
    const link: DependencyGraphEdge = { id: 'l1', source: 'primary', target: SELECTED_ID, kind: 'depends_on', roles: ['stores', 'processes'] };
    renderPanel(selected, { nodes: [selected, primary], links: [link], hiddenAssetCount: 0 }, 0, { onEditLink });

    const line = within(screen.getByRole('list', { name: 'Supporting' })).getByRole('listitem');
    expect(within(line).getByLabelText('Roles of the link with Customer billing: Stores, Processes')).toBeTruthy();
    fireEvent.click(within(line).getByLabelText('Edit the link with Customer billing'));

    expect(onEditLink).toHaveBeenCalledWith(link);
  });

  it('lists what supports a primary asset, each line with its roles and a pencil, and no asset field', () => {
    const onEditLink = vi.fn();
    const primary: DependencyGraphNode = {
      id: 'primary', label: 'Customer billing', kind: 'primary', level: 0, asset: null, hiddenProviderCount: 0,
    };
    const supporting = assetNode(SELECTED_ID, 'db-fact-prod');
    const link: DependencyGraphEdge = { id: 'l1', source: 'primary', target: SELECTED_ID, kind: 'depends_on', roles: ['stores'] };
    renderPanel(primary, { nodes: [primary, supporting], links: [link], hiddenAssetCount: 0 }, 0, { onEditLink });

    expect(screen.getByText('Primary asset')).toBeTruthy();
    const line = within(screen.getByRole('list', { name: 'Supported by' })).getByRole('listitem');
    expect(within(line).getByLabelText('Roles of the link with db-fact-prod: Stores')).toBeTruthy();
    fireEvent.click(within(line).getByLabelText('Edit the link with db-fact-prod'));
    expect(onEditLink).toHaveBeenCalledWith(link);
    expect(screen.queryByText('Criticality')).toBeNull();
    expect(screen.queryByText('Supporting')).toBeNull();
  });

  it('opens the page of a primary asset, unless the graph is drawn on that page', () => {
    const primary: DependencyGraphNode = {
      id: 'primary', label: 'Customer billing', kind: 'primary', level: 0, asset: null, hiddenProviderCount: 0,
    };
    renderPanel(primary, modelAround(primary));
    expect(screen.getByText('Open the asset')).toBeTruthy();
    cleanup();

    renderPanel(primary, modelAround(primary), 0, { opensItsPage: false });
    expect(screen.queryByText('Open the asset')).toBeNull();
  });

  it('shows no role on an asset only other supporting assets depend on', () => {
    const selected = assetNode(SELECTED_ID, 'esx-cluster-02');
    renderPanel(selected, modelAround(selected, [], [assetNode('d1', 'srv-fact-app-01')]));

    expect(screen.queryByLabelText(/^Roles of the link/)).toBeNull();
    expect(screen.queryByLabelText(/^Edit the link/)).toBeNull();
  });

  it('names an aggregate provider by the count it stands for', () => {
    const selected = assetNode(SELECTED_ID, 'esx-cluster-02');
    const aggregate: DependencyGraphNode = {
      id: aggregateNodeId(SELECTED_ID),
      label: '',
      kind: 'aggregate',
      level: 3,
      asset: null,
      hiddenProviderCount: 12,
    };
    renderPanel(selected, modelAround(selected, [aggregate]));

    expect(screen.getByText('12 assets')).toBeTruthy();
  });

  it('counts the neighbours past the third instead of listing them', () => {
    const selected = assetNode(SELECTED_ID, 'esx-cluster-02');
    const dependents = ['a', 'b', 'c', 'd', 'e'].map((name) => assetNode(`d-${name}`, name));
    renderPanel(selected, modelAround(selected, [], dependents));

    expect(listed('Supporting')).toEqual(['a', 'b', 'c', 'and 2 more']);
  });

  it('counts an aggregate past the third name as the assets it folds, not as one', () => {
    const selected = assetNode(SELECTED_ID, 'esx-cluster-02');
    const aggregate: DependencyGraphNode = {
      id: aggregateNodeId(SELECTED_ID),
      label: '',
      kind: 'aggregate',
      level: 3,
      asset: null,
      hiddenProviderCount: 12,
    };
    const providers = ['a', 'b', 'c'].map((name) => assetNode(`p-${name}`, name));
    renderPanel(selected, modelAround(selected, [...providers, aggregate]));

    expect(listed('Supported by')).toEqual(['a', 'b', 'c', 'and 12 more']);
  });

  it('leaves the internet node out of what supports the asset', () => {
    const selected = assetNode(SELECTED_ID, 'esx-cluster-02', { exposure: 'internet_facing' });
    renderPanel(selected, modelAround(selected, [internetNode()]));

    expect(screen.queryByText('Supported by')).toBeNull();
  });

  it('closes on the close button', () => {
    const onClose = vi.fn();
    const node = assetNode(SELECTED_ID, 'esx-cluster-02');
    renderPanel(node, modelAround(node), 0, { onClose });

    fireEvent.click(screen.getByLabelText('Close the panel'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('counts the exposed assets on the internet node instead of asset fields', () => {
    const node = internetNode();
    renderPanel(node, modelAround(node), 3);

    expect(screen.getByText('Internet')).toBeTruthy();
    expect(screen.getByText('Not inventoried')).toBeTruthy();
    expect(screen.getByText('Exposed assets')).toBeTruthy();
    expect(screen.getByText('3 assets')).toBeTruthy();
    expect(screen.queryByText('Criticality')).toBeNull();
    expect(screen.queryByText('Open the asset')).toBeNull();
  });
});
