/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface DrawnNode {
  id: string,
  x?: number,
  y?: number,
  fx?: number,
  fy?: number,
}

const graph = vi.hoisted(() => ({
  drawn: { nodes: [] as Array<DrawnNode> },
  handle: {
    d3Force: () => undefined,
    zoomToFit: () => undefined,
    zoom: () => 1,
    graph2ScreenCoords: (x: number, y: number) => ({ x, y }),
    screen2GraphCoords: (x: number, y: number) => ({ x, y }),
    centerAt: () => undefined,
  },
}));

/** Stands in for the simulation: every node settles where its pins put it, at a zoom of one with the origin at the canvas corner. */
vi.mock('react-force-graph-2d', async () => {
  const { useEffect } = await import('react');
  interface Props {
    ref: (handle: unknown) => void,
    graphData: { nodes: Array<DrawnNode> },
  }
  const FakeForceGraph = ({ ref, graphData }: Props): null => {
    useEffect(() => {
      graph.drawn = graphData;
      for (const node of graphData.nodes) {
        Object.assign(node, { x: node.fx ?? 0, y: node.fy ?? 0 });
      }
      ref(graph.handle);
    }, [ref, graphData]);
    return null;
  };
  return { default: FakeForceGraph };
});

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useNavigate: () => navigate,
  Link: ({ children, params }: { children: ReactNode, params: { threatId: string } }) => (
    <a href={`/threats/${params.threatId}`}>{children}</a>
  ),
}));

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ effectiveTheme: 'light' }),
}));

const { ThreatAttributionGraph } = await import('./threat-attribution-graph');
const { MAX_COLUMN_THREATS, foldNodeId } = await import('./threat-attribution-graph-utils');

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 460 });
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  navigate.mockClear();
  onExpand.mockClear();
});

afterEach(() => {
  cleanup();
});

const CURRENT = { id: 't0', name: 'Fancy Bear', entityType: 'intrusion-set' as const };
const GRU = { id: 't-gru', name: 'GRU Unit 26165', entityType: 'threat-actor' as const };
const CAMPAIGNS = Array.from({ length: MAX_COLUMN_THREATS + 1 }, (_, index) => ({
  id: `c${index}`,
  name: `Campaign ${index}`,
  entityType: 'campaign' as const,
}));

const onExpand = vi.fn();

const renderGraph = (expanded: ReadonlySet<'campaign'> = new Set()): Element => {
  render(
    <I18nProvider i18n={i18n}>
      <ThreatAttributionGraph threat={CURRENT} attributedTo={[GRU]} attributedFrom={CAMPAIGNS} expanded={expanded} onExpand={onExpand} />
    </I18nProvider>,
  );
  const container = screen.getByRole('list', { name: 'Attributions of Fancy Bear' }).nextElementSibling;
  if (container === null) {
    throw new Error('the canvas container is missing');
  }
  return container;
};

const drawnIds = (): Array<string> => graph.drawn.nodes.map((node) => node.id);

const at = (id: string): { clientX: number, clientY: number } => {
  const node = graph.drawn.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    throw new Error(`${id} is not drawn`);
  }
  return { clientX: node.x ?? 0, clientY: node.y ?? 0 };
};

describe('ThreatAttributionGraph', () => {
  it('opens the page of the threat clicked', () => {
    const container = renderGraph();

    fireEvent.click(container, at(GRU.id));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: 'threat-center/threats/$threatId', params: { threatId: GRU.id } }));
  });

  it('asks to unfold the column of the fold clicked', () => {
    const container = renderGraph();

    fireEvent.click(container, at(foldNodeId('campaign')));

    expect(onExpand).toHaveBeenCalledWith('campaign');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('draws every threat of an expanded column, with no fold', () => {
    renderGraph(new Set(['campaign']));

    expect(drawnIds()).toEqual(expect.arrayContaining(CAMPAIGNS.map((campaign) => campaign.id)));
    expect(drawnIds()).not.toContain(foldNodeId('campaign'));
  });

  it('does nothing on the current threat, which the pointer does not offer to click', () => {
    const container = renderGraph();
    const canvas = container.appendChild(document.createElement('canvas'));
    const before = drawnIds();

    fireEvent.pointerMove(container, at(CURRENT.id));
    fireEvent.click(container, at(CURRENT.id));

    expect(canvas.style.cursor).toBe('');
    expect(navigate).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    expect(drawnIds()).toEqual(before);
  });
});
