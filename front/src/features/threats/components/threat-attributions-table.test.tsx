/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MouseEventHandler, ReactElement, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useNavigate: () => navigate,
  Link: ({ children, params, onClick }: { children: ReactNode, params: { threatId: string }, onClick?: MouseEventHandler<HTMLAnchorElement> }) => (
    <a href={`/threats/${params.threatId}`} onClick={onClick}>{children}</a>
  ),
}));

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ effectiveTheme: 'dark' }),
}));

interface DrawnNode {
  id: string,
  x?: number,
  y?: number,
  fx?: number,
  fy?: number,
}

const forceGraph = vi.hoisted(() => ({
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
      forceGraph.drawn = graphData;
      for (const node of graphData.nodes) {
        Object.assign(node, { x: node.fx ?? 0, y: node.fy ?? 0 });
      }
      ref(forceGraph.handle);
    }, [ref, graphData]);
    return null;
  };
  return { default: FakeForceGraph };
});

const { localTableStateCollection } = await import('../../../stores');
const { ThreatAttributionsTable } = await import('./threat-attributions-table');
const { MAX_COLUMN_THREATS, foldNodeId } = await import('./threat-attribution-graph-utils');

const STORAGE_KEY = 'threat-overview-attributions';
const CURRENT = { id: 't0', name: 'Fancy Bear', entityType: 'intrusion-set' as const };
const APT28 = { id: 't1', name: 'APT28', entityType: 'intrusion-set' as const };
const PAWN_STORM = { id: 't2', name: 'Pawn Storm', entityType: 'campaign' as const };
const GRU = { id: 't3', name: 'GRU Unit 26165', entityType: 'threat-actor' as const };
const CAMPAIGNS = Array.from({ length: MAX_COLUMN_THREATS + 1 }, (_, index) => ({
  id: `c${index}`,
  name: `Campaign ${index}`,
  entityType: 'campaign' as const,
}));

const clickNode = (id: string): void => {
  const node = forceGraph.drawn.nodes.find((candidate) => candidate.id === id);
  const container = screen.getByRole('list', { name: /^Attributions of / }).nextElementSibling;
  if (node === undefined || container === null) {
    throw new Error(`${id} is not drawn`);
  }
  fireEvent.click(container, { clientX: node.x ?? 0, clientY: node.y ?? 0 });
};

const drawnIds = (): Array<string> => forceGraph.drawn.nodes.map((node) => node.id);

const renderCard = (card: ReactElement): void => {
  render(<I18nProvider i18n={i18n}>{card}</I18nProvider>);
};

const searchFor = (text: string): void => {
  const field = screen.getByRole('searchbox', { name: 'Search for a threat' });
  fireEvent.change(field, { target: { value: text } });
  fireEvent.blur(field);
};

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
  localStorage.clear();
  if (localTableStateCollection.has(STORAGE_KEY)) {
    localTableStateCollection.delete(STORAGE_KEY);
  }
  navigate.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ThreatAttributionsTable', () => {
  it('lists a threat attributed on both sides once per side, with its relation', () => {
    renderCard(<ThreatAttributionsTable threat={CURRENT} attributedTo={[GRU, APT28]} attributedFrom={[APT28, PAWN_STORM]} />);

    const rows = screen.getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rows).toHaveLength(4);
    expect(rows.filter((text) => text?.startsWith('APT28'))).toEqual([
      'APT28Intrusion setAttributed to',
      'APT28Intrusion setAttributed to this threat',
    ]);
  });

  it('narrows the rows with a search', () => {
    renderCard(<ThreatAttributionsTable threat={CURRENT} attributedTo={[GRU]} attributedFrom={[APT28, PAWN_STORM]} />);

    searchFor('pawn');

    expect(screen.getByText('Pawn Storm')).toBeTruthy();
    expect(screen.queryByText('APT28')).toBeNull();
    expect(screen.queryByText('GRU Unit 26165')).toBeNull();
  });

  it('opens the threat of the row clicked', () => {
    renderCard(<ThreatAttributionsTable threat={CURRENT} attributedTo={[GRU]} attributedFrom={[]} />);

    fireEvent.click(screen.getByText('Attributed to'));

    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: 'threat-center/threats/$threatId', params: { threatId: 't3' } }));
  });

  it('says when no threat is attributed either way, with no graph to switch to', () => {
    renderCard(<ThreatAttributionsTable threat={CURRENT} attributedTo={[]} attributedFrom={[]} />);

    expect(screen.getByText('No known threat is attributed to it, nor is it attributed to one.')).toBeTruthy();
    expect(screen.queryByLabelText('Graph view')).toBeNull();
  });

  it('switches the card between the table and the graph', () => {
    renderCard(<ThreatAttributionsTable threat={CURRENT} attributedTo={[GRU]} attributedFrom={[PAWN_STORM]} />);

    fireEvent.click(screen.getByLabelText('Graph view'));

    expect(screen.queryByRole('table')).toBeNull();
    const graph = within(screen.getByRole('list', { name: 'Attributions of Fancy Bear' }));
    expect(graph.getByText('Fancy Bear, Intrusion set, this threat. Attributed to GRU Unit 26165. Attributed to it: Pawn Storm.')).toBeTruthy();
    expect(graph.getByRole('link', { name: 'Pawn Storm, Campaign, attributed to Fancy Bear' }).getAttribute('href')).toBe('/threats/t2');
    expect(graph.getByRole('link', { name: 'GRU Unit 26165, Threat actor, Fancy Bear is attributed to it' })).toBeTruthy();

    fireEvent.click(screen.getByLabelText('List view'));

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Attributions of Fancy Bear' })).toBeNull();
  });

  it('keeps a column unfolded across a switch to the table and back, until the threat changes', () => {
    const hidden = CAMPAIGNS.slice(MAX_COLUMN_THREATS - 1).map((campaign) => campaign.id);
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <ThreatAttributionsTable threat={CURRENT} attributedTo={[GRU]} attributedFrom={CAMPAIGNS} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByLabelText('Graph view'));
    clickNode(foldNodeId('campaign'));
    expect(drawnIds()).toEqual(expect.arrayContaining(hidden));

    fireEvent.click(screen.getByLabelText('List view'));
    fireEvent.click(screen.getByLabelText('Graph view'));

    expect(drawnIds()).toEqual(expect.arrayContaining(hidden));
    expect(drawnIds()).not.toContain(foldNodeId('campaign'));

    rerender(
      <I18nProvider i18n={i18n}>
        <ThreatAttributionsTable threat={APT28} attributedTo={[GRU]} attributedFrom={CAMPAIGNS} />
      </I18nProvider>,
    );

    expect(drawnIds()).toContain(foldNodeId('campaign'));
  });
});
