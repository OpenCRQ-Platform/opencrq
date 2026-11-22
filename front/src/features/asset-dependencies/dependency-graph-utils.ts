import type {
  AssetCategory,
  AssetCriticality,
  AssetRelationKind,
  AssetRelationSource,
  DependencyGraphFold,
  DependencyLinkKind,
  PostureBand,
  SeverityBand,
  SupportToPrimaryLinkRole,
} from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { postureBandForScore, resolveSeverityBand, wholePercent } from '@app/module/client';
import { assetNameText } from '../../utils/asset-name-utils';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

/**
 * The payload as it reaches the client, which is not the service's own return type: nothing on this
 * client deserialises dates, so `firstSeenAt` and `lastSeenAt` arrive as ISO strings.
 */
export type DependencyGraphPayload = RouterOutputs['assetDependencies']['getPrimaryAssetDependencyGraph'];
export type AccessRelationGraphPayload = RouterOutputs['supportingAssets']['getSupportingAssetRelationGraph'];
/** `criticalityLift` comes with the access relation graph alone, which draws each asset's band. */
export type DependencyGraphPayloadAsset = DependencyGraphPayload['assets'][number]
  & Partial<Pick<AccessRelationGraphPayload['assets'][number], 'criticalityLift'>>;

/** What the canvas draws: the chain of business dependencies, or the access relations between identities and devices. */
export type GraphGrammar = 'dependencies' | 'access_relations';

export interface LinkAttackShare {
  outcomeTotal: number,
  transmittedTotal: number,
  share: number,
}

export const formatWholePercent = (fraction: number, locale: string): string => new Intl.NumberFormat(locale, {
  style: 'percent',
  maximumFractionDigits: 0,
}).format(wholePercent(fraction) / 100);

type RelationPayloadLink = AccessRelationGraphPayload['links'][number];

/**
 * Any of the graph payloads: the Targets graph adds the scenario's impact and attack share, and the
 * access relation graph its relations' sources and observation window.
 */
export type DependencyGraphInput = Omit<DependencyGraphPayload, 'assets' | 'links'> & {
  assets: Array<DependencyGraphPayloadAsset & { impact?: number }>,
  links: Array<(DependencyGraphPayload['links'][number] & { attackShare?: LinkAttackShare | null }) | RelationPayloadLink>,
};

export interface RelationFacts {
  sources: Array<AssetRelationSource>,
  firstSeenAt: string,
  lastReportedAt: string,
}

/** The lucide glyph a category is drawn with, on the canvas and in the selection panel alike. */
export type CategoryGlyph =
  | 'server'
  | 'box'
  | 'cloud'
  | 'globe'
  | 'network'
  | 'smartphone'
  | 'cpu'
  | 'user'
  | 'app-window'
  | 'brain'
  | 'git-branch'
  | 'shield-check'
  | 'shapes';

const CATEGORY_GLYPH: Record<AssetCategory, CategoryGlyph> = {
  host: 'server',
  container_workload: 'box',
  cloud_resource: 'cloud',
  web_application: 'globe',
  network_device: 'network',
  mobile_device: 'smartphone',
  iot_ot_device: 'cpu',
  identity: 'user',
  saas_application: 'app-window',
  ai_target: 'brain',
  source_code: 'git-branch',
  security_platform: 'shield-check',
  generic_asset: 'shapes',
};

export const categoryGlyph = (categoryId: AssetCategory): CategoryGlyph => CATEGORY_GLYPH[categoryId];

/**
 * OpenAEV's security domains, which file the same twelve categories: one colour per domain, the glyph
 * telling a domain's categories apart. In the legend's order.
 */
export const ASSET_DOMAINS = ['endpoint', 'cloud', 'web_application', 'network', 'identity', 'artificial_intelligence', 'security_platform', 'to_classify'] as const;
export type AssetDomain = (typeof ASSET_DOMAINS)[number];

const CATEGORY_DOMAIN: Record<AssetCategory, AssetDomain> = {
  host: 'endpoint',
  container_workload: 'endpoint',
  mobile_device: 'endpoint',
  cloud_resource: 'cloud',
  saas_application: 'cloud',
  ai_target: 'artificial_intelligence',
  source_code: 'web_application',
  network_device: 'network',
  iot_ot_device: 'network',
  web_application: 'web_application',
  identity: 'identity',
  security_platform: 'security_platform',
  generic_asset: 'to_classify',
};

/**
 * OpenCRQ's own constants, not tokens. Network and Web application replace OpenAEV's green and
 * orange, which carry severity on this graph, and Identity, which OpenAEV presets no colour for, is
 * OpenCTI's.
 */
 
const DOMAIN_COLOR: Record<AssetDomain, string> = {
  endpoint: '#389cff',
  cloud: '#9999cc',
  artificial_intelligence: '#7c4dff',
  network: '#00bd94',
  web_application: '#ea80fc',
  identity: '#ba88ff',
  security_platform: '#4dd0e1',
  to_classify: '#afb0b6',
};

export const assetDomain = (categoryId: AssetCategory): AssetDomain => CATEGORY_DOMAIN[categoryId];

export const assetDomainColor = (domain: AssetDomain): string => DOMAIN_COLOR[domain];

export const presentDomains = (model: DependencyGraphModel): Array<AssetDomain> => {
  const present = new Set(model.nodes.flatMap((node) => (node.asset === null ? [] : [assetDomain(node.asset.categoryId)])));
  return ASSET_DOMAINS.filter((domain) => present.has(domain));
};

/** Left to right in the row above a supporting asset. */
export type NodePin = { kind: 'crown', band: SeverityBand } | { kind: 'shield', band: PostureBand } | { kind: 'antenna' };

export const nodePins = (asset: DependencyGraphPayloadAsset, impact?: number): Array<NodePin> => {
  const pins: Array<NodePin> = [];
  if (impact !== undefined) {
    pins.push({ kind: 'crown', band: resolveSeverityBand(wholePercent(impact)) });
  }
  if (asset.postureScore !== null) {
    pins.push({ kind: 'shield', band: postureBandForScore(asset.postureScore) });
  }
  if (asset.exposure === 'internet_facing') {
    pins.push({ kind: 'antenna' });
  }
  return pins;
};

export interface FindingPill {
  band: Extract<SeverityBand, 'critical' | 'high'>,
  count: number,
}

/** Stacked top to bottom in this order. */
export const findingPills = (asset: DependencyGraphPayloadAsset): Array<FindingPill> => {
  const pills: Array<FindingPill> = [
    { band: 'critical', count: asset.criticalFindingCount },
    { band: 'high', count: asset.highFindingCount },
  ];
  return pills.filter((pill) => pill.count > 0);
};

/** The design system's own crosswalk, so a ring never disagrees with the chip beside it. */
const CRITICALITY_FEEDBACK_FAMILY: Record<AssetCriticality, string> = {
  very_high: 'error',
  high: 'warning',
  medium: 'alert',
  low: 'success',
  unknown: 'neutral',
};

export const criticalityRingProperty = (criticality: AssetCriticality): string =>
  `--fds-color-feedback-${CRITICALITY_FEEDBACK_FAMILY[criticality]}-primary`;

/** Which side of the selected asset something sits on: what it depends on, or what depends on it. */
export type DependencyDirection = 'provider' | 'dependent';

/** An unreached node keeps enough ink to stay legible as context. */
const UNREACHED_ALPHA = 0.14;

/** Everything the selection reaches reads at full strength, however far from it. */
export const ringAlpha = (ring: number | undefined): number => (ring === undefined ? UNREACHED_ALPHA : 1);

/** The synthetic node every internet-facing asset is drawn as depending on. Not an asset id. */
export const INTERNET_NODE_ID = 'internet-exposure';

/** Prefixed so an aggregate node can never collide with the asset whose providers it stands for. */
export const aggregateNodeId = (assetId: string): string => `aggregate:${assetId}`;

export type DependencyNodeKind = 'primary' | 'asset' | 'internet' | 'aggregate';

/**
 * `internet_exposure` is inferred from an asset's exposure and `beyond_depth` stands for the links the
 * walk left undrawn, past the depth or past what one asset draws: only the other kinds are stored
 * links, which the reader can select.
 */
export type DependencyEdgeKind = DependencyLinkKind | AssetRelationKind | 'internet_exposure' | 'beyond_depth';

export const isStoredLinkKind = (kind: DependencyEdgeKind): kind is DependencyLinkKind | AssetRelationKind =>
  kind !== 'internet_exposure' && kind !== 'beyond_depth';

export interface DependencyGraphNode {
  id: string,
  label: string,
  kind: DependencyNodeKind,
  /** The column the node is drawn in, as `layoutColumns` lays it out. */
  level: number,
  /** Only a supporting asset carries one: a primary asset and the internet node are drawn alone. */
  asset: DependencyGraphPayloadAsset | null,
  /** The asset's impact if compromised on the scenario, absent off the Targets graph. */
  impact?: number,
  /**
   * How many of this asset's providers the walk left undrawn. On the aggregate node standing for
   * them it is the count again, and its whole name: a plural, so the view is what resolves it.
   */
  hiddenProviderCount: number,
  /** On an aggregate node alone: a fold past the depth opens one level deeper, a fold past the width does not. */
  foldedBy?: DependencyGraphFold,
}

export interface DependencyGraphEdge {
  id: string,
  /** The dependent, which the link supports and the arrow points at. */
  source: string,
  /** The provider it depends on, the supporting end. */
  target: string,
  kind: DependencyEdgeKind,
  /** Only a link to a primary asset carries roles. */
  roles: Array<SupportToPrimaryLinkRole> | null,
  /** On a link to a primary asset, absent off the Targets graph. */
  attackShare?: LinkAttackShare,
  /** On an access relation alone. */
  relation?: RelationFacts,
}

export interface DependencyGraphModel {
  nodes: Array<DependencyGraphNode>,
  links: Array<DependencyGraphEdge>,
  /** The distinct assets the depth left out, which no count carried by a node adds up to. */
  hiddenAssetCount: number,
}

/** What the reader picked on the canvas: an asset, or a drawn edge by its id. */
export interface DependencyGraphSelection {
  kind: 'node' | 'edge',
  id: string,
}

export interface PrimaryAssetHeader {
  id: string,
  name: string,
}

export interface DependencyGraphLabels {
  unnamedAsset: string,
  internet: string,
}

export interface DependencyHighlight {
  id: string,
  label: string,
  criticality: AssetCriticality,
}

/** The three readings the counters above the canvas open on, each over the drawn assets alone. */
export interface DependencyHighlights {
  critical: Array<DependencyHighlight>,
  exposed: Array<DependencyHighlight>,
  unowned: Array<DependencyHighlight>,
}

/** What the critical reading counts: every band above the middle, not the top one alone. */
const CRITICAL_BANDS: ReadonlySet<AssetCriticality> = new Set<AssetCriticality>(['very_high', 'high']);

/**
 * An asset can answer several of the three at once, so the lists overlap by design: each states
 * which assets of the drawing carry that property, not a partition of them.
 */
export const dependencyHighlights = (model: DependencyGraphModel): DependencyHighlights => {
  const critical: Array<DependencyHighlight> = [];
  const exposed: Array<DependencyHighlight> = [];
  const unowned: Array<DependencyHighlight> = [];
  for (const node of model.nodes) {
    const { asset } = node;
    if (node.kind !== 'asset' || asset === null) {
      continue;
    }
    const entry = { id: asset.id, label: node.label, criticality: asset.criticality };
    if (CRITICAL_BANDS.has(asset.criticality)) {
      critical.push(entry);
    }
    if (asset.exposure === 'internet_facing') {
      exposed.push(entry);
    }
    if (asset.ownerName === null) {
      unowned.push(entry);
    }
  }
  return { critical, exposed, unowned };
};

/** The nodes one link away, split by the side they sit on, for the graph's text equivalent. */
export const nodeNeighbours = (model: DependencyGraphModel, nodeId: string): {
  providers: Array<DependencyGraphNode>,
  dependents: Array<DependencyGraphNode>,
} => {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const providers: Array<DependencyGraphNode> = [];
  const dependents: Array<DependencyGraphNode> = [];
  for (const link of model.links) {
    const provider = link.source === nodeId ? byId.get(link.target) : undefined;
    if (provider !== undefined) {
      providers.push(provider);
    }
    const dependent = link.target === nodeId ? byId.get(link.source) : undefined;
    if (dependent !== undefined) {
      dependents.push(dependent);
    }
  }
  return { providers, dependents };
};

const pushInto = <T>(index: Map<string, Array<T>>, key: string, value: T): void => {
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    index.set(key, [value]);
  }
};

interface ColumnLink {
  source: string,
  target: string,
}

/**
 * The column of every node: one past its furthest dependent, so every link runs left to right. The
 * assets of a mutual dependency are one unit sharing a column, since no order of the two is right,
 * and a longer stored cycle is cut at the link that closes it, in the order the roots reach it.
 */
const layoutColumns = (
  rootIds: Array<string>,
  nodeIds: Array<string>,
  links: Array<ColumnLink>,
): Map<string, number> => {
  const unitOf = new Map(nodeIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let unit = unitOf.get(id) ?? id;
    while (unit !== (unitOf.get(unit) ?? unit)) {
      unit = unitOf.get(unit) ?? unit;
    }
    return unit;
  };
  const pairs = new Set(links.map((link) => `${link.source}\u0000${link.target}`));
  for (const link of links) {
    if (pairs.has(`${link.target}\u0000${link.source}`)) {
      unitOf.set(find(link.source), find(link.target));
    }
  }

  const next = new Map<string, Set<string>>();
  for (const link of links) {
    const from = find(link.source);
    const to = find(link.target);
    if (from !== to) {
      const bucket = next.get(from) ?? new Set<string>();
      bucket.add(to);
      next.set(from, bucket);
    }
  }

  const onPath = new Set<string>();
  const done = new Set<string>();
  const postOrder: Array<string> = [];
  const closing = new Set<string>();
  const visit = (unit: string): void => {
    onPath.add(unit);
    for (const to of next.get(unit) ?? []) {
      if (onPath.has(to)) {
        closing.add(`${unit}\u0000${to}`);
      } else if (!done.has(to)) {
        visit(to);
      }
    }
    onPath.delete(unit);
    done.add(unit);
    postOrder.push(unit);
  };
  const roots = new Set(rootIds.map(find));
  for (const unit of [...roots, ...nodeIds.map(find)]) {
    if (!done.has(unit)) {
      visit(unit);
    }
  }

  const columns = new Map<string, number>();
  for (const unit of [...postOrder].reverse()) {
    const column = columns.get(unit) ?? (roots.has(unit) ? 0 : 1);
    columns.set(unit, column);
    for (const to of next.get(unit) ?? []) {
      if (!closing.has(`${unit}\u0000${to}`)) {
        columns.set(to, Math.max(columns.get(to) ?? 1, column + 1));
      }
    }
  }
  return new Map(nodeIds.map((id) => [id, columns.get(find(id)) ?? 1]));
};

/**
 * The payload as the canvas draws it: every asset nothing depends on as a root, which is every
 * primary asset and, on a walk that starts from a supporting asset, whatever the chain above it ends
 * on, one node per supporting asset however many branches and roots reach it, one link per stored link, the internet node every asset whose
 * exposure says it is reachable from it hangs off, and one aggregate node per asset, a primary one
 * included, whose providers the walk left undrawn, standing for them.
 */
export const buildDependencyGraph = (
  primaryAssets: Array<PrimaryAssetHeader>,
  graph: DependencyGraphInput,
  labels: DependencyGraphLabels,
  grammar: GraphGrammar = 'dependencies',
): DependencyGraphModel => {
  const foldOf = new Map(graph.truncated.map((row) => [row.assetId, row]));

  const nodes: Array<Omit<DependencyGraphNode, 'level'>> = primaryAssets.map((primaryAsset) => ({
    id: primaryAsset.id,
    label: primaryAsset.name,
    kind: 'primary',
    asset: null,
    hiddenProviderCount: foldOf.get(primaryAsset.id)?.hiddenProviderCount ?? 0,
  }));
  for (const asset of graph.assets) {
    nodes.push({
      id: asset.id,
      label: assetNameText(asset, labels.unnamedAsset),
      kind: 'asset',
      asset,
      impact: asset.impact,
      hiddenProviderCount: foldOf.get(asset.id)?.hiddenProviderCount ?? 0,
    });
  }

  const links: Array<DependencyGraphEdge> = graph.links.map((link) => ('sources' in link
    ? {
      id: link.id,
      source: link.dependentId,
      target: link.providerId,
      kind: link.kind,
      roles: null,
      relation: { sources: link.sources, firstSeenAt: link.firstSeenAt, lastReportedAt: link.lastReportedAt },
    }
    : {
      id: link.id,
      source: link.dependentId,
      target: link.providerId,
      kind: link.kind,
      roles: link.roles,
      attackShare: link.attackShare ?? undefined,
    }));

  for (const folding of [...nodes]) {
    const fold = foldOf.get(folding.id);
    if (fold !== undefined && fold.hiddenProviderCount > 0) {
      const id = aggregateNodeId(folding.id);
      nodes.push({ id, label: '', kind: 'aggregate', asset: null, hiddenProviderCount: fold.hiddenProviderCount, foldedBy: fold.foldedBy });
      links.push({ id, source: folding.id, target: id, kind: 'beyond_depth', roles: null });
    }
  }

  // Exposure is a dependency on the internet: the access relations keep it as the asset's antenna alone.
  const exposed = grammar === 'dependencies' ? graph.assets.filter((asset) => asset.exposure === 'internet_facing') : [];
  if (exposed.length > 0) {
    nodes.push({ id: INTERNET_NODE_ID, label: labels.internet, kind: 'internet', asset: null, hiddenProviderCount: 0 });
    for (const asset of exposed) {
      links.push({
        id: `${INTERNET_NODE_ID}:${asset.id}`,
        source: asset.id,
        target: INTERNET_NODE_ID,
        kind: 'internet_exposure',
        roles: null,
      });
    }
  }

  const dependedOn = new Set(links.map((link) => link.target));
  const rootIds = nodes.filter((node) => !dependedOn.has(node.id)).map((node) => node.id);
  const columns = layoutColumns(rootIds, nodes.map((node) => node.id), links);
  return {
    nodes: nodes.map((node) => ({ ...node, level: columns.get(node.id) ?? 1 })),
    links,
    hiddenAssetCount: graph.hiddenAssetCount,
  };
};

/**
 * What the canvas draws for the stored links: one edge per link, except the two opposite links of a
 * mutual dependency, which are one edge with a head at each end. Each keeps its own id in `links`,
 * since each is deleted on its own.
 */
export interface DrawnEdge {
  /** The smaller of its links' ids, so a refetch returning them in another order keeps a selection. */
  id: string,
  source: string,
  target: string,
  kind: DependencyEdgeKind,
  /** One link, or the two of a mutual dependency, the one the edge takes its id from first. */
  links: Array<DependencyGraphEdge>,
}

export const isMutualEdge = (edge: DrawnEdge): boolean => edge.links.length > 1;

export const isSelectableEdge = (edge: DrawnEdge): boolean => isStoredLinkKind(edge.kind);

/**
 * The band a relation gives the asset it ends on, when that band is the asset's own: the lift came
 * from the identity at the arrow's end, and nothing of the asset's own reaches it.
 */
export const edgeLift = (
  nodesById: ReadonlyMap<string, DependencyGraphNode>,
  link: Pick<DependencyGraphEdge, 'source' | 'target'>,
): AssetCriticality | null => {
  const lift = nodesById.get(link.target)?.asset?.criticalityLift;
  return lift !== undefined && lift !== null && lift.fromAssetId === link.source ? lift.criticality : null;
};

/**
 * Whether an edge's head says which way it runs. A truncation link of the access relations stands for
 * neighbours at either end of a relation, so it has none.
 */
export const isDirectedEdge = (edge: Pick<DrawnEdge, 'kind'>, grammar: GraphGrammar): boolean =>
  grammar !== 'access_relations' || edge.kind !== 'beyond_depth';

export const drawnEdges = (model: DependencyGraphModel): Array<DrawnEdge> => {
  const stored = new Map(model.links
    .filter((link) => link.kind === 'depends_on')
    .map((link) => [`${link.source}\u0000${link.target}`, link]));
  const merged = new Set<string>();
  const edges: Array<DrawnEdge> = [];
  for (const link of model.links) {
    if (merged.has(link.id)) {
      continue;
    }
    const reverse = link.kind === 'depends_on' ? stored.get(`${link.target}\u0000${link.source}`) : undefined;
    const [first, second] = reverse !== undefined && reverse.id < link.id ? [reverse, link] : [link, reverse];
    if (second !== undefined) {
      merged.add(first.id);
      merged.add(second.id);
    }
    edges.push({
      id: first.id,
      source: first.source,
      target: first.target,
      kind: first.kind,
      links: second === undefined ? [first] : [first, second],
    });
  }
  return edges;
};

export interface DependencyFocus {
  nodeRings: Map<string, number>,
  nodeDirections: Map<string, DependencyDirection>,
  linkRings: Map<string, number>,
  linkDirections: Map<string, DependencyDirection>,
}

/**
 * How far every node and link sits from the selected one, and on which side of it. Both sides are
 * expanded one ring at a time rather than one after the other, so an asset a cycle puts on both
 * sides keeps its shortest distance; `provider` wins a tie, being the reading the tab is built on.
 */
export const focusOnNode = (model: DependencyGraphModel, selectedId: string): DependencyFocus => {
  const outgoing = new Map<string, Array<DependencyGraphEdge>>();
  const incoming = new Map<string, Array<DependencyGraphEdge>>();
  for (const link of model.links) {
    pushInto(outgoing, link.source, link);
    pushInto(incoming, link.target, link);
  }

  const nodeRings = new Map<string, number>([[selectedId, 0]]);
  const nodeDirections = new Map<string, DependencyDirection>();
  const linkRings = new Map<string, number>();
  const linkDirections = new Map<string, DependencyDirection>();

  const directions: Array<DependencyDirection> = ['provider', 'dependent'];
  let frontiers = new Map<DependencyDirection, Array<string>>(directions.map((direction) => [direction, [selectedId]]));
  for (let ring = 1; directions.some((direction) => (frontiers.get(direction) ?? []).length > 0); ring += 1) {
    const next = new Map<DependencyDirection, Array<string>>(directions.map((direction) => [direction, []]));
    for (const direction of directions) {
      const edgesOf = direction === 'provider' ? outgoing : incoming;
      for (const nodeId of frontiers.get(direction) ?? []) {
        for (const link of edgesOf.get(nodeId) ?? []) {
          if (!linkRings.has(link.id)) {
            linkRings.set(link.id, ring);
            linkDirections.set(link.id, direction);
          }
          const reached = direction === 'provider' ? link.target : link.source;
          if (!nodeRings.has(reached)) {
            nodeRings.set(reached, ring);
            nodeDirections.set(reached, direction);
            next.get(direction)?.push(reached);
          }
        }
      }
    }
    frontiers = next;
  }

  return { nodeRings, nodeDirections, linkRings, linkDirections };
};

/** The edge and its two ends at full strength, and nothing else reached, so the rest of the graph fades. */
export const focusOnEdge = (edge: DrawnEdge): DependencyFocus => ({
  nodeRings: new Map([[edge.source, 0], [edge.target, 0]]),
  nodeDirections: new Map(),
  linkRings: new Map(edge.links.map((link) => [link.id, 1])),
  linkDirections: new Map(edge.links.map((link) => [link.id, 'provider' as const])),
});

export const drawnEdgeBetween = (edges: Array<DrawnEdge>, one: string, other: string): DrawnEdge | undefined =>
  edges.find((edge) => isSelectableEdge(edge)
    && ((edge.source === one && edge.target === other) || (edge.source === other && edge.target === one)));
