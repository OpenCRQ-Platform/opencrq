/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { DefaultThreatsTile, OpenctiTile, StixTile } from './threat-source-tiles';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#integrations">{children}</a>,
  useMatches: () => [],
  useParams: () => ({ tenantId: 'tenant-id' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

interface SetState {
  enabled: boolean,
  loadedAt?: string | null,
  state?: string,
  datasetFileUrl?: string | null,
  hasManageSecurity?: boolean,
  groups?: number,
  campaigns?: number,
  otherThreats?: number,
}

interface Counts {
  'default-threats'?: number,
  connector?: number,
  'stix-import'?: number,
}

const connectorCard = (source: string, state: string, enabled = true) => ({
  source,
  state,
  enabled,
  platformConfigured: true,
  tenantConfigured: true,
  activeRun: null,
});

/** Renders a tile against canned answers, and returns the inputs `setEnabled` was called with. */
const renderTile = (tile: ReactElement, answers: Record<string, unknown>) => {
  const setEnabledInputs: Array<unknown> = [];
  renderWithTrpc(tile, {
    answers: {
      'defaultThreats.setEnabled': (input: unknown) => {
        setEnabledInputs.push(input);
        return {};
      },
      ...answers,
    },
  });
  return { setEnabledInputs };
};

const threatsList = (counts: Counts) => (input: { kind?: keyof Counts }) => ({ items: [], total: input.kind === undefined ? 0 : counts[input.kind] ?? 0, page: 1, limit: 1, pending: 0 });

const renderSet = ({
  enabled,
  loadedAt = null,
  state = 'healthy',
  datasetFileUrl = 'https://example.test/set.json',
  hasManageSecurity = false,
  groups = 0,
  campaigns = 0,
  otherThreats = 0,
}: SetState, counts: Counts = {}) => renderTile(<DefaultThreatsTile />, {
  'defaultThreats.getOverview': { datasetFileUrl, enabled, loadedAt, groups, campaigns, otherThreats },
  'connectors.listConnectors': [connectorCard('default_threats', state, enabled)],
  'threats.list': threatsList(counts),
  'capabilities.hasManageSecurity': hasManageSecurity,
});

describe('DefaultThreatsTile', () => {
  it('counts the threats of its own kind, whatever the other sources hold', async () => {
    renderSet({ enabled: true, loadedAt: '2026-11-10T08:00:00.000Z' }, { 'default-threats': 167, connector: 300, 'stix-import': 9 });

    expect(await screen.findByText('167 threats')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
  });

  it('counts a single threat in the singular', async () => {
    renderSet({ enabled: true, loadedAt: '2026-11-10T08:00:00.000Z' }, { 'default-threats': 1 });

    expect(await screen.findByText('1 threat')).toBeTruthy();
  });

  describe('when the set is switched off', () => {
    it('offers Enable to a MANAGE_SECURITY holder, which enables the set', async () => {
      const { setEnabledInputs } = renderSet({ enabled: false, state: 'never_synced', hasManageSecurity: true });

      fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));

      await vi.waitFor(() => {
        expect(setEnabledInputs).toEqual([{ enabled: true }]);
      });
      expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    });

    it('tells any other reader that an administrator enables it, with no button', async () => {
      renderSet({ enabled: false, state: 'never_synced', hasManageSecurity: false });

      expect(await screen.findByText('An administrator enables it.')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('when the set is enabled', () => {
    it('offers Disable to a MANAGE_SECURITY holder, which asks first and then disables the set', async () => {
      const { setEnabledInputs } = renderSet(
        { enabled: true, loadedAt: '2026-11-10T08:00:00.000Z', hasManageSecurity: true, groups: 160, campaigns: 7, otherThreats: 3 },
        { 'default-threats': 167 },
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Its 167 threats are removed from this tenant/)).toBeTruthy();
      expect(setEnabledInputs).toEqual([]);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));

      await vi.waitFor(() => {
        expect(setEnabledInputs).toEqual([{ enabled: false }]);
      });
    });

    it('keeps the set when the dialog is cancelled', async () => {
      const { setEnabledInputs } = renderSet({ enabled: true, loadedAt: '2026-11-10T08:00:00.000Z', hasManageSecurity: true });

      fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));

      await vi.waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(setEnabledInputs).toEqual([]);
    });

    it('offers no button to another reader', async () => {
      renderSet({ enabled: true, loadedAt: '2026-11-10T08:00:00.000Z', hasManageSecurity: false }, { 'default-threats': 5 });

      await screen.findByText('5 threats');
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText('An administrator enables it.')).toBeNull();
    });
  });

  it('links to Integrations when the first load failed', async () => {
    renderSet({ enabled: true, state: 'failing', hasManageSecurity: true });

    expect(await screen.findByRole('link', { name: 'Follow in Integrations' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
  });

  it('offers nothing when the platform turned the dataset off', async () => {
    renderSet({ enabled: true, state: 'healthy', datasetFileUrl: null, hasManageSecurity: true });

    await screen.findByText('Healthy');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('OpenctiTile', () => {
  const renderOpencti = (backfill: { isCatchingUp: boolean, progressPercent: number | null }, counts: Counts = {}) => renderTile(<OpenctiTile tenantId="tenant-id" />, {
    'connectors.listConnectors': [connectorCard('opencti', backfill.isCatchingUp ? 'syncing' : 'healthy')],
    'threats.list': threatsList(counts),
    'opencti.getBackfillProgress': { mirroredObjectCount: 312, ...backfill },
    'capabilities.hasManageSecurity': true,
  });

  it('counts the threats it brought in, not the objects it mirrors', async () => {
    renderOpencti({ isCatchingUp: false, progressPercent: 100 }, { connector: 48 });

    expect(await screen.findByText('48 threats')).toBeTruthy();
    expect(screen.queryByText(/312/)).toBeNull();
  });

  it('draws the progress while the stream catches up', async () => {
    renderOpencti({ isCatchingUp: true, progressPercent: 40 });

    const bar = await screen.findByRole('progressbar', { name: 'OpenCTI import progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('Syncing')).toBeTruthy();
  });

  it('draws no bar once the stream reached its live tail', async () => {
    renderOpencti({ isCatchingUp: false, progressPercent: 100 });

    await screen.findByText('Healthy');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('draws no bar when the percentage is unknown', async () => {
    renderOpencti({ isCatchingUp: true, progressPercent: null });

    await screen.findByText('Syncing');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('opens a drawer titled with the source on Configure', async () => {
    renderOpencti({ isCatchingUp: false, progressPercent: null });

    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));

    expect(await screen.findByRole('heading', { name: 'OpenCTI' })).toBeTruthy();
  });
});

describe('StixTile', () => {
  const renderStix = (count: number, fileStorageEnabled = true) => renderTile(<StixTile />, {
    'threats.list': threatsList({ 'stix-import': count }),
    'fileStorage.getSettings': { enabled: fileStorageEnabled },
  });

  it('shows Active and its threats once a bundle brought some in', async () => {
    renderStix(17);

    expect(await screen.findByText('17 threats')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows no state while it holds nothing', async () => {
    renderStix(0);

    expect(await screen.findByText('0 threats')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('says why the upload is out of reach when file storage is not configured', async () => {
    renderStix(0, false);

    expect(await screen.findByText('File storage must be configured on the platform to import a bundle.')).toBeTruthy();
  });
});
