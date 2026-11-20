/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { MICROSOFT_DEFENDER_DOCUMENTATION_URL } from '../onboarding-utils';
import { DefenderSourceDrawer } from './defender-source-drawer';

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

const TENANT_ID = '89c70e9a-8317-4da7-8765-1b9ba004c32c';

interface CardState {
  platformConfigured: boolean,
  tenantConfigured?: boolean,
  state?: string,
  activeRunId?: string | null,
  hasManageSecurity?: boolean,
}

/** Renders the open drawer against canned answers for every query it makes. */
const renderCard = ({
  platformConfigured,
  tenantConfigured = false,
  state = platformConfigured ? 'not_configured' : 'unavailable',
  activeRunId = null,
  hasManageSecurity = false,
}: CardState) => {
  const answers: Record<string, unknown> = {
    'connectors.getConnector': { platformConfigured, tenantConfigured, state, activeRunId },
    'connectors.getSchedule': { cadence: 'daily', atMinute: 0, weekday: null, timeZone: 'UTC', nextRunAt: null, offeredCadences: ['manual', 'daily'] },
    'capabilities.hasManageSecurity': hasManageSecurity,
    'serviceAccounts.getServiceAccounts': [{ id: 'sa-1', name: 'Defender import', active: true }],
    'integrations.getSettings': tenantConfigured ? { serviceAccountId: 'sa-1' } : null,
  };
  return renderWithTrpc(<DefenderSourceDrawer tenantId={TENANT_ID} open onClose={() => undefined} />, { answers });
};

describe('DefenderSourceDrawer', () => {
  describe('when the platform has not enabled the connector', () => {
    it('shows Unavailable with the three variables of this tenant, a copy button and the documentation link', async () => {
      renderCard({ platformConfigured: false, hasManageSecurity: true });

      expect(await screen.findByText("A platform administrator enables Microsoft Defender for this tenant: set the variables below in the platform's environment, then restart the platform.")).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Microsoft Defender' })).toBeTruthy();
      const variables = document.querySelector('pre')?.textContent ?? '';
      expect(variables.split('\n')).toEqual([
        `CONNECTORS__MICROSOFT_GRAPH__${TENANT_ID}__AZURE_TENANT_ID=`,
        `CONNECTORS__MICROSOFT_GRAPH__${TENANT_ID}__CLIENT_ID=`,
        `CONNECTORS__MICROSOFT_GRAPH__${TENANT_ID}__CLIENT_SECRET=`,
      ]);
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'See the documentation' }).getAttribute('href')).toBe(MICROSOFT_DEFENDER_DOCUMENTATION_URL);
    });

    it('offers neither the configuration nor the sync, whoever the reader is', async () => {
      renderCard({ platformConfigured: false, hasManageSecurity: true });

      await screen.findByText("A platform administrator enables Microsoft Defender for this tenant: set the variables below in the platform's environment, then restart the platform.");
      expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });
  });

  describe('when the connector is enabled and the reader holds MANAGE_SECURITY', () => {
    it('shows the configuration form, the sync button and the link to Integrations', async () => {
      renderCard({ platformConfigured: true, hasManageSecurity: true });

      expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: /Service account/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Follow in Integrations' })).toBeTruthy();
      expect(screen.queryByText('An administrator configures this connector.')).toBeNull();
    });

    it('withholds Sync now until a service account is bound', async () => {
      renderCard({ platformConfigured: true, tenantConfigured: false, hasManageSecurity: true });

      const sync = await screen.findByRole('button', { name: 'Sync now' });
      expect(sync.hasAttribute('disabled')).toBe(true);
    });

    it('enables Sync now once a service account is bound', async () => {
      renderCard({ platformConfigured: true, tenantConfigured: true, state: 'never_synced', hasManageSecurity: true });

      const sync = await screen.findByRole('button', { name: 'Sync now' });
      expect(sync.hasAttribute('disabled')).toBe(false);
    });

    it('withholds Sync now while a run is in flight', async () => {
      renderCard({ platformConfigured: true, tenantConfigured: true, state: 'syncing', activeRunId: 'run-1', hasManageSecurity: true });

      const sync = await screen.findByRole('button', { name: 'Sync now' });
      expect(sync.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('when the connector is enabled and the reader lacks MANAGE_SECURITY', () => {
    it('shows that an administrator configures it, with no form and no sync', async () => {
      renderCard({ platformConfigured: true, tenantConfigured: true, state: 'healthy', hasManageSecurity: false });

      expect(await screen.findByText('An administrator configures this connector.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
    });
  });
});
