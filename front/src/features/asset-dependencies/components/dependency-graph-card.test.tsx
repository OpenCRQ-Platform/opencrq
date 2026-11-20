/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DependencyGraphPayload } from '../dependency-graph-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { buildDependencyGraph } from '../dependency-graph-utils';
import { DependencyGraphCard } from './dependency-graph-card';

vi.mock('./dependency-graph', () => ({
  DependencyGraph: ({ isFullScreen, onToggleFullScreen }: { isFullScreen: boolean, onToggleFullScreen: () => void }) => (
    <button type="button" onClick={onToggleFullScreen}>{isFullScreen ? 'Exit full screen' : 'Full screen'}</button>
  ),
}));

vi.mock('./support-to-primary-link-edit-sheet', () => ({
  SupportToPrimaryLinkEditSheet: () => null,
}));

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ effectiveTheme: 'dark' }),
}));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const PAYLOAD: DependencyGraphPayload = {
  assets: [{
    id: 'app',
    name: 'app',
    derivedName: null,
    categoryId: 'host',
    criticality: 'unknown',
    exposure: 'internal',
    ownerName: null,
    firstSeenAt: null,
    lastSeenAt: null,
    postureScore: null,
    criticalFindingCount: 0,
    highFindingCount: 0,
  }],
  links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on', roles: ['stores'] }],
  truncated: [],
  hiddenAssetCount: 0,
};

const MODEL = buildDependencyGraph([{ id: 'primary', name: 'Customer billing' }], PAYLOAD, {
  unnamedAsset: 'Unnamed',
  internet: 'Internet',
});

const pressEscape = (handledByADialog: boolean): void => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  if (handledByADialog) {
    event.preventDefault();
  }
  act(() => {
    window.dispatchEvent(event);
  });
};

const renderCard = (props: { hidesCounters?: boolean } = {}) => renderWithTrpc(
  <DependencyGraphCard model={MODEL} depth={3} onDepthChange={() => {}} emptyState={null} {...props} />,
);

describe('DependencyGraphCard', () => {
  it('reads the domains present, the posture bands, internet exposure and the findings in its legend, and no criticality', () => {
    renderCard();

    for (const label of ['Domains', 'Endpoint', 'OpenCRQ Posture', 'Strong', 'Moderate', 'Weak', 'Internet-facing', 'Findings', 'High']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText('Cloud')).toBeNull();
    expect(screen.queryByText('Criticality')).toBeNull();
  });

  it('keeps the counter row above the graph unless asked to hide it', () => {
    renderCard();
    expect(screen.getByText('1 supporting asset')).toBeTruthy();

    cleanup();
    renderCard({ hidesCounters: true });
    expect(screen.queryByText('1 supporting asset')).toBeNull();
  });

  it('offers the whole chain when the depth cut assets, and only says so when there were too many to draw', () => {
    const folded = (foldedBy: 'depth' | 'width') => buildDependencyGraph([{ id: 'primary', name: 'Customer billing' }], {
      ...PAYLOAD,
      truncated: [{ assetId: foldedBy === 'depth' ? 'app' : 'primary', hiddenProviderCount: 3, foldedBy }],
      hiddenAssetCount: 3,
    }, { unnamedAsset: 'Unnamed', internet: 'Internet' });
    const renderFolded = (foldedBy: 'depth' | 'width') => renderWithTrpc(
      <DependencyGraphCard model={folded(foldedBy)} depth={3} onDepthChange={() => {}} emptyState={null} />,
    );

    renderFolded('depth');
    expect(screen.getByText('1 of 4 assets shown, the depth cuts the rest.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'See the whole chain' })).toBeTruthy();

    cleanup();
    renderFolded('width');
    expect(screen.getByText('1 of 4 assets shown, too many to draw them all.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'See the whole chain' })).toBeNull();
  });

  it('shows its empty state for a model with no link, unless asked to draw unlinked nodes', () => {
    const unlinked = buildDependencyGraph([{ id: 'primary', name: 'Customer billing' }], { ...PAYLOAD, assets: [], links: [] }, {
      unnamedAsset: 'Unnamed',
      internet: 'Internet',
    });
    const renderUnlinked = (drawsUnlinkedNodes?: boolean) => renderWithTrpc(
      <DependencyGraphCard model={unlinked} depth={3} onDepthChange={() => {}} emptyState="Nothing linked" drawsUnlinkedNodes={drawsUnlinkedNodes} />,
    );

    renderUnlinked();
    expect(screen.getByText('Nothing linked')).toBeTruthy();

    cleanup();
    renderUnlinked(true);
    expect(screen.queryByText('Nothing linked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeTruthy();
  });

  it('leaves full screen on Escape, unless a dialog above it took the key', () => {
    renderWithTrpc(<DependencyGraphCard model={MODEL} depth={3} onDepthChange={() => {}} emptyState={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));

    pressEscape(true);
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy();

    pressEscape(false);
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeTruthy();
  });
});
