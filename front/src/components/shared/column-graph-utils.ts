export interface PositionedNode {
  x?: number,
  y?: number,
}

/**
 * One pass pushing apart, along `axis`, two nodes the layout left closer than `gap` on it while
 * sitting within `tolerance` of one another across it. The layout pins one coordinate per column
 * and leaves the other to a repulsion that routinely settles two siblings inside one another's
 * label, and a node carries no size the simulation knows of.
 *
 * Positions are moved in place, so the caller runs this against the array the drawing reads.
 */
export const spreadPeersOnce = (
  nodes: Array<PositionedNode>,
  axis: 'x' | 'y',
  gap: number,
  tolerance: number,
  strength: number,
): void => {
  const across = axis === 'x' ? 'y' : 'x';
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const first = nodes[i];
      const second = nodes[j];
      const offset = (second[axis] ?? 0) - (first[axis] ?? 0);
      const distance = Math.abs(offset);
      if (Math.abs((first[across] ?? 0) - (second[across] ?? 0)) <= tolerance && distance < gap) {
        const push = ((gap - distance) / 2) * strength;
        const direction = offset === 0 ? 1 : Math.sign(offset);
        first[axis] = (first[axis] ?? 0) - direction * push;
        second[axis] = (second[axis] ?? 0) + direction * push;
      }
    }
  }
};

interface PinnableNode extends PositionedNode {
  id: string,
  pinnedY?: number,
  fy?: number,
}

/**
 * Pins each node no link holds under the lowest linked node, one row per such node of a column. The
 * repulsion pushes such a node away for as long as the simulation runs, with nothing to pull it
 * back, and the fitted view then shrinks the whole drawing to keep it in. A node pinned by its
 * caller keeps its place, and a drawing with no link is left to the forces.
 */
export const pinUnlinkedBelow = (nodes: Array<PinnableNode>, linkedIds: ReadonlySet<string>, gap: number): void => {
  const linkedHeights = nodes.filter((node) => linkedIds.has(node.id)).map((node) => node.y ?? 0);
  if (linkedHeights.length === 0) {
    return;
  }
  const bottom = Math.max(...linkedHeights);
  const rowsByColumn = new Map<number, number>();
  const unlinked = nodes.filter((node) => !linkedIds.has(node.id) && node.pinnedY === undefined)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  for (const node of unlinked) {
    const column = Math.round(node.x ?? 0);
    const row = (rowsByColumn.get(column) ?? 0) + 1;
    rowsByColumn.set(column, row);
    node.y = bottom + gap * row;
    node.fy = node.y;
  }
};
