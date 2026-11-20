/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProtectTemplateKey } from '../protect-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ProtectStep } from './protect-step';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#step">{children}</a>,
  useMatches: () => [],
}));

vi.mock('./protect-assets-graph', () => ({
  ProtectAssetsGraph: ({ assets }: { assets: Array<{ name: string }> }) => <div data-testid="graph">{assets.map((asset) => asset.name).join(',')}</div>,
}));

vi.mock('../../asset-dependencies/components/manage-dependencies-drawer', () => ({
  ManagePrimaryAssetDependenciesDrawer: ({ open, primaryAssetName }: { open: boolean, primaryAssetName: string }) => (open ? <div role="dialog">{`Manage ${primaryAssetName}`}</div> : null),
}));

vi.mock('../../primary-assets', () => ({
  PrimaryAssetCreateSheet: () => null,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderStep = (assets: Array<{ id: string, name: string, onboardingTemplate: ProtectTemplateKey | null }>) => renderWithTrpc(<ProtectStep />, {
  answers: {
    'onboardingWizard.getOnboardingWizard': {
      id: 'wizard-id',
      organizationId: 'scope-id',
      steps: {
        company: 'done', assets: 'done', threats: 'done', defenses: 'done', finances: 'done', tolerance: 'done', protect: 'todo', scenarios: 'todo',
      },
      finished: false,
    },
    'primaryAssets.getPrimaryAssets': assets,
    'businessValueCategories.getBusinessValueCategories': [],
  },
});

describe('ProtectStep', () => {
  it('opens on the templates for a scope with no primary asset', async () => {
    renderStep([]);

    expect(await screen.findByRole('heading', { name: 'What you protect' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Customer data' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'A value right away' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose what I protect' })).toBeNull();
    expect(screen.getByRole('heading', { name: '1. Choose what you protect' })).toBeTruthy();
    expect(screen.queryByTestId('graph')).toBeNull();
    expect(screen.queryByRole('heading', { name: '2. Link the assets that support it' })).toBeNull();
  });

  it('shows the primary assets graph and their count for a scope that has primary assets', async () => {
    renderStep([{ id: 'asset-1', name: 'Ledger', onboardingTemplate: null }]);

    expect(await screen.findByText('1 primary asset in this scope')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Customer data' })).toBeTruthy();
    expect(screen.getByTestId('graph').textContent).toBe('Ledger');
    expect(screen.getByRole('heading', { name: '1. Choose what you protect' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2. Link the assets that support it' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See all primary assets' })).toBeTruthy();
  });

  it('opens the dependencies drawer of the added template on Link assets', async () => {
    renderStep([{ id: 'asset-1', name: 'Customer data', onboardingTemplate: 'customer-data' }]);

    fireEvent.click(await screen.findByRole('button', { name: 'Link assets' }));

    expect((await screen.findByRole('dialog')).textContent).toBe('Manage Customer data');
  });
});
