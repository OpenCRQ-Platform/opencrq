/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { DECLARED_ESTATE_KIND_VALUES } from '@app/module/client';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { declaredEstateKindLabel } from '../../declared-estate/declared-estate-labels';
import { AssetSourceTiles, DeclaredEstateTile, DefenderTile, ManualAssetsTile } from './asset-source-tiles';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#integrations">{children}</a>,
  useMatches: () => [],
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const assetsList = (counts: { microsoft_graph?: number, user?: number }) => (input: { source?: 'microsoft_graph' | 'user' | null }) => ({
  items: [],
  total: input.source === undefined || input.source === null ? 0 : counts[input.source] ?? 0,
  page: 1,
  limit: 1,
});

describe('DefenderTile', () => {
  const renderDefender = (activeRun: { processedTotal: number, expectedTotal: number | null } | null, imported = 184) => renderWithTrpc(<DefenderTile tenantId="tenant-id" />, {
    answers: {
      'connectors.listConnectors': [{ source: 'microsoft_graph', state: activeRun === null ? 'healthy' : 'syncing', enabled: true, activeRun }],
      'supportingAssets.listSupportingAssets': assetsList({ microsoft_graph: imported, user: 3 }),
      'capabilities.hasManageSecurity': true,
    },
  });

  it('counts the assets Defender brought in, not the manual ones', async () => {
    renderDefender(null);

    expect(await screen.findByText('184 assets')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('draws the run progress when the run knows its expected total', async () => {
    renderDefender({ processedTotal: 62, expectedTotal: 100 });

    const bar = await screen.findByRole('progressbar', { name: 'Microsoft Defender import progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
    expect(screen.getByText('62%')).toBeTruthy();
  });

  it('shows the Syncing chip alone when the run cannot tell its progress', async () => {
    renderDefender({ processedTotal: 62, expectedTotal: null });

    expect(await screen.findByText('Syncing')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('opens a drawer titled with the source on Configure', async () => {
    renderDefender(null);

    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));

    expect(await screen.findByRole('heading', { name: 'Microsoft Defender' })).toBeTruthy();
  });
});

describe('ManualAssetsTile', () => {
  const renderManual = (created: number) => renderWithTrpc(<ManualAssetsTile organizationId="scope-id" />, {
    answers: { 'supportingAssets.listSupportingAssets': assetsList({ microsoft_graph: 184, user: created }) },
  });

  it('counts the assets created by hand and shows Active', async () => {
    renderManual(3);

    expect(await screen.findByText('3 assets')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows no state while nothing was created', async () => {
    renderManual(0);

    expect(await screen.findByText('0 assets')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
  });
});

describe('DeclaredEstateTile', () => {
  const estateRow = (kind: string, bounds: { low: number, high: number } | null) => ({ kind, bounds, internetFacing: null, setAt: null, setByName: null });

  const renderEstate = (rows: Array<ReturnType<typeof estateRow>>) => renderWithTrpc(<DeclaredEstateTile organizationId="scope-id" />, {
    answers: {
      'declaredEstate.get': rows,
      'declaredEstate.comparison': { kinds: [] },
    },
  });

  it('shows no state and offers Declare while nothing is declared', async () => {
    renderEstate([estateRow('workstations', null)]);

    expect(await screen.findByText('0 of 12 kinds declared')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.getByRole('button', { name: 'Declare' })).toBeTruthy();
  });

  it('counts the kinds with an answer, shows Active and offers Edit', async () => {
    renderEstate([estateRow('workstations', { low: 51, high: 250 }), estateRow('servers', { low: 4, high: 4 }), estateRow('people', null)]);

    expect(await screen.findByText('2 of 12 kinds declared')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('states how many of the kinds there are, never a hard-coded total', async () => {
    renderEstate([estateRow('servers', { low: 4, high: 4 })]);

    expect(await screen.findByText(`1 of ${DECLARED_ESTATE_KIND_VALUES.length} kinds declared`)).toBeTruthy();
  });

  it('says why to fill it in', async () => {
    renderEstate([estateRow('servers', null)]);

    expect(await screen.findByText('Gives every scenario the size of your estate, even before your assets are imported.')).toBeTruthy();
  });

  it('opens a drawer holding the questionnaire, with Save disabled until an answer changes', async () => {
    renderEstate([estateRow('workstations', null)]);

    fireEvent.click(await screen.findByRole('button', { name: 'Declare' }));

    expect(await screen.findByRole('heading', { name: 'Declared estate' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: declaredEstateKindLabel('workstations') })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);
  });
});

describe('AssetSourceTiles', () => {
  it('lists the Declared estate first, then Microsoft Defender and Manual creation', async () => {
    renderWithTrpc(<AssetSourceTiles tenantId="tenant-id" organizationId="scope-id" />, {
      answers: {
        'declaredEstate.get': [],
        'connectors.listConnectors': [{ source: 'microsoft_graph', state: 'healthy', enabled: true, activeRun: null }],
        'supportingAssets.listSupportingAssets': assetsList({}),
      },
    });

    await screen.findByText('0 of 12 kinds declared');
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Declared estate', 'Microsoft Defender', 'Manual creation']);
  });
});
