import { describe, expect, it } from 'vitest';
import { pinUnlinkedBelow, spreadPeersOnce } from './column-graph-utils';

describe('spreadPeersOnce', () => {
  it('pushes two nodes of one row apart, symmetrically', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 20, y: 0 }];

    spreadPeersOnce(nodes, 'x', 100, 5, 1);

    expect(nodes[0].x).toBe(-40);
    expect(nodes[1].x).toBe(60);
  });

  it('separates two nodes the layout left on the very same spot', () => {
    const nodes = [{ x: 7, y: 3 }, { x: 7, y: 3 }];

    spreadPeersOnce(nodes, 'x', 100, 5, 1);

    expect(Math.abs((nodes[1].x ?? 0) - (nodes[0].x ?? 0))).toBe(100);
  });

  it('leaves alone nodes far enough apart, and nodes of different rows', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 5, y: 80 }];

    spreadPeersOnce(nodes, 'x', 100, 5, 1);

    expect(nodes.map((node) => node.x)).toEqual([0, 200, 5]);
  });

  it('pushes two nodes of one column apart when the free axis is the vertical one', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 0, y: 20 }];

    spreadPeersOnce(nodes, 'y', 100, 5, 1);

    expect(nodes[0].y).toBe(-40);
    expect(nodes[1].y).toBe(60);
    expect(nodes.map((node) => node.x)).toEqual([0, 0]);
  });

  it('converges on a row the pass cannot settle in one go', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    for (let pass = 0; pass < 12; pass += 1) {
      spreadPeersOnce(nodes, 'x', 100, 5, 0.5);
    }

    const sorted = nodes.map((node) => node.x ?? 0).sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeGreaterThan(90);
    expect(sorted[2] - sorted[1]).toBeGreaterThan(90);
  });
});

describe('pinUnlinkedBelow', () => {
  it('pins a node no link holds under the lowest linked node, one row per such node of a column', () => {
    const nodes = [
      { id: 'a', x: 0, y: 10 },
      { id: 'b', x: 100, y: 50 },
      { id: 'lone-far', x: 0, y: -400 },
      { id: 'lone-near', x: 0, y: 20 },
      { id: 'lone-other-column', x: 100, y: 0 },
    ];

    pinUnlinkedBelow(nodes, new Set(['a', 'b']), 60);

    expect(nodes.map(({ id, y }) => [id, y])).toEqual([['a', 10], ['b', 50], ['lone-far', 110], ['lone-near', 170], ['lone-other-column', 110]]);
    expect(nodes.find((node) => node.id === 'lone-far')).toMatchObject({ fy: 110 });
  });

  it('leaves a node its caller pinned, and a drawing with no link, to themselves', () => {
    const pinned = [{ id: 'a', x: 0, y: 10 }, { id: 'lone', x: 0, y: -400, pinnedY: -400 }];
    pinUnlinkedBelow(pinned, new Set(['a']), 60);
    expect(pinned[1]).toEqual({ id: 'lone', x: 0, y: -400, pinnedY: -400 });

    const unlinked = [{ id: 'a', x: 0, y: 10 }, { id: 'b', x: 0, y: -400 }];
    pinUnlinkedBelow(unlinked, new Set(), 60);
    expect(unlinked.map((node) => node.y)).toEqual([10, -400]);
  });
});
