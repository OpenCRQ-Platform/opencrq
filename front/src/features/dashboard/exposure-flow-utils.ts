/**
 * Pure graph + layout maths for the exposure-flow Sankey.
 *
 * The diagram is only honest if dollars are conserved at every stage, which they are
 * because each split reuses a decomposition the CRQ engine already asserts:
 *  - actor shares come from `crq_indicator_group_scores`, whose shares sum to 1 (the
 *    unattributed `group_key = null` row closes the sum);
 *  - the loss-driver split is a sum of per-driver PERT expectations, which is how SLE is
 *    defined.
 *
 * The technique stage is the exception and must be read as an ATTRIBUTION, not a
 * measurement: a scenario's annual loss is split across its techniques in proportion to what
 * interdicting each is worth. The engine does not assert that split. It is what makes
 * the ribbons add up, and the widget labels it as such.
 *
 * Adjacency is held in nested maps rather than in packed `source|target` string keys:
 * outcome ids embed the outcome NAME, which contains spaces in most of the core outcomes,
 * so any single-character separator is a latent parsing bug.
 */

export const FLOW_COLUMNS = ['actor', 'outcome', 'technique', 'driver'] as const;
export type FlowColumn = typeof FLOW_COLUMNS[number];

/**
 * Buckets the VIEW must label, because their text needs translating and pluralising. The
 * util stays pure and i18n-free: it emits the discriminant and the count, exactly as the
 * frontend convention requires of a pure util that would otherwise return display text.
 */
export type ResidualKind =
  | 'unattributed-actors'
  | 'actor-tail'
  | 'unattributed-techniques'
  | 'technique-tail'
  | 'driver-tail'
  | 'unallocated-drivers';

export interface FlowNode {
  id: string,
  column: FlowColumn,
  /** Display name as the database states it. Empty for residual buckets. */
  label: string,
  value: number,
  /** Non-null when the view has to build the label. Also drives the muted styling. */
  residualKind: ResidualKind | null,
  /** How many entities were folded into this bucket. 0 for everything else. */
  foldedCount: number,
  /**
   * The single entity this node stands for, for the deep link. Null whenever there is
   * nothing to open: every residual bucket (they aggregate many entities, or none), and an
   * outcome whose id the caller could not resolve.
   *
   * The node id is NOT usable for this. It is a display key (the outcome column keys on the
   * name, and the residual buckets key on constants), so the identity has to be carried
   * separately.
   */
  entityId: string | null,
  /** The actor class an actor node stands for, which the view names. Null on every other node. */
  actorClass: string | null,
}

export interface FlowLink {
  source: string,
  target: string,
  value: number,
}

export interface ExposureFlow {
  nodes: Array<FlowNode>,
  links: Array<FlowLink>,
  total: number,
  /** Scenarios whose loss estimates are all empty, so their share lands in `Unallocated`. */
  unallocatedScenarioCount: number,
}

export interface FlowScenarioInput {
  scenarioId: string,
  outcomeName: string,
  /**
   * Outcome identity, kept apart from the name that keys the column. Optional because the
   * organization-wide summary endpoint selects the name only, so the caller has to resolve it
   * against the outcome catalogue and may come up empty.
   */
  outcomeId?: string | null,
  /** Annual loss expectancy carried into the flow. Scenarios without a run are excluded upstream. */
  ale: number,
  /** A group carrying `actorClass` stands for that class, and its key is local to its run. */
  groups: Array<FlowGroupInput>,
  /** The techniques the run priced, each with what interdicting it is worth. */
  techniques: Array<{ techniqueId: string, value: number }>,
  driverExpectations: Array<{ driverId: string, name: string, expected: number }>,
}

export interface FlowGroupInput {
  key: string | null,
  name: string | null,
  share: number,
  actorClass?: string | null,
}

export interface TechniqueLabel {
  externalId: string,
  name: string,
}

export interface BuildExposureFlowOptions {
  /** `mitreTechniqueId` → display label. Unknown ids fall back to a truncated id. */
  techniqueLabels: Map<string, TechniqueLabel>,
  maxTechniques?: number,
  maxActors?: number,
  maxDrivers?: number,
}

export const UNATTRIBUTED_ACTOR_ID = 'actor:unattributed';
export const UNALLOCATED_DRIVER_ID = 'driver:unallocated';
/**
 * A scenario whose run carries no technique of positive value. Kept apart from the folded tail:
 * they are different claims. The tail says "several small techniques, collapsed for legibility",
 * this one says "this money is attributed to no technique at all", and labelling the second with
 * the first's folded count is how a million dollars ends up captioned "0 other techniques".
 */
export const UNATTRIBUTED_TECHNIQUE_ID = 'technique:unattributed';
export const TECHNIQUE_TAIL_ID = 'technique:tail';
export const ACTOR_TAIL_ID = 'actor:tail';
export const DRIVER_TAIL_ID = 'driver:tail';

const ACTOR_PREFIX = 'actor:';
const ACTOR_CLASS_PREFIX = 'actor:class:';
const OUTCOME_PREFIX = 'outcome:';
const TECHNIQUE_PREFIX = 'technique:';
const DRIVER_PREFIX = 'driver:';
const ID_FALLBACK_CHARS = 8;

/**
 * Deliberately NOT raised alongside the smaller type. Node height is proportional to value,
 * not to font size, so a higher cap does not add readable rows: it splits the tail into
 * named slivers of a few pixels that carry no text, while the folded "N other" node they
 * came from was thick enough to read. Keeping the cap low and the tail fat is the better
 * trade. What the smaller type buys is the threshold: a node needs about 14px to carry one
 * row now, against roughly 18px at body size.
 */
const DEFAULT_MAX_TECHNIQUES = 6;
const DEFAULT_MAX_ACTORS = 6;
/**
 * The driver column is capped for the same reason as the other two, and it is the column that
 * needed it most: the loss-driver catalog is a closed set of 19 reference rows, against a fixed
 * drawing height. Uncapped, a portfolio touching most of them renders chips too thin to carry
 * text, and past ~50 the gaps alone exceed the height available.
 */
const DEFAULT_MAX_DRIVERS = 8;

/** The actor node a group feeds: every row of one class across scenarios merges into one node. */
export const actorNodeId = (group: FlowGroupInput): string => {
  if (group.actorClass !== undefined && group.actorClass !== null) {
    return `${ACTOR_CLASS_PREFIX}${group.actorClass}`;
  }
  return group.key === null ? UNATTRIBUTED_ACTOR_ID : `${ACTOR_PREFIX}${group.key}`;
};

const addTo = (map: Map<string, number>, key: string, value: number): void => {
  map.set(key, (map.get(key) ?? 0) + value);
};

/** Nested `source → target → value` accumulator. */
type Adjacency = Map<string, Map<string, number>>;

const addEdge = (adjacency: Adjacency, source: string, target: string, value: number): void => {
  const row = adjacency.get(source) ?? new Map<string, number>();
  row.set(target, (row.get(target) ?? 0) + value);
  adjacency.set(source, row);
};

/** Normalises weights to shares. Returns an empty map when nothing is positive. */
export const toShares = <T>(
  items: Array<T>,
  key: (item: T) => string,
  weight: (item: T) => number,
): Map<string, number> => {
  const positive = items.filter((item) => weight(item) > 0);
  const totalWeight = positive.reduce((sum, item) => sum + weight(item), 0);
  const shares = new Map<string, number>();
  if (totalWeight <= 0) {
    return shares;
  }
  for (const item of positive) {
    addTo(shares, key(item), weight(item) / totalWeight);
  }
  return shares;
};

/**
 * Ids of everything past the top `keep` by value, which the caller rewrites onto a single
 * residual node. Conservation stays exact: nothing is dropped, only merged. `pinnedLast`
 * ids are never folded: the unattributed bucket must always stay visible on its own.
 */
export const tailIds = (values: Map<string, number>, keep: number, pinnedLast: Array<string>): Set<string> =>
  new Set([...values.entries()]
    .filter(([id]) => !pinnedLast.includes(id))
    .toSorted((a, b) => b[1] - a[1])
    .slice(keep)
    .map(([id]) => id));

export const buildExposureFlow = (
  scenarios: Array<FlowScenarioInput>,
  options: BuildExposureFlowOptions,
): ExposureFlow => {
  const maxTechniques = options.maxTechniques ?? DEFAULT_MAX_TECHNIQUES;
  const maxActors = options.maxActors ?? DEFAULT_MAX_ACTORS;
  const maxDrivers = options.maxDrivers ?? DEFAULT_MAX_DRIVERS;

  const actorNames = new Map<string, string>();
  const actorClasses = new Map<string, string>();
  const driverNames = new Map<string, string>();
  const outcomeIds = new Map<string, string>();

  const actorValues = new Map<string, number>();
  const outcomeValues = new Map<string, number>();
  const techniqueValues = new Map<string, number>();
  const driverValues = new Map<string, number>();

  const actorToOutcome: Adjacency = new Map();
  const outcomeToTechnique: Adjacency = new Map();
  const techniqueToDriver: Adjacency = new Map();

  let unallocatedScenarioCount = 0;
  let total = 0;

  for (const scenario of scenarios) {
    if (!(scenario.ale > 0)) {
      continue;
    }
    total += scenario.ale;

    const outcomeId = `${OUTCOME_PREFIX}${scenario.outcomeName}`;
    addTo(outcomeValues, outcomeId, scenario.ale);
    if (scenario.outcomeId !== null && scenario.outcomeId !== undefined) {
      outcomeIds.set(outcomeId, scenario.outcomeId);
    }

    const actorShares = new Map<string, number>();
    for (const group of scenario.groups) {
      const id = actorNodeId(group);
      if (group.actorClass !== undefined && group.actorClass !== null) {
        actorClasses.set(id, group.actorClass);
      } else if (group.key !== null && group.name !== null) {
        actorNames.set(id, group.name);
      }
      addTo(actorShares, id, group.share);
    }
    // A run stored before the mixture engine carries no group rows; attribute the whole
    // scenario to the unattributed bucket rather than losing it from the flow.
    if (actorShares.size === 0) {
      actorShares.set(UNATTRIBUTED_ACTOR_ID, 1);
    }
    const shareTotal = [...actorShares.values()].reduce((sum, share) => sum + share, 0);
    for (const [id, share] of actorShares) {
      const value = shareTotal > 0 ? scenario.ale * (share / shareTotal) : 0;
      addTo(actorValues, id, value);
      addEdge(actorToOutcome, id, outcomeId, value);
    }

    const valueShares = toShares(
      scenario.techniques,
      (technique) => `${TECHNIQUE_PREFIX}${technique.techniqueId}`,
      (technique) => technique.value,
    );
    const techniqueShares = valueShares.size > 0
      ? valueShares
      : new Map([[UNATTRIBUTED_TECHNIQUE_ID, 1]]);

    for (const driver of scenario.driverExpectations) {
      driverNames.set(`${DRIVER_PREFIX}${driver.driverId}`, driver.name);
    }
    const pertShares = toShares(
      scenario.driverExpectations,
      (driver) => `${DRIVER_PREFIX}${driver.driverId}`,
      (driver) => driver.expected,
    );
    if (pertShares.size === 0) {
      unallocatedScenarioCount += 1;
    }
    const driverShares = pertShares.size > 0
      ? pertShares
      : new Map([[UNALLOCATED_DRIVER_ID, 1]]);

    for (const [techniqueId, techniqueShare] of techniqueShares) {
      const techniqueValue = scenario.ale * techniqueShare;
      addTo(techniqueValues, techniqueId, techniqueValue);
      addEdge(outcomeToTechnique, outcomeId, techniqueId, techniqueValue);
      for (const [driverId, driverShare] of driverShares) {
        const value = techniqueValue * driverShare;
        addTo(driverValues, driverId, value);
        addEdge(techniqueToDriver, techniqueId, driverId, value);
      }
    }
  }

  const foldedActorIds = tailIds(actorValues, maxActors, [UNATTRIBUTED_ACTOR_ID]);
  const foldedTechniqueIds = tailIds(techniqueValues, maxTechniques, [UNATTRIBUTED_TECHNIQUE_ID]);
  const foldedDriverIds = tailIds(driverValues, maxDrivers, [UNALLOCATED_DRIVER_ID]);

  const resolve = (id: string): string => {
    if (foldedActorIds.has(id)) {
      return ACTOR_TAIL_ID;
    }
    if (foldedTechniqueIds.has(id)) {
      return TECHNIQUE_TAIL_ID;
    }
    if (foldedDriverIds.has(id)) {
      return DRIVER_TAIL_ID;
    }
    return id;
  };

  const collapseValues = (values: Map<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [id, value] of values) {
      addTo(out, resolve(id), value);
    }
    return out;
  };

  const flattenLinks = (adjacency: Adjacency): Array<FlowLink> => {
    const merged: Adjacency = new Map();
    for (const [source, row] of adjacency) {
      for (const [target, value] of row) {
        addEdge(merged, resolve(source), resolve(target), value);
      }
    }
    return [...merged].flatMap(([source, row]) =>
      [...row].map(([target, value]) => ({ source, target, value })));
  };

  const foldedActors = collapseValues(actorValues);
  const foldedTechniques = collapseValues(techniqueValues);
  const foldedDrivers = collapseValues(driverValues);

  const techniqueLabel = (id: string): string => {
    if (id === TECHNIQUE_TAIL_ID || id === UNATTRIBUTED_TECHNIQUE_ID) {
      return '';
    }
    const raw = id.slice(TECHNIQUE_PREFIX.length);
    const known = options.techniqueLabels.get(raw);
    return known ? `${known.externalId} ${known.name}` : raw.slice(0, ID_FALLBACK_CHARS);
  };

  const actorLabel = (id: string): string => {
    if (id === UNATTRIBUTED_ACTOR_ID || id === ACTOR_TAIL_ID || actorClasses.has(id)) {
      return '';
    }
    return actorNames.get(id) ?? id.slice(ACTOR_PREFIX.length, ACTOR_PREFIX.length + ID_FALLBACK_CHARS);
  };

  /**
   * One node builder for all four columns. Every column defaults to "a real entity with nothing
   * folded into it" and states only what it does differently, so the shared eight keys cannot
   * drift between columns the way four separate object literals had begun to.
   */
  const toNodes = (
    column: FlowColumn,
    values: Map<string, number>,
    overrides: (id: string) => Partial<Omit<FlowNode, 'id' | 'column' | 'value'>> & { label: string },
  ): Array<FlowNode> => [...values].map(([id, value]) => ({
    id,
    column,
    value,
    residualKind: null,
    foldedCount: 0,
    entityId: id.slice(`${column}:`.length),
    actorClass: null,
    ...overrides(id),
  }));

  const nodes: Array<FlowNode> = [
    ...toNodes('actor', foldedActors, (id) => ({
      label: actorLabel(id),
      residualKind: id === UNATTRIBUTED_ACTOR_ID
        ? 'unattributed-actors'
        : id === ACTOR_TAIL_ID ? 'actor-tail' : null,
      foldedCount: id === ACTOR_TAIL_ID ? foldedActorIds.size : 0,
      // Outside a class, a group key IS the threat analysis id. It carries no foreign key by
      // design, so a link can outlive the analysis it points at.
      entityId: id === UNATTRIBUTED_ACTOR_ID || id === ACTOR_TAIL_ID || actorClasses.has(id)
        ? null
        : id.slice(ACTOR_PREFIX.length),
      actorClass: actorClasses.get(id) ?? null,
    })),
    ...toNodes('outcome', outcomeValues, (id) => ({
      label: id.slice(OUTCOME_PREFIX.length),
      entityId: outcomeIds.get(id) ?? null,
    })),
    ...toNodes('technique', foldedTechniques, (id) => ({
      label: techniqueLabel(id),
      residualKind: id === UNATTRIBUTED_TECHNIQUE_ID
        ? 'unattributed-techniques'
        : id === TECHNIQUE_TAIL_ID ? 'technique-tail' : null,
      foldedCount: id === TECHNIQUE_TAIL_ID ? foldedTechniqueIds.size : 0,
      entityId: id === TECHNIQUE_TAIL_ID || id === UNATTRIBUTED_TECHNIQUE_ID
        ? null
        : id.slice(TECHNIQUE_PREFIX.length),
    })),
    ...toNodes('driver', foldedDrivers, (id) => ({
      label: id === UNALLOCATED_DRIVER_ID || id === DRIVER_TAIL_ID
        ? ''
        : driverNames.get(id) ?? id.slice(DRIVER_PREFIX.length, DRIVER_PREFIX.length + ID_FALLBACK_CHARS),
      residualKind: id === UNALLOCATED_DRIVER_ID
        ? 'unallocated-drivers'
        : id === DRIVER_TAIL_ID ? 'driver-tail' : null,
      foldedCount: id === DRIVER_TAIL_ID ? foldedDriverIds.size : 0,
      entityId: id === UNALLOCATED_DRIVER_ID || id === DRIVER_TAIL_ID
        ? null
        : id.slice(DRIVER_PREFIX.length),
    })),
  ];

  const links: Array<FlowLink> = [
    ...flattenLinks(actorToOutcome),
    ...flattenLinks(outcomeToTechnique),
    ...flattenLinks(techniqueToDriver),
  ];

  return { nodes, links, total, unallocatedScenarioCount };
};

export interface SankeyGeometry {
  width: number,
  height: number,
  top: number,
  bottom: number,
  gap: number,
  chipWidths: [number, number, number, number],
  columnX: [number, number, number, number],
}

/**
 * Chip widths are sized against the 11px label type (~6.05px per character) so the longest
 * real name in each column fits without truncation: `T1190 Exploit Public-Facing Application`
 * (39 chars) sets the technique column and `Safety & Environmental Remediation` (34 chars)
 * the driver column. Anything wider than its labels need is waste; anything narrower eats
 * into the channel the ribbons need to stay readable.
 *
 * The viewBox width matches the card's interior so the type renders 1:1 instead of being
 * scaled down by `width: 100%`. It spans the full card now that the readout rail is gone,
 * which is what bought the columns enough room to stop truncating.
 */
export const DEFAULT_SANKEY_GEOMETRY: SankeyGeometry = {
  width: 1262,
  height: 520,
  top: 26,
  bottom: 12,
  gap: 10,
  chipWidths: [160, 176, 256, 228],
  columnX: [0, 312, 640, 1032],
};

/**
 * Most of any surplus width goes to the CHANNELS rather than the chips.
 *
 * A chip only needs to fit its longest label; past that, extra width is dead space. The channel is
 * where the ribbons live, and a wider channel is what makes a crossing legible: the curve gets
 * room to separate from its neighbours instead of bunching at the chip edge. Chips still take a
 * third of the surplus, which is what stops the longest ATT&CK names and the estate meta from
 * truncating on a wide screen.
 */
const CHIP_GROWTH_SHARE = 1 / 3;
/** Past this the ribbons are long lazy curves with a lot of nothing in the middle. */
const MAX_CHANNEL = 300;
/** Keeps the rightmost chip off the viewBox edge, where a 1px stroke would clip. */
const RIGHT_SLACK = 2;

/**
 * Geometry sized to the width actually available, so the drawing fills its card at 1:1.
 *
 * Scaling the viewBox instead would grow the type with the container, which is what made 11px
 * labels render near 20px on a wide monitor. Below the base width this returns the base geometry
 * unchanged and the caller scrolls.
 */
export const sankeyGeometryForWidth = (available: number): SankeyGeometry => {
  const base = DEFAULT_SANKEY_GEOMETRY;
  const target = Math.floor(available);
  if (!(target > base.width)) {
    return base;
  }
  const surplus = target - base.width;
  const perChip = Math.floor((surplus * CHIP_GROWTH_SHARE) / base.chipWidths.length);
  /*
   * Both tuples are built by destructuring rather than by `map`/`reduce` with a cast. `map` on a
   * 4-tuple returns `Array<number>`, so the previous form needed an assertion to narrow it back,
   * and an assertion is exactly what would hide a wrong arity if a fifth column were ever added.
   */
  const [baseActor, baseOutcome, baseTechnique, baseDriver] = base.chipWidths;
  const chipWidths: SankeyGeometry['chipWidths'] = [
    baseActor + perChip,
    baseOutcome + perChip,
    baseTechnique + perChip,
    baseDriver + perChip,
  ];
  const chipTotal = chipWidths.reduce((sum, chip) => sum + chip, 0);
  const channel = Math.min(
    Math.floor((target - chipTotal - RIGHT_SLACK) / (base.columnX.length - 1)),
    MAX_CHANNEL,
  );

  // Cumulative: each column starts one chip plus one channel after the previous. The last chip's
  // width never contributes, since nothing is placed to its right.
  const actorX = 0;
  const outcomeX = actorX + chipWidths[0] + channel;
  const techniqueX = outcomeX + chipWidths[1] + channel;
  const driverX = techniqueX + chipWidths[2] + channel;
  const columnX: SankeyGeometry['columnX'] = [actorX, outcomeX, techniqueX, driverX];

  return {
    ...base,
    chipWidths,
    columnX,
    width: columnX[columnX.length - 1] + chipWidths[chipWidths.length - 1] + RIGHT_SLACK,
  };
};

export interface PositionedNode extends FlowNode {
  x: number,
  y: number,
  width: number,
  height: number,
}

export interface PositionedLink extends FlowLink {
  path: string,
}

export interface SankeyLayout {
  nodes: Array<PositionedNode>,
  links: Array<PositionedLink>,
  geometry: SankeyGeometry,
}

export const layoutSankey = (
  flow: ExposureFlow,
  geometry: SankeyGeometry = DEFAULT_SANKEY_GEOMETRY,
): SankeyLayout => {
  const areaHeight = geometry.height - geometry.top - geometry.bottom;
  const byColumn = FLOW_COLUMNS.map((column) => flow.nodes.filter((node) => node.column === column));
  const maxCount = Math.max(1, ...byColumn.map((nodes) => nodes.length));
  /*
   * The gaps are taken out of the height before the value scale is derived, and the remainder is
   * floored at zero. Every column is capped upstream, so the fullest column is a known handful of
   * nodes and there is height left over. The floor is what keeps that an invariant rather than an
   * assumption: without it a column dense enough for the gaps to exceed the drawing height yields
   * a NEGATIVE scale, every chip gets a negative `height`, and SVG rejects the rect outright, so
   * the whole diagram disappears while the header still reports a total.
   */
  const usableHeight = Math.max(0, areaHeight - (maxCount - 1) * geometry.gap);
  const scale = flow.total > 0 ? usableHeight / flow.total : 0;

  const positioned = new Map<string, PositionedNode>();
  const nodes: Array<PositionedNode> = [];

  byColumn.forEach((columnNodes, columnIndex) => {
    // Value descending, residual buckets pinned last: they are a different kind of thing
    // from a named actor or a real technique and should not interleave with them.
    const ordered = columnNodes.toSorted((a, b) =>
      Number(a.residualKind !== null) - Number(b.residualKind !== null) || b.value - a.value);
    const stackHeight = ordered.reduce((sum, node) => sum + node.value * scale, 0)
      + Math.max(0, ordered.length - 1) * geometry.gap;
    let y = geometry.top + (areaHeight - stackHeight) / 2;
    for (const node of ordered) {
      const entry: PositionedNode = {
        ...node,
        x: geometry.columnX[columnIndex],
        width: geometry.chipWidths[columnIndex],
        height: node.value * scale,
        y,
      };
      nodes.push(entry);
      positioned.set(node.id, entry);
      y += entry.height + geometry.gap;
    }
  });

  // Ribbons leave and enter in the vertical order of the nodes they connect, which keeps
  // crossings down without a full sweep.
  const ordered = flow.links
    .filter((link) => positioned.has(link.source) && positioned.has(link.target))
    .toSorted((a, b) => {
      const sourceDelta = (positioned.get(a.source)?.y ?? 0) - (positioned.get(b.source)?.y ?? 0);
      return sourceDelta !== 0
        ? sourceDelta
        : (positioned.get(a.target)?.y ?? 0) - (positioned.get(b.target)?.y ?? 0);
    });

  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const links: Array<PositionedLink> = [];

  for (const link of ordered) {
    const source = positioned.get(link.source);
    const target = positioned.get(link.target);
    if (source === undefined || target === undefined) {
      continue;
    }
    const thickness = link.value * scale;
    const y0 = source.y + (outOffset.get(source.id) ?? 0);
    const y1 = target.y + (inOffset.get(target.id) ?? 0);
    outOffset.set(source.id, (outOffset.get(source.id) ?? 0) + thickness);
    inOffset.set(target.id, (inOffset.get(target.id) ?? 0) + thickness);

    const x0 = source.x + source.width;
    const x1 = target.x;
    const xm = (x0 + x1) / 2;
    links.push({
      ...link,
      path: `M ${x0} ${y0} C ${xm} ${y0} ${xm} ${y1} ${x1} ${y1}`
        + ` L ${x1} ${y1 + thickness} C ${xm} ${y1 + thickness} ${xm} ${y0 + thickness} ${x0} ${y0 + thickness} Z`,
    });
  }

  return { nodes, links, geometry };
};

/**
 * Every node reachable from `nodeId` in either direction: the hover isolation set.
 *
 * Both directions matter: hovering a technique should light the actors that reach it AND the
 * loss drivers it feeds, which is the whole point of tracing a path through the diagram.
 */
export const reachableNodeIds = (links: Array<FlowLink>, nodeId: string): Set<string> => {
  // Adjacency built first, then one traversal each way: an O(V+E) walk instead of rescanning
  // the whole link array on a hover that already re-renders every chip in the diagram.
  const successors = new Map<string, Array<string>>();
  const predecessors = new Map<string, Array<string>>();
  for (const link of links) {
    const out = successors.get(link.source) ?? [];
    out.push(link.target);
    successors.set(link.source, out);
    const into = predecessors.get(link.target) ?? [];
    into.push(link.source);
    predecessors.set(link.target, into);
  }

  /*
   * Each direction gets its OWN visited set, then the two are unioned. Sharing one would let the
   * downstream walk claim a node before the upstream walk reaches it, and the upstream walk would
   * then never expand that node's own predecessors.
   */
  const walk = (adjacency: Map<string, Array<string>>): Set<string> => {
    const seen = new Set([nodeId]);
    const queue = [nodeId];
    // Index-based on purpose: the queue is APPENDED TO while it is walked, and an index cursor is
    // the cheap way to do that. `for-of` would also see the growth, but relying on the array
    // iterator re-reading `length` each step is not something to leave implicit here.
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let index = 0; index < queue.length; index += 1) {
      for (const next of adjacency.get(queue[index]) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };

  return new Set([...walk(successors), ...walk(predecessors)]);
};

/** The only field the tiering needs. */
interface TieredMove {
  aleReduction: number,
}

export interface MoveTier<T> {
  moves: Array<T>,
  /** Ratio between the tier's best and worst move, for the "n× spread" caption. */
  spread: number,
}

/**
 * A ±30% weight error flips any pair under a 1.86× ratio, so moves within 2× of each other
 * form one tier and are deliberately not ranked against one another.
 */
const TIER_RATIO = 2;

/**
 * Generic over the move, so control upgrades and any future axis share ONE tiering rule rather
 * than growing a second copy that could drift from this ratio.
 */
export const groupMovesIntoTiers = <T extends TieredMove>(moves: Array<T>): Array<MoveTier<T>> => {
  const ranked = moves
    .filter((move) => move.aleReduction > 0)
    .toSorted((a, b) => b.aleReduction - a.aleReduction);
  const tiers: Array<MoveTier<T>> = [];
  for (const move of ranked) {
    const current = tiers.at(-1);
    const head = current?.moves.at(0);
    if (current !== undefined && head !== undefined
      && head.aleReduction / move.aleReduction < TIER_RATIO) {
      current.moves.push(move);
      current.spread = head.aleReduction / move.aleReduction;
    } else {
      tiers.push({ moves: [move], spread: 1 });
    }
  }
  return tiers;
};

/**
 * Means add up, so a control's mean reduction comes straight off the mean total. The clamp is not
 * cosmetic: reductions are not additive across controls, so a caller aggregating several can exceed
 * the total outright, and the axis would clip a negative projection into something that looks like
 * a rendering fault.
 */
export const projectMeanReduction = (total: number, reduction: number): number =>
  (reduction <= 0 ? total : Math.max(0, total - reduction));
