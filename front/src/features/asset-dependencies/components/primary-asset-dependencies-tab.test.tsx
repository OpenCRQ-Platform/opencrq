/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FAILED, NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { PrimaryAssetDependenciesTab } from './primary-asset-dependencies-tab';

vi.mock('../../../hooks', () => ({
  usePersistedView: <T extends string>(_id: string, defaultView: T) => {
    const [view, setView] = useState(defaultView);
    return { view, setView };
  },
}));

vi.mock('./dependency-graph-card', () => ({
  DependencyGraphDepthSelect: () => null,
  DependencyGraphCard: () => <div data-testid="graph-card" />,
}));

vi.mock('./manage-dependencies-drawer', () => ({
  ManagePrimaryAssetDependenciesDrawer: () => null,
}));

vi.mock('./support-to-primary-links-card', () => ({
  SupportToPrimaryLinksCard: () => null,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderWith = (answer: typeof FAILED | typeof NEVER) => {
  renderWithTrpc(<PrimaryAssetDependenciesTab primaryAssetId="00000000-0000-0000-0000-0000000000a1" primaryAssetName="Ledger" />, {
    answers: { 'assetDependencies.getPrimaryAssetDependencyGraph': answer },
  });
};

describe('PrimaryAssetDependenciesTab', () => {
  it('should say the graph failed to load instead of leaving the card loading', async () => {
    renderWith(FAILED);

    expect(await screen.findByText('Failed to load the dependency graph')).toBeTruthy();
    expect(screen.queryByTestId('graph-card')).toBeNull();
  });

  it('should hand a pending graph to the card, which shows it loading', () => {
    renderWith(NEVER);

    expect(screen.getByTestId('graph-card')).toBeTruthy();
    expect(screen.queryByText('Failed to load the dependency graph')).toBeNull();
  });
});
