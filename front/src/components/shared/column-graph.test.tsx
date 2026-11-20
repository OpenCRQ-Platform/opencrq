/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

const { ColumnGraph } = await import('./column-graph');

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

afterEach(() => {
  cleanup();
});

const NODES = [
  { id: 'left', level: 0 },
  { id: 'middle', level: 1, pinnedY: 0 },
  { id: 'right', level: 2, pinnedY: 120 },
];
const LINKS = [{ id: 'l1', source: 'left', target: 'middle' }];

interface RenderProps {
  onNodeClick?: (node: { id: string } | undefined) => void,
  tooltip?: boolean,
  isInteractiveNode?: (node: { id: string }) => boolean,
}

const renderGraph = (props: RenderProps = {}): void => {
  render(
    <ColumnGraph
      nodes={NODES}
      links={LINKS}
      signature="s"
      columnGap={120}
      nodeReach={() => 22}
      paintNode={() => undefined}
      paintLink={() => undefined}
      isInteractiveNode={props.isInteractiveNode}
      onNodeClick={props.onNodeClick ?? (() => undefined)}
      nodeTooltip={props.tooltip === true ? (node) => `Open ${node.id}` : undefined}
      fitSignal={0}
      isFullScreen={false}
      onToggleFullScreen={() => undefined}
      height={460}
      accessibleLabel="Graph"
      accessibleItems={<li>Said in words</li>}
    />,
  );
};

const pointAt = (node: DrawnNode): { clientX: number, clientY: number } => ({ clientX: node.x ?? 0, clientY: node.y ?? 0 });

describe('ColumnGraph', () => {
  it('pins each node to its column, centred on the middle one, and to its row when it states one', () => {
    renderGraph();

    expect(graph.drawn.nodes.map((node) => [node.id, node.fx, node.fy])).toEqual([
      ['left', -260, undefined],
      ['middle', 0, 0],
      ['right', 260, 120],
    ]);
  });

  it('hands a click on a node to the caller, and a click on the background as nothing', () => {
    const onNodeClick = vi.fn<(node: { id: string } | undefined) => void>();
    renderGraph({ onNodeClick });
    const container = screen.getByRole('list', { name: 'Graph' }).nextElementSibling;
    if (container === null) {
      throw new Error('the canvas container is missing');
    }
    const right = graph.drawn.nodes.find((node) => node.id === 'right') ?? { id: 'missing' };

    fireEvent.click(container, pointAt(right));
    fireEvent.click(container, { clientX: 500, clientY: -400 });

    expect(onNodeClick.mock.calls.map(([node]) => node?.id)).toEqual(['right', undefined]);
  });

  it('shows the tooltip of the node under the pointer, and hides it when the pointer leaves', () => {
    renderGraph({ tooltip: true });
    const container = screen.getByRole('list', { name: 'Graph' }).nextElementSibling;
    if (container === null) {
      throw new Error('the canvas container is missing');
    }
    container.appendChild(document.createElement('canvas'));
    const middle = graph.drawn.nodes.find((node) => node.id === 'middle') ?? { id: 'missing' };

    fireEvent.pointerMove(container, pointAt(middle));
    expect(screen.getByRole('tooltip').textContent).toBe('Open middle');

    fireEvent.pointerLeave(container);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides the tooltip when the pointer goes from a node straight onto the controls', () => {
    renderGraph({ tooltip: true });
    const container = screen.getByRole('list', { name: 'Graph' }).nextElementSibling;
    if (container === null) {
      throw new Error('the canvas container is missing');
    }
    container.appendChild(document.createElement('canvas'));
    const middle = graph.drawn.nodes.find((node) => node.id === 'middle') ?? { id: 'missing' };

    fireEvent.pointerMove(container, pointAt(middle));
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Zoom in' }));

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('offers neither the pointer cursor nor the tooltip on a node the caller marks inert', () => {
    renderGraph({ tooltip: true, isInteractiveNode: (node) => node.id !== 'middle' });
    const container = screen.getByRole('list', { name: 'Graph' }).nextElementSibling;
    if (container === null) {
      throw new Error('the canvas container is missing');
    }
    const canvas = container.appendChild(document.createElement('canvas'));
    const middle = graph.drawn.nodes.find((node) => node.id === 'middle') ?? { id: 'missing' };
    const right = graph.drawn.nodes.find((node) => node.id === 'right') ?? { id: 'missing' };

    fireEvent.pointerMove(container, pointAt(middle));
    expect(canvas.style.cursor).toBe('');
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.pointerMove(container, pointAt(right));
    expect(canvas.style.cursor).toBe('pointer');
    expect(screen.getByRole('tooltip').textContent).toBe('Open right');
  });

  it('carries the text equivalent the caller gives', () => {
    renderGraph();

    expect(screen.getByRole('list', { name: 'Graph' }).textContent).toBe('Said in words');
  });
});
