/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { DRATA_DOCUMENTATION_URL } from '../onboarding-utils';
import { DrataSourceDrawer } from './drata-source-drawer';

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

const renderCard = (platformConfigured: boolean, hasManageSecurity: boolean) => renderWithTrpc(
  <DrataSourceDrawer tenantId={TENANT_ID} open onClose={() => undefined} />,
  {
    answers: {
      'connectors.getConnector': { platformConfigured, tenantConfigured: false, state: platformConfigured ? 'not_configured' : 'unavailable', activeRunId: null },
      'connectors.getSchedule': { cadence: 'daily', atMinute: 0, weekday: null, timeZone: 'UTC', nextRunAt: null, offeredCadences: ['manual', 'daily'] },
      'capabilities.hasManageSecurity': hasManageSecurity,
      'serviceAccounts.getServiceAccounts': [{ id: 'sa-1', name: 'Drata import', active: true }],
      'integrations.getSettings': null,
    },
  },
);

describe('DrataSourceDrawer', () => {
  it('shows Unavailable with the API key variable of this tenant and the documentation link when the platform has not enabled Drata', async () => {
    renderCard(false, true);

    expect(await screen.findByText("A platform administrator enables Drata for this tenant: set the variables below in the platform's environment, then restart the platform.")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Drata' })).toBeTruthy();
    expect(document.querySelector('pre')?.textContent).toBe(`CONNECTORS__DRATA__${TENANT_ID}__API_KEY=`);
    expect(screen.getByRole('link', { name: 'See the documentation' }).getAttribute('href')).toBe(DRATA_DOCUMENTATION_URL);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the Integrations configuration form to a MANAGE_SECURITY holder once Drata is enabled', async () => {
    renderCard(true, true);

    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Service account/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
  });

  it('tells any other reader that an administrator configures it', async () => {
    renderCard(true, false);

    expect(await screen.findByText('An administrator configures this connector.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
