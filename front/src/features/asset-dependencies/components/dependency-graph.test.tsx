/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DependencyGraphPayload } from '../dependency-graph-utils';
import { buildDependencyGraph } from '../dependency-graph-utils';

const graph = vi.hoisted(() => {
  const state = { zoom: 1 };
  const handle = {
    d3Force: () => undefined,
    zoomToFit: () => undefined,
    graph2ScreenCoords: () => ({ x: 0, y: 0 }),
    centerAt: vi.fn(),
    zoom: vi.fn((k?: number) => (k === undefined ? state.zoom : undefined)),
  };
  return { state, handle, databaseAt: { x: 140, y: -35 }, drawn: { nodes: [] as Array<{ id: string, foldedBy?: string, fx?: number, fy?: number }> } };
});

/** Stands in for the simulation: it settles the nodes where the test says, then hands over its handle. */
vi.mock('react-force-graph-2d', async () => {
  const { useEffect } = await import('react');
  interface Props {
    ref: (handle: unknown) => void,
    graphData: { nodes: Array<{ id: string, x?: number, y?: number }> },
  }
  const FakeForceGraph = ({ ref, graphData }: Props): null => {
    useEffect(() => {
      graph.drawn = graphData;
      for (const node of graphData.nodes) {
        Object.assign(node, node.id === 'database' ? graph.databaseAt : { x: 0, y: 0 });
      }
      ref(graph.handle);
    }, [ref, graphData]);
    return null;
  };
  return { default: FakeForceGraph };
});

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ effectiveTheme: 'dark' }),
}));

const { DependencyGraph } = await import('./dependency-graph');

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  // Keeps the framing loop from fitting the view behind the test's back.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom lays nothing out, and the graph mounts only once its container has a size.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 460 });
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  graph.handle.centerAt.mockClear();
  graph.handle.zoom.mockClear();
});

afterEach(() => {
  cleanup();
});

const PAYLOAD: DependencyGraphPayload = {
  assets: [{
    id: 'database',
    name: 'database',
    derivedName: null,
    categoryId: 'host',
    criticality: 'high',
    exposure: 'internal',
    ownerName: null,
    firstSeenAt: null,
    lastSeenAt: null,
    postureScore: null,
    criticalFindingCount: 0,
    highFindingCount: 0,
  }],
  links: [{ id: 'l1', dependentId: 'primary', providerId: 'database', kind: 'depends_on', roles: ['stores'] }],
  truncated: [],
  hiddenAssetCount: 0,
};

const MODEL = buildDependencyGraph([{ id: 'primary', name: 'Customer billing' }], PAYLOAD, {
  unnamedAsset: 'Unnamed',
  internet: 'Internet',
});

const renderGraph = (markedNodeId?: string): void => {
  render(
    <I18nProvider i18n={i18n}>
      <DependencyGraph
        model={MODEL}
        selection={null}
        onSelect={() => {}}
        onExpand={() => {}}
        canExpand={false}
        fitSignal={0}
        isFullScreen={false}
        onToggleFullScreen={() => {}}
        height={460}
        markedNodeId={markedNodeId}
      />
    </I18nProvider>,
  );
};

const graphProps = {
  selection: null,
  onSelect: () => {},
  onExpand: () => {},
  canExpand: true,
  fitSignal: 0,
  isFullScreen: false,
  onToggleFullScreen: () => {},
  height: 460,
};

describe('DependencyGraph', () => {
  it('draws the primary asset one column left of the asset supporting it, leaving each height to the forces', () => {
    renderGraph();

    expect(graph.drawn.nodes.map((node) => [node.id, node.fx, node.fy])).toEqual([
      ['primary', -130, undefined],
      ['database', 130, undefined],
    ]);
  });

  it('redraws an aggregate whose providers fold for another reason, the same assets drawn at the next depth', () => {
    const foldedBy = (fold: 'depth' | 'width') => buildDependencyGraph([{ id: 'primary', name: 'Customer billing' }], {
      ...PAYLOAD,
      truncated: [{ assetId: 'database', hiddenProviderCount: 3, foldedBy: fold }],
      hiddenAssetCount: 3,
    }, { unnamedAsset: 'Unnamed', internet: 'Internet' });
    const { rerender } = render(<I18nProvider i18n={i18n}><DependencyGraph model={foldedBy('depth')} {...graphProps} /></I18nProvider>);

    rerender(<I18nProvider i18n={i18n}><DependencyGraph model={foldedBy('width')} {...graphProps} /></I18nProvider>);

    expect(graph.drawn.nodes.find((node) => node.id === 'aggregate:database')?.foldedBy).toBe('width');
  });

  it('offers to centre on the marked asset', () => {
    renderGraph('database');
    expect(screen.getByRole('button', { name: 'Centre on this asset' })).toBeTruthy();
  });

  it('centres on the marked asset and zooms in to the reading scale from a view further out', () => {
    graph.state.zoom = 0.5;
    renderGraph('database');

    fireEvent.click(screen.getByRole('button', { name: 'Centre on this asset' }));

    expect(graph.handle.centerAt).toHaveBeenCalledWith(graph.databaseAt.x, graph.databaseAt.y, expect.any(Number));
    expect(graph.handle.zoom).toHaveBeenLastCalledWith(1.2, expect.any(Number));
  });

  it('never zooms out when centring from a closer view', () => {
    graph.state.zoom = 3;
    renderGraph('database');

    fireEvent.click(screen.getByRole('button', { name: 'Centre on this asset' }));

    expect(graph.handle.centerAt).toHaveBeenCalledWith(graph.databaseAt.x, graph.databaseAt.y, expect.any(Number));
    expect(graph.handle.zoom).toHaveBeenLastCalledWith(3, expect.any(Number));
  });

  it('offers no centring on a graph that marks no asset', () => {
    renderGraph();
    expect(screen.queryByRole('button', { name: 'Centre on this asset' })).toBeNull();
  });

  it('offers no centring when the marked asset is not drawn', () => {
    renderGraph('elsewhere');
    expect(screen.queryByRole('button', { name: 'Centre on this asset' })).toBeNull();
  });
});
