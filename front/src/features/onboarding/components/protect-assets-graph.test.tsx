/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DependencyGraphModel } from '../../asset-dependencies/dependency-graph-utils';
import { FAILED, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ProtectAssetsGraph } from './protect-assets-graph';

vi.mock('../../asset-dependencies', () => ({
  DependencyGraphDepthSelect: () => null,
  DependencyGraphCard: ({ model }: { model: DependencyGraphModel | null }) => (
    model === null
      ? <div data-testid="graph-loading" />
      : <div data-testid="graph-card">{model.nodes.map((node) => node.id).join(',')}</div>
  ),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const ASSETS = [{ id: 'asset-1', name: 'Ledger' }, { id: 'asset-2', name: 'Customer data' }];

const supportingAsset = (id: string) => ({
  id, name: id, derivedName: null, categoryId: 'host', criticality: 'medium', exposure: 'internal', ownerName: null, firstSeenAt: null, lastSeenAt: null,
  postureScore: null, criticalFindingCount: 0, highFindingCount: 0,
});
const link = (id: string, dependentId: string, providerId: string) => ({ id, dependentId, providerId, kind: 'depends_on', roles: [] });

/** Ledger and Customer data share `shared`; Ledger alone reaches `ledger-only`. */
const GRAPHS: Record<string, unknown> = {
  'asset-1': {
    assets: [supportingAsset('shared'), supportingAsset('ledger-only')],
    links: [link('l1', 'asset-1', 'shared'), link('l2', 'asset-1', 'ledger-only')],
    truncated: [],
    hiddenAssetCount: 0,
  },
  'asset-2': {
    assets: [supportingAsset('shared')],
    links: [link('l3', 'asset-2', 'shared')],
    truncated: [],
    hiddenAssetCount: 0,
  },
};

const primaryAssetIdOf = (input: unknown): string | undefined =>
  typeof input === 'object' && input !== null && 'primaryAssetId' in input && typeof input.primaryAssetId === 'string' ? input.primaryAssetId : undefined;

const renderGraph = (answer: unknown = (input: unknown) => GRAPHS[primaryAssetIdOf(input) ?? ''], assets = ASSETS, onLink = vi.fn()) => ({
  onLink,
  ...renderWithTrpc(<ProtectAssetsGraph assets={assets} onLink={onLink} />, {
    answers: { 'assetDependencies.getPrimaryAssetDependencyGraph': answer },
  }),
});

const drawnNodes = async () => (await screen.findByTestId('graph-card')).textContent?.split(',').sort();

describe('ProtectAssetsGraph', () => {
  it('draws nothing for a scope with no primary asset', () => {
    renderWithTrpc(<ProtectAssetsGraph assets={[]} onLink={vi.fn()} />);

    expect(screen.queryByTestId('graph-card')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Link assets' })).toBeNull();
  });

  it('shows every primary asset on one graph by default, a shared supporting asset once', async () => {
    renderGraph();

    expect(screen.getByRole('button', { name: 'Ledger' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Customer data' }).getAttribute('aria-pressed')).toBe('true');
    expect(await drawnNodes()).toEqual(['asset-1', 'asset-2', 'ledger-only', 'shared']);
  });

  it('reads the graph of every primary asset', async () => {
    const { calls } = renderGraph();

    await vi.waitFor(() => {
      const read = calls.filter((call) => call.path === 'assetDependencies.getPrimaryAssetDependencyGraph').map((call) => primaryAssetIdOf(call.input));
      expect(read.sort()).toEqual(['asset-1', 'asset-2']);
    });
  });

  it('hides a primary asset and the supporting assets only it reaches, and keeps the shared ones', async () => {
    renderGraph();
    await screen.findByTestId('graph-card');

    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));

    expect(screen.getByRole('button', { name: 'Ledger' }).getAttribute('aria-pressed')).toBe('false');
    expect(await drawnNodes()).toEqual(['asset-2', 'shared']);
  });

  it('shows a hidden primary asset again', async () => {
    renderGraph();
    await screen.findByTestId('graph-card');

    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));

    expect(await drawnNodes()).toEqual(['asset-1', 'asset-2', 'ledger-only', 'shared']);
  });

  it('draws a primary asset with no link as a lone node beside the others', async () => {
    renderGraph((input: unknown) => (primaryAssetIdOf(input) === 'asset-1'
      ? GRAPHS['asset-1']
      : { assets: [], links: [], truncated: [], hiddenAssetCount: 0 }));

    expect(await drawnNodes()).toEqual(['asset-1', 'asset-2', 'ledger-only', 'shared']);
  });

  it('links the first primary asset until the reader picks another', async () => {
    const { onLink } = renderGraph();
    await screen.findByTestId('graph-card');

    fireEvent.click(screen.getByRole('button', { name: 'Link assets' }));

    expect(onLink).toHaveBeenCalledWith({ id: 'asset-1', name: 'Ledger' });
    expect(screen.getByRole('combobox', { name: 'Primary asset to link assets to' })).toBeTruthy();
  });

  it('offers no choice of primary asset to link when the scope has one', async () => {
    const { onLink } = renderGraph(undefined, [{ id: 'asset-1', name: 'Ledger' }]);
    await screen.findByTestId('graph-card');

    expect(screen.queryByRole('combobox', { name: 'Primary asset to link assets to' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Link assets' }));

    expect(onLink).toHaveBeenCalledWith({ id: 'asset-1', name: 'Ledger' });
  });

  it('says the graph could not load instead of leaving the card loading', async () => {
    renderGraph(FAILED);

    expect(await screen.findByText('The dependency graph could not be loaded.')).toBeTruthy();
    expect(screen.queryByTestId('graph-card')).toBeNull();
  });
});
