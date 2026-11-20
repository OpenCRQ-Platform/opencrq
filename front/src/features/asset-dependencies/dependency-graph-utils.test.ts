import { describe, expect, it } from 'vitest';
import { ASSET_CRITICALITY_VALUES } from '@app/module/client';
import type { AccessRelationGraphPayload, DependencyGraphPayload, DependencyGraphPayloadAsset } from './dependency-graph-utils';
import {
  aggregateNodeId,
  assetDomain,
  assetDomainColor,
  buildDependencyGraph,
  categoryGlyph,
  criticalityRingProperty,
  dependencyHighlights,
  drawnEdgeBetween,
  drawnEdges,
  edgeLift,
  findingPills,
  focusOnEdge,
  focusOnNode,
  INTERNET_NODE_ID,
  isDirectedEdge,
  isMutualEdge,
  isSelectableEdge,
  nodeNeighbours,
  nodePins,
  presentDomains,
  ringAlpha,
} from './dependency-graph-utils';

const PRIMARY = { id: 'primary', name: 'Customer billing' };
const SECOND_PRIMARY = { id: 'second', name: 'Card payments' };
const LABELS = { unnamedAsset: 'Unnamed', internet: 'Internet' };

const asset = (id: string, over: Partial<DependencyGraphPayloadAsset> = {}): DependencyGraphPayloadAsset => ({
  id,
  name: id,
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
  ...over,
});

type PayloadLink = DependencyGraphPayload['links'][number];

/** A link carries no role unless the test gives it some, as between two supporting assets. */
const payload = (
  { links = [], ...over }: Omit<Partial<DependencyGraphPayload>, 'links'> & {
    links?: Array<Omit<PayloadLink, 'roles'> & Partial<Pick<PayloadLink, 'roles'>>>,
  } = {},
): DependencyGraphPayload => ({
  assets: [],
  truncated: [],
  hiddenAssetCount: 0,
  ...over,
  links: links.map((link) => ({ roles: null, ...link })),
});

const levelOf = (nodes: ReturnType<typeof buildDependencyGraph>['nodes'], id: string): number | undefined =>
  nodes.find((node) => node.id === id)?.level;

describe('buildDependencyGraph', () => {
  it('roots the primary asset and lays every supporting asset out by its distance from it', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('hypervisor'), asset('vcenter')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'app', providerId: 'hypervisor', kind: 'depends_on' },
        { id: 'l3', dependentId: 'hypervisor', providerId: 'vcenter', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(model.nodes).toHaveLength(4);
    expect(levelOf(model.nodes, 'primary')).toBe(0);
    expect(levelOf(model.nodes, 'app')).toBe(1);
    expect(levelOf(model.nodes, 'hypervisor')).toBe(2);
    expect(levelOf(model.nodes, 'vcenter')).toBe(3);
    expect(model.nodes.find((node) => node.id === 'primary')?.kind).toBe('primary');
    expect(model.nodes.find((node) => node.id === 'app')?.kind).toBe('asset');
  });

  it('draws every link from the dependent towards the provider it depends on, with its roles', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app')],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on', roles: ['stores'] }],
    }), LABELS);

    expect(model.links).toEqual([{ id: 'l1', source: 'primary', target: 'app', kind: 'depends_on', roles: ['stores'] }]);
  });

  it('draws an asset two branches depend on once, with one incoming link per branch', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('db'), asset('cluster')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'primary', providerId: 'db', kind: 'depends_on' },
        { id: 'l3', dependentId: 'app', providerId: 'cluster', kind: 'depends_on' },
        { id: 'l4', dependentId: 'db', providerId: 'cluster', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(model.nodes.filter((node) => node.id === 'cluster')).toHaveLength(1);
    expect(model.links.filter((link) => link.target === 'cluster').map((link) => link.source)).toEqual(['app', 'db']);
  });

  it('puts an asset one column past its furthest dependent, so every link runs left to right', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('cluster')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'primary', providerId: 'cluster', kind: 'depends_on' },
        { id: 'l3', dependentId: 'app', providerId: 'cluster', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(levelOf(model.nodes, 'cluster')).toBe(2);
  });

  it('terminates on a stored cycle and keeps each asset once', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('a'), asset('b')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'a', kind: 'depends_on' },
        { id: 'l2', dependentId: 'a', providerId: 'b', kind: 'depends_on' },
        { id: 'l3', dependentId: 'b', providerId: 'a', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(model.nodes.map((node) => node.id)).toEqual(['primary', 'a', 'b']);
    expect(model.links).toHaveLength(3);
  });

  it('draws the two assets of a mutual dependency in one column, and their providers past it', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('a'), asset('b'), asset('san')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'app', providerId: 'a', kind: 'depends_on' },
        { id: 'l3', dependentId: 'a', providerId: 'b', kind: 'depends_on' },
        { id: 'l4', dependentId: 'b', providerId: 'a', kind: 'depends_on' },
        { id: 'l5', dependentId: 'b', providerId: 'san', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(['a', 'b', 'san'].map((id) => levelOf(model.nodes, id))).toEqual([2, 2, 3]);
  });

  it('cuts a longer stored cycle at the link closing it, in the order the roots reach it', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('a'), asset('b'), asset('c')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'a', kind: 'depends_on' },
        { id: 'l2', dependentId: 'a', providerId: 'b', kind: 'depends_on' },
        { id: 'l3', dependentId: 'b', providerId: 'c', kind: 'depends_on' },
        { id: 'l4', dependentId: 'c', providerId: 'a', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(['a', 'b', 'c'].map((id) => levelOf(model.nodes, id))).toEqual([1, 2, 3]);
  });

  it('carries the hidden provider count onto the asset the depth cut off', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('db')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'primary', providerId: 'db', kind: 'depends_on' },
      ],
      truncated: [{ assetId: 'app', hiddenProviderCount: 4, foldedBy: 'depth' }],
    }), LABELS);

    expect(model.nodes.find((node) => node.id === 'app')?.hiddenProviderCount).toBe(4);
    expect(model.nodes.find((node) => node.id === 'db')?.hiddenProviderCount).toBe(0);
  });

  it('hangs one aggregate node off the asset the depth cut off, a level further out', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('db')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'app', providerId: 'db', kind: 'depends_on' },
      ],
      truncated: [{ assetId: 'db', hiddenProviderCount: 4, foldedBy: 'depth' }],
    }), LABELS);

    const aggregates = model.nodes.filter((node) => node.kind === 'aggregate');
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].id).toBe(aggregateNodeId('db'));
    expect(aggregates[0].label).toBe('');
    expect(aggregates[0].hiddenProviderCount).toBe(4);
    expect(aggregates[0].asset).toBeNull();
    expect(aggregates[0].level).toBe(3);
    expect(model.links).toContainEqual({
      id: aggregateNodeId('db'), source: 'db', target: aggregateNodeId('db'), kind: 'beyond_depth', roles: null,
    });
  });

  it('hangs the aggregate of a fold past the width off the primary asset, which a click does not expand', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app')],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
      truncated: [{ assetId: 'primary', hiddenProviderCount: 69970, foldedBy: 'width' }],
    }), LABELS);

    expect(model.nodes.find((node) => node.id === 'primary')?.hiddenProviderCount).toBe(69970);
    expect(model.nodes.find((node) => node.kind === 'aggregate')).toMatchObject({
      id: aggregateNodeId('primary'), hiddenProviderCount: 69970, foldedBy: 'width', level: 1,
    });
    expect(model.links).toContainEqual({
      id: aggregateNodeId('primary'), source: 'primary', target: aggregateNodeId('primary'), kind: 'beyond_depth', roles: null,
    });
  });

  it('carries the count of hidden assets the payload states, not a sum of the direct providers', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('db')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'primary', providerId: 'db', kind: 'depends_on' },
      ],
      truncated: [{ assetId: 'app', hiddenProviderCount: 1, foldedBy: 'depth' }, { assetId: 'db', hiddenProviderCount: 1, foldedBy: 'depth' }],
      hiddenAssetCount: 5,
    }), LABELS);

    expect(model.hiddenAssetCount).toBe(5);
  });

  it('draws no aggregate node when the depth cut nothing off', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app')],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
    }), LABELS);

    expect(model.nodes.some((node) => node.kind === 'aggregate')).toBe(false);
  });

  it('labels an asset with no name from the caller-supplied fallback', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app', { name: null })],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
    }), LABELS);

    expect(model.nodes.find((node) => node.id === 'app')?.label).toBe('Unnamed');
  });

  it('labels an asset with no name by its derived name', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app', { name: null, derivedName: '10.0.0.1' })],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
    }), LABELS);

    expect(model.nodes.find((node) => node.id === 'app')?.label).toBe('10.0.0.1');
  });

  it('keeps the real name ahead of the derived name', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app', { name: 'srv-01', derivedName: '10.0.0.1' })],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
    }), LABELS);

    expect(model.nodes.find((node) => node.id === 'app')?.label).toBe('srv-01');
  });

  it('draws one internet node every internet-facing asset depends on', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [
        asset('front', { exposure: 'internet_facing' }),
        asset('api', { exposure: 'internet_facing' }),
        asset('db'),
      ],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'front', kind: 'depends_on' },
        { id: 'l2', dependentId: 'front', providerId: 'api', kind: 'depends_on' },
        { id: 'l3', dependentId: 'api', providerId: 'db', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(model.nodes.filter((node) => node.kind === 'internet')).toHaveLength(1);
    expect(model.nodes.find((node) => node.kind === 'internet')?.label).toBe('Internet');
    const exposure = model.links.filter((link) => link.kind === 'internet_exposure');
    expect(exposure.map((link) => link.source)).toEqual(['front', 'api']);
    expect(exposure.every((link) => link.target === INTERNET_NODE_ID)).toBe(true);
  });

  it('sits the internet node below the deepest asset reaching it', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('front', { exposure: 'internet_facing' }), asset('api', { exposure: 'internet_facing' })],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'front', kind: 'depends_on' },
        { id: 'l2', dependentId: 'front', providerId: 'api', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(levelOf(model.nodes, INTERNET_NODE_ID)).toBe(3);
  });

  it('draws no internet node when no asset is internet-facing', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app', { exposure: 'unknown' })],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
    }), LABELS);

    expect(model.nodes.some((node) => node.kind === 'internet')).toBe(false);
    expect(model.links.some((link) => link.kind === 'internet_exposure')).toBe(false);
  });

  it('roots every primary asset in the first column', () => {
    const model = buildDependencyGraph([PRIMARY, SECOND_PRIMARY], payload({
      assets: [asset('app'), asset('gateway')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'second', providerId: 'gateway', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(model.nodes.filter((node) => node.kind === 'primary').map((node) => [node.id, node.level]))
      .toEqual([['primary', 0], ['second', 0]]);
    expect(levelOf(model.nodes, 'gateway')).toBe(1);
  });

  it('draws a provider two primary assets share once, with a link from each', () => {
    const model = buildDependencyGraph([PRIMARY, SECOND_PRIMARY], payload({
      assets: [asset('db')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'db', kind: 'depends_on' },
        { id: 'l2', dependentId: 'second', providerId: 'db', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(model.nodes.filter((node) => node.id === 'db')).toHaveLength(1);
    expect(model.links.filter((link) => link.target === 'db').map((link) => link.source)).toEqual(['primary', 'second']);
  });

  it('puts a provider two primary assets reach at different distances past the further one', () => {
    const model = buildDependencyGraph([PRIMARY, SECOND_PRIMARY], payload({
      assets: [asset('app'), asset('db'), asset('san')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'app', providerId: 'db', kind: 'depends_on' },
        { id: 'l3', dependentId: 'second', providerId: 'db', kind: 'depends_on' },
        { id: 'l4', dependentId: 'db', providerId: 'san', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(levelOf(model.nodes, 'db')).toBe(2);
    expect(levelOf(model.nodes, 'san')).toBe(3);
  });

  it('roots a supporting asset nothing depends on, when the chain above it reaches no primary asset', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('db'), asset('gateway'), asset('san')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'app', providerId: 'db', kind: 'depends_on' },
        { id: 'l3', dependentId: 'gateway', providerId: 'db', kind: 'depends_on' },
        { id: 'l4', dependentId: 'db', providerId: 'san', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(levelOf(model.nodes, 'primary')).toBe(0);
    expect(levelOf(model.nodes, 'gateway')).toBe(0);
    expect(levelOf(model.nodes, 'db')).toBe(2);
    expect(levelOf(model.nodes, 'san')).toBe(3);
  });
});

describe('dependencyHighlights', () => {
  const model = buildDependencyGraph([PRIMARY], payload({
    assets: [
      asset('app', { criticality: 'high', exposure: 'internet_facing', ownerName: 'Dana' }),
      asset('db', { criticality: 'high', ownerName: null }),
      asset('store', { criticality: 'low', ownerName: 'Dana' }),
    ],
    links: [
      { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
      { id: 'l2', dependentId: 'app', providerId: 'db', kind: 'depends_on' },
      { id: 'l3', dependentId: 'app', providerId: 'store', kind: 'depends_on' },
    ],
  }), LABELS);

  it('names the assets of each reading, and lists an asset under every one it answers', () => {
    const highlights = dependencyHighlights(model);

    expect(highlights.critical.map((entry) => entry.id)).toEqual(['app', 'db']);
    expect(highlights.exposed.map((entry) => entry.id)).toEqual(['app']);
    expect(highlights.unowned.map((entry) => entry.id)).toEqual(['db']);
  });

  it('counts a very_high asset as critical, the band above the one that used to be the ceiling', () => {
    const topBand = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('vault', { criticality: 'very_high', ownerName: 'Dana' }), asset('cache', { criticality: 'medium', ownerName: 'Dana' })],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'vault', kind: 'depends_on' },
        { id: 'l2', dependentId: 'primary', providerId: 'cache', kind: 'depends_on' },
      ],
    }), LABELS);

    expect(dependencyHighlights(topBand).critical.map((entry) => entry.id)).toEqual(['vault']);
  });

  it('counts neither the primary asset nor the internet node', () => {
    const exposedModel = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app', { exposure: 'internet_facing', ownerName: null })],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
    }), LABELS);

    expect(dependencyHighlights(exposedModel).unowned.map((entry) => entry.id)).toEqual(['app']);
  });

  it('counts an asset two primary assets share once', () => {
    const shared = buildDependencyGraph([PRIMARY, SECOND_PRIMARY], payload({
      assets: [asset('db', { criticality: 'high', exposure: 'internet_facing', ownerName: null })],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'db', kind: 'depends_on' },
        { id: 'l2', dependentId: 'second', providerId: 'db', kind: 'depends_on' },
      ],
    }), LABELS);

    const highlights = dependencyHighlights(shared);
    expect([highlights.critical, highlights.exposed, highlights.unowned].map((entries) => entries.length)).toEqual([1, 1, 1]);
  });
});

describe('focusOnNode', () => {
  const chain = () => buildDependencyGraph([PRIMARY], payload({
    assets: [asset('app'), asset('hypervisor'), asset('storage')],
    links: [
      { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
      { id: 'l2', dependentId: 'app', providerId: 'hypervisor', kind: 'depends_on' },
      { id: 'l3', dependentId: 'hypervisor', providerId: 'storage', kind: 'depends_on' },
    ],
  }), LABELS);

  it('separates what the selection depends on from what depends on it', () => {
    const focus = focusOnNode(chain(), 'app');

    expect(focus.nodeDirections.get('hypervisor')).toBe('provider');
    expect(focus.nodeDirections.get('storage')).toBe('provider');
    expect(focus.nodeDirections.get('primary')).toBe('dependent');
    expect(focus.linkDirections.get('l2')).toBe('provider');
    expect(focus.linkDirections.get('l1')).toBe('dependent');
  });

  it('numbers every ring by its distance from the selection', () => {
    const focus = focusOnNode(chain(), 'app');

    expect(focus.nodeRings.get('app')).toBe(0);
    expect(focus.nodeRings.get('hypervisor')).toBe(1);
    expect(focus.nodeRings.get('storage')).toBe(2);
    expect(focus.linkRings.get('l2')).toBe(1);
    expect(focus.linkRings.get('l3')).toBe(2);
  });

  it('leaves a node no path reaches out of the rings', () => {
    const focus = focusOnNode(chain(), 'storage');

    expect(focus.nodeRings.get('storage')).toBe(0);
    expect(focus.nodeRings.get('primary')).toBe(3);
    expect(focus.nodeRings.has('absent')).toBe(false);
  });

  it('reaches every primary asset a shared provider leads to on the dependent side', () => {
    const model = buildDependencyGraph([PRIMARY, SECOND_PRIMARY], payload({
      assets: [asset('app'), asset('db')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'app', providerId: 'db', kind: 'depends_on' },
        { id: 'l3', dependentId: 'second', providerId: 'db', kind: 'depends_on' },
      ],
    }), LABELS);

    const focus = focusOnNode(model, 'db');

    expect(focus.nodeDirections.get('primary')).toBe('dependent');
    expect(focus.nodeDirections.get('second')).toBe('dependent');
  });

  it('keeps the shorter distance for an asset a cycle puts on both sides', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('a'), asset('b'), asset('c')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'a', kind: 'depends_on' },
        { id: 'l2', dependentId: 'a', providerId: 'b', kind: 'depends_on' },
        { id: 'l3', dependentId: 'b', providerId: 'c', kind: 'depends_on' },
        { id: 'l4', dependentId: 'c', providerId: 'a', kind: 'depends_on' },
      ],
    }), LABELS);

    const focus = focusOnNode(model, 'a');

    expect(focus.nodeRings.get('c')).toBe(1);
    expect(focus.nodeDirections.get('c')).toBe('dependent');
    expect(focus.nodeRings.get('b')).toBe(1);
    expect(focus.nodeDirections.get('b')).toBe('provider');
  });
});

describe('nodeNeighbours', () => {
  const model = buildDependencyGraph([PRIMARY], payload({
    assets: [asset('app'), asset('store'), asset('hypervisor', { exposure: 'internet_facing' })],
    links: [
      { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
      { id: 'l2', dependentId: 'primary', providerId: 'store', kind: 'depends_on' },
      { id: 'l3', dependentId: 'app', providerId: 'hypervisor', kind: 'depends_on' },
      { id: 'l4', dependentId: 'store', providerId: 'hypervisor', kind: 'depends_on' },
    ],
  }), LABELS);

  it('splits the nodes one link away by the side they sit on', () => {
    const { providers, dependents } = nodeNeighbours(model, 'app');

    expect(providers.map((node) => node.id)).toEqual(['hypervisor']);
    expect(dependents.map((node) => node.id)).toEqual(['primary']);
  });

  it('lists every dependent of an asset several branches reach', () => {
    const { providers, dependents } = nodeNeighbours(model, 'hypervisor');

    expect(dependents.map((node) => node.id).sort()).toEqual(['app', 'store']);
    expect(providers.map((node) => node.id)).toEqual([INTERNET_NODE_ID]);
  });

  it('returns two empty sides for a node no link touches', () => {
    expect(nodeNeighbours(model, 'absent')).toEqual({ providers: [], dependents: [] });
  });
});

describe('ringAlpha', () => {
  it('draws every reached ring at full strength and keeps an unreached node faintly visible', () => {
    expect(ringAlpha(0)).toBe(1);
    expect(ringAlpha(1)).toBe(1);
    expect(ringAlpha(12)).toBe(1);
    expect(ringAlpha(undefined)).toBeGreaterThan(0);
    expect(ringAlpha(undefined)).toBeLessThan(1);
  });
});

describe('criticalityRingProperty', () => {
  it('gives every band its own colour, `low` and `unknown` included', () => {
    const properties = ASSET_CRITICALITY_VALUES.map(criticalityRingProperty);
    expect(new Set(properties).size).toBe(ASSET_CRITICALITY_VALUES.length);
    expect(criticalityRingProperty('low')).not.toBe(criticalityRingProperty('unknown'));
  });
});

describe('categoryGlyph', () => {
  it('gives a host and an identity different glyphs', () => {
    expect(categoryGlyph('host')).not.toBe(categoryGlyph('identity'));
  });
});

describe('drawnEdges', () => {
  const mutual = () => buildDependencyGraph([PRIMARY], payload({
    assets: [asset('app'), asset('a'), asset('b')],
    links: [
      { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on', roles: ['stores'] },
      { id: 'l2', dependentId: 'app', providerId: 'a', kind: 'depends_on' },
      { id: 'l3', dependentId: 'a', providerId: 'b', kind: 'depends_on' },
      { id: 'l4', dependentId: 'b', providerId: 'a', kind: 'depends_on' },
    ],
  }), LABELS);

  it('draws the two opposite links of a mutual dependency as one edge that keeps both', () => {
    const edges = drawnEdges(mutual());

    expect(edges.map((edge) => edge.id)).toEqual(['l1', 'l2', 'l3']);
    const between = edges.find((edge) => edge.id === 'l3');
    expect(between && isMutualEdge(between)).toBe(true);
    expect(between?.links.map((link) => link.id)).toEqual(['l3', 'l4']);
  });

  it('names a mutual edge after the same link whatever order the payload lists them in', () => {
    const model = mutual();
    const reordered = { ...model, links: [...model.links].reverse() };

    expect(drawnEdges(reordered).find(isMutualEdge)?.id).toBe('l3');
  });

  it('draws any other link as an edge of its own', () => {
    const edges = drawnEdges(mutual());

    expect(edges.filter((edge) => !isMutualEdge(edge)).map((edge) => edge.links.map((link) => link.id)))
      .toEqual([['l1'], ['l2']]);
  });

  it('lets the reader select a stored link, never an edge the view derives', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app', { exposure: 'internet_facing' })],
      links: [{ id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' }],
      truncated: [{ assetId: 'app', hiddenProviderCount: 2, foldedBy: 'depth' }],
    }), LABELS);

    expect(drawnEdges(model).filter(isSelectableEdge).map((edge) => edge.id)).toEqual(['l1']);
  });

  it('finds the edge joining two nodes whichever way it runs', () => {
    const edges = drawnEdges(mutual());

    expect(drawnEdgeBetween(edges, 'app', 'primary')?.id).toBe('l1');
    expect(drawnEdgeBetween(edges, 'b', 'a')?.id).toBe('l3');
    expect(drawnEdgeBetween(edges, 'primary', 'b')).toBeUndefined();
  });
});

describe('focusOnEdge', () => {
  it('keeps the edge and its two ends, and reaches nothing else', () => {
    const model = buildDependencyGraph([PRIMARY], payload({
      assets: [asset('app'), asset('db')],
      links: [
        { id: 'l1', dependentId: 'primary', providerId: 'app', kind: 'depends_on' },
        { id: 'l2', dependentId: 'app', providerId: 'db', kind: 'depends_on' },
      ],
    }), LABELS);
    const [first] = drawnEdges(model);

    const focus = focusOnEdge(first);

    expect([...focus.nodeRings.keys()].sort()).toEqual(['app', 'primary']);
    expect([...focus.linkRings.keys()]).toEqual(['l1']);
    expect(ringAlpha(focus.nodeRings.get('db'))).toBeLessThan(ringAlpha(focus.nodeRings.get('app')));
  });
});

describe('assetDomain', () => {
  it('gives a host and a container the one Endpoint colour', () => {
    expect(assetDomain('host')).toBe('endpoint');
    expect(assetDomain('container_workload')).toBe('endpoint');
    expect(assetDomainColor(assetDomain('container_workload'))).toBe(assetDomainColor(assetDomain('host')));
  });

  it('files every category under a domain', () => {
    expect(assetDomain('saas_application')).toBe('cloud');
    expect(assetDomain('iot_ot_device')).toBe('network');
    expect(assetDomain('generic_asset')).toBe('to_classify');
  });
});

describe('presentDomains', () => {
  it('lists only the domains of the drawn assets, once each, in the legend order', () => {
    const model = buildDependencyGraph([PRIMARY], {
      assets: [
        asset('portal', { categoryId: 'web_application' }),
        asset('app', { categoryId: 'host' }),
        asset('pod', { categoryId: 'container_workload' }),
      ],
      links: [],
      truncated: [],
      hiddenAssetCount: 0,
    }, LABELS);

    expect(presentDomains(model)).toEqual(['endpoint', 'web_application']);
  });
});

describe('nodePins', () => {
  it('puts the shield in the posture band, then the antenna of an internet-facing asset', () => {
    expect(nodePins(asset('edge', { postureScore: 30, exposure: 'internet_facing' }))).toEqual([
      { kind: 'shield', band: 'weak' },
      { kind: 'antenna' },
    ]);
  });

  it('draws no shield for an asset with no posture', () => {
    expect(nodePins(asset('app'))).toEqual([]);
  });

  it('heads the row with a crown in the band of the truncated impact, on the Targets graph', () => {
    expect(nodePins(asset('edge', { postureScore: 30 }), 0.899)).toEqual([
      { kind: 'crown', band: 'high' },
      { kind: 'shield', band: 'weak' },
    ]);
  });
});

describe('findingPills', () => {
  it('stacks the critical count above the high one', () => {
    expect(findingPills(asset('app', { criticalFindingCount: 2, highFindingCount: 1 }))).toEqual([
      { band: 'critical', count: 2 },
      { band: 'high', count: 1 },
    ]);
  });

  it('leaves out a band with no finding', () => {
    expect(findingPills(asset('app', { highFindingCount: 3 }))).toEqual([{ band: 'high', count: 3 }]);
    expect(findingPills(asset('app'))).toEqual([]);
  });
});

describe('the access relation graph', () => {
  const relation = (id: string, identityId: string, deviceId: string): AccessRelationGraphPayload['links'][number] => ({
    id,
    dependentId: identityId,
    providerId: deviceId,
    kind: 'primary_user_of',
    roles: null,
    sources: ['entra_registered_owner'],
    firstSeenAt: '2026-09-01T08:00:00.000Z',
    lastReportedAt: '2026-10-07T08:00:00.000Z',
  });
  const relations = (links: Array<AccessRelationGraphPayload['links'][number]>, assets: Array<DependencyGraphPayloadAsset>) =>
    buildDependencyGraph([], { assets, links, truncated: [], hiddenAssetCount: 0 }, LABELS, 'access_relations');

  it('draws each relation from its device to its identity, carrying where and when it was read', () => {
    const model = relations([relation('r1', 'claire', 'laptop')], [asset('claire', { categoryId: 'identity' }), asset('laptop')]);

    expect(model.links).toEqual([{
      id: 'r1',
      source: 'claire',
      target: 'laptop',
      kind: 'primary_user_of',
      roles: null,
      relation: { sources: ['entra_registered_owner'], firstSeenAt: '2026-09-01T08:00:00.000Z', lastReportedAt: '2026-10-07T08:00:00.000Z' },
    }]);
    expect(isSelectableEdge(drawnEdges(model)[0])).toBe(true);
  });

  it('hangs no asset off the internet, whose exposure is no relation', () => {
    const model = relations([relation('r1', 'claire', 'laptop')], [asset('claire', { categoryId: 'identity' }), asset('laptop', { exposure: 'internet_facing' })]);

    expect(model.nodes.map((node) => node.id)).not.toContain(INTERNET_NODE_ID);
  });

  it('names the band an edge gives only on the edge from the identity the lift came from', () => {
    const model = relations(
      [relation('r1', 'claire', 'laptop'), relation('r2', 'marc', 'laptop')],
      [
        asset('claire', { categoryId: 'identity', criticality: 'very_high' }),
        asset('marc', { categoryId: 'identity', criticality: 'high' }),
        asset('laptop', { criticality: 'high', criticalityLift: { criticality: 'high', fromAssetId: 'claire' } }),
      ],
    );

    const nodesById = new Map(model.nodes.map((node) => [node.id, node]));

    expect(edgeLift(nodesById, { source: 'claire', target: 'laptop' })).toBe('high');
    expect(edgeLift(nodesById, { source: 'marc', target: 'laptop' })).toBeNull();
  });

  it('heads no truncation link, whose hidden neighbours sit at either end of a relation', () => {
    const model = buildDependencyGraph(
      [],
      { assets: [asset('claire', { categoryId: 'identity' }), asset('laptop')], links: [relation('r1', 'claire', 'laptop')], truncated: [{ assetId: 'laptop', hiddenProviderCount: 1, foldedBy: 'depth' }], hiddenAssetCount: 1 },
      LABELS,
      'access_relations',
    );
    const truncation = drawnEdges(model).find((edge) => edge.kind === 'beyond_depth')!;

    expect(isDirectedEdge(truncation, 'access_relations')).toBe(false);
    expect(isDirectedEdge(drawnEdges(model).find((edge) => edge.kind === 'primary_user_of')!, 'access_relations')).toBe(true);
    expect(isDirectedEdge(truncation, 'dependencies')).toBe(true);
  });
});
