/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { OPENCTI_DOCUMENTATION_URL } from '../onboarding-utils';
import { OpenctiSourceDrawer } from './opencti-source-drawer';

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
  hasManageSecurity?: boolean,
}

/** Renders the open drawer against canned answers for every query it makes. */
const renderCard = ({ platformConfigured, hasManageSecurity = false }: CardState) => {
  const answers: Record<string, unknown> = {
    'connectors.getConnector': {
      platformConfigured,
      tenantConfigured: false,
      state: platformConfigured ? 'not_configured' : 'unavailable',
      activeRunId: null,
    },
    'opencti.getSettings': null,
    'opencti.listStreams': [],
    'capabilities.hasManageSecurity': hasManageSecurity,
    'serviceAccounts.getServiceAccounts': [{ id: 'sa-1', name: 'OpenCTI import', active: true }],
    'integrations.getConnectorsStatus': { opencti: { platformConfigured } },
  };
  return renderWithTrpc(<OpenctiSourceDrawer tenantId={TENANT_ID} open onClose={() => undefined} />, { answers });
};

describe('OpenctiSourceDrawer', () => {
  describe('when the platform has not enabled the connector', () => {
    it('shows Unavailable with the two variables of this tenant, a copy button and the documentation link', async () => {
      renderCard({ platformConfigured: false, hasManageSecurity: true });

      expect(await screen.findByText("A platform administrator enables OpenCTI for this tenant: set the variables below in the platform's environment, then restart the platform.")).toBeTruthy();
      const variables = document.querySelector('pre')?.textContent ?? '';
      expect(variables.split('\n')).toEqual([
        `CONNECTORS__OPENCTI__${TENANT_ID}__URL=`,
        `CONNECTORS__OPENCTI__${TENANT_ID}__TOKEN=`,
      ]);
      expect(screen.getByRole('heading', { name: 'OpenCTI' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'See the documentation' }).getAttribute('href')).toBe(OPENCTI_DOCUMENTATION_URL);
    });

    it('offers no configuration form, whoever the reader is', async () => {
      renderCard({ platformConfigured: false, hasManageSecurity: true });

      await screen.findByText("A platform administrator enables OpenCTI for this tenant: set the variables below in the platform's environment, then restart the platform.");
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });
  });

  describe('when the connector is enabled and the reader holds MANAGE_SECURITY', () => {
    it('shows the configuration form and the link to Integrations', async () => {
      renderCard({ platformConfigured: true, hasManageSecurity: true });

      expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: /Service account/ })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Follow in Integrations' })).toBeTruthy();
      expect(screen.queryByText('An administrator configures this connector.')).toBeNull();
    });
  });

  describe('when the connector is enabled and the reader lacks MANAGE_SECURITY', () => {
    it('shows that an administrator configures it, with no form', async () => {
      renderCard({ platformConfigured: true, hasManageSecurity: false });

      expect(await screen.findByText('An administrator configures this connector.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
    });
  });
});
