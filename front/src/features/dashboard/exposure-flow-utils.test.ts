import { describe, expect, it } from 'vitest';
import type { FlowScenarioInput, TechniqueLabel } from './exposure-flow-utils';
import {
  ACTOR_TAIL_ID,
  buildExposureFlow,
  DRIVER_TAIL_ID,
  groupMovesIntoTiers,
  layoutSankey,
  projectMeanReduction,
  reachableNodeIds,
  TECHNIQUE_TAIL_ID,
  UNALLOCATED_DRIVER_ID,
  UNATTRIBUTED_ACTOR_ID,
  UNATTRIBUTED_TECHNIQUE_ID,
} from './exposure-flow-utils';

const labels = new Map<string, TechniqueLabel>([
  ['tech-a', { externalId: 'T1078', name: 'Valid Accounts' }],
  ['tech-b', { externalId: 'T1566', name: 'Phishing' }],
]);

const scenario = (overrides: Partial<FlowScenarioInput> = {}): FlowScenarioInput => ({
  scenarioId: 'scenario-1',
  outcomeName: 'Data Exfiltration',
  ale: 1000,
  groups: [
    { key: 'group-1', name: 'ALPHV', share: 0.6 },
    { key: null, name: null, share: 0.4 },
  ],
  techniques: [
    { techniqueId: 'tech-a', value: 3 },
    { techniqueId: 'tech-b', value: 1 },
  ],
  driverExpectations: [
    { driverId: 'driver-1', name: 'Interruption', expected: 300 },
    { driverId: 'driver-2', name: 'Response', expected: 100 },
  ],
  ...overrides,
});

const columnTotal = (flow: ReturnType<typeof buildExposureFlow>, column: string): number =>
  flow.nodes.filter((node) => node.column === column).reduce((sum, node) => sum + node.value, 0);

describe('buildExposureFlow', () => {
  it('should conserve dollars across all four columns', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });

    expect(flow.total).toBe(1000);
    for (const column of ['actor', 'outcome', 'technique', 'driver']) {
      expect(columnTotal(flow, column)).toBeCloseTo(1000, 6);
    }
  });

  it('should conserve dollars on every link stage', () => {
    const flow = buildExposureFlow([scenario(), scenario({ scenarioId: 's2', outcomeName: 'Ransomware', ale: 500 })], {
      techniqueLabels: labels,
    });

    const actorLinks = flow.links.filter((link) => link.source.startsWith('actor:'));
    const outcomeLinks = flow.links.filter((link) => link.source.startsWith('outcome:'));
    const techniqueLinks = flow.links.filter((link) => link.source.startsWith('technique:'));

    expect(actorLinks.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(1500, 6);
    expect(outcomeLinks.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(1500, 6);
    expect(techniqueLinks.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(1500, 6);
  });

  it('should keep outcome names containing spaces intact through link aggregation', () => {
    const flow = buildExposureFlow([scenario({ outcomeName: 'Credential Compromise' })], {
      techniqueLabels: labels,
    });

    const outcome = flow.nodes.find((node) => node.column === 'outcome');
    expect(outcome?.label).toBe('Credential Compromise');
    expect(flow.links.some((link) => link.target === 'outcome:Credential Compromise')).toBe(true);
    expect(flow.links.some((link) => link.source === 'outcome:Credential Compromise')).toBe(true);
  });

  it('should split techniques in proportion to persisted exposure', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });

    const techA = flow.nodes.find((node) => node.id === 'technique:tech-a');
    const techB = flow.nodes.find((node) => node.id === 'technique:tech-b');
    expect(techA?.value).toBeCloseTo(750, 6);
    expect(techB?.value).toBeCloseTo(250, 6);
  });

  it('should label techniques with their external id and name', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });

    expect(flow.nodes.find((node) => node.id === 'technique:tech-a')?.label).toBe('T1078 Valid Accounts');
  });

  it('should route the null group key to the unattributed bucket', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });

    const unattributed = flow.nodes.find((node) => node.id === UNATTRIBUTED_ACTOR_ID);
    expect(unattributed?.value).toBeCloseTo(400, 6);
    expect(unattributed?.residualKind).toBe('unattributed-actors');
  });

  it('should attribute a run with no group rows entirely to the unattributed bucket', () => {
    const flow = buildExposureFlow([scenario({ groups: [] })], { techniqueLabels: labels });

    expect(flow.nodes.find((node) => node.id === UNATTRIBUTED_ACTOR_ID)?.value).toBeCloseTo(1000, 6);
    expect(columnTotal(flow, 'actor')).toBeCloseTo(1000, 6);
  });

  it('should renormalise group shares that do not sum to one', () => {
    const flow = buildExposureFlow([scenario({
      groups: [{ key: 'g1', name: 'A', share: 0.3 }, { key: 'g2', name: 'B', share: 0.3 }],
    })], { techniqueLabels: labels });

    expect(columnTotal(flow, 'actor')).toBeCloseTo(1000, 6);
    expect(flow.nodes.find((node) => node.id === 'actor:g1')?.value).toBeCloseTo(500, 6);
  });

  it('should merge the rows of one actor class across scenarios into one unlinked node', () => {
    const classRow = (key: string) => ({ key, name: null, share: 1, actorClass: 'state_sponsored' });
    const flow = buildExposureFlow([
      scenario({ groups: [classRow('run-1-key')] }),
      scenario({ scenarioId: 's2', ale: 500, groups: [classRow('run-2-key')] }),
    ], { techniqueLabels: labels });

    const actors = flow.nodes.filter((node) => node.column === 'actor');
    expect(actors).toHaveLength(1);
    expect(actors[0]).toMatchObject({ id: 'actor:class:state_sponsored', actorClass: 'state_sponsored', entityId: null, label: '' });
    expect(actors[0].value).toBeCloseTo(1500, 6);
  });

  it('should route scenarios without loss estimates to a visible unallocated driver', () => {
    const flow = buildExposureFlow([scenario({ driverExpectations: [] })], { techniqueLabels: labels });

    expect(flow.unallocatedScenarioCount).toBe(1);
    expect(flow.nodes.find((node) => node.id === UNALLOCATED_DRIVER_ID)?.value).toBeCloseTo(1000, 6);
    expect(columnTotal(flow, 'driver')).toBeCloseTo(1000, 6);
  });

  it('should route scenarios with zero total exposure to their own unattributed bucket', () => {
    const flow = buildExposureFlow([scenario({
      techniques: [{ techniqueId: 'tech-a', value: 0 }],
    })], { techniqueLabels: labels });

    const unattributed = flow.nodes.find((node) => node.id === UNATTRIBUTED_TECHNIQUE_ID);
    expect(unattributed?.value).toBeCloseTo(1000, 6);
    expect(unattributed?.residualKind).toBe('unattributed-techniques');
    expect(columnTotal(flow, 'technique')).toBeCloseTo(1000, 6);
    // Not the folded tail: that node would carry a folded count and be labelled with it.
    expect(flow.nodes.some((node) => node.id === TECHNIQUE_TAIL_ID)).toBe(false);
  });

  it('should keep the unattributed technique bucket out of the folded tail', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      techniqueId: `tech-${index}`,
      value: 10 - index,
    }));
    const flow = buildExposureFlow([
      scenario({ techniques: many }),
      scenario({ scenarioId: 's2', techniques: [{ techniqueId: 'tech-a', value: 0 }] }),
    ], { techniqueLabels: labels, maxTechniques: 3 });

    expect(flow.nodes.find((node) => node.id === UNATTRIBUTED_TECHNIQUE_ID)?.value).toBeCloseTo(1000, 6);
    expect(flow.nodes.find((node) => node.id === TECHNIQUE_TAIL_ID)?.foldedCount).toBe(7);
    expect(columnTotal(flow, 'technique')).toBeCloseTo(2000, 6);
  });

  it('should exclude scenarios with a non-positive ale without breaking conservation', () => {
    const flow = buildExposureFlow([scenario(), scenario({ scenarioId: 's2', ale: 0 })], {
      techniqueLabels: labels,
    });

    expect(flow.total).toBe(1000);
    expect(columnTotal(flow, 'driver')).toBeCloseTo(1000, 6);
  });

  it('should fold the technique tail while conserving dollars', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      techniqueId: `tech-${index}`,
      value: 10 - index,
    }));
    const flow = buildExposureFlow([scenario({ techniques: many })], {
      techniqueLabels: labels,
      maxTechniques: 3,
    });

    const techniques = flow.nodes.filter((node) => node.column === 'technique');
    expect(techniques).toHaveLength(4);
    expect(techniques.find((node) => node.id === TECHNIQUE_TAIL_ID)?.foldedCount).toBe(7);
    expect(columnTotal(flow, 'technique')).toBeCloseTo(1000, 6);
  });

  it('should fold the driver tail while conserving dollars', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      driverId: `driver-${index}`,
      name: `Driver ${index}`,
      expected: 12 - index,
    }));
    const flow = buildExposureFlow([scenario({ driverExpectations: many })], {
      techniqueLabels: labels,
      maxDrivers: 4,
    });

    const drivers = flow.nodes.filter((node) => node.column === 'driver');
    expect(drivers).toHaveLength(5);
    expect(drivers.find((node) => node.id === DRIVER_TAIL_ID)?.foldedCount).toBe(8);
    expect(columnTotal(flow, 'driver')).toBeCloseTo(1000, 6);
  });

  it('should never fold the unattributed bucket into the actor tail', () => {
    const groups = [
      ...Array.from({ length: 8 }, (_, index) => ({ key: `g${index}`, name: `G${index}`, share: 0.1 })),
      { key: null, name: null, share: 0.2 },
    ];
    const flow = buildExposureFlow([scenario({ groups })], { techniqueLabels: labels, maxActors: 3 });

    expect(flow.nodes.some((node) => node.id === UNATTRIBUTED_ACTOR_ID)).toBe(true);
    expect(columnTotal(flow, 'actor')).toBeCloseTo(1000, 6);
  });

  it('should average mu across scenarios sharing a technique', () => {
    const flow = buildExposureFlow([
      scenario({ techniques: [{ techniqueId: 'tech-a', value: 1 }] }),
      scenario({ scenarioId: 's2', techniques: [{ techniqueId: 'tech-a', value: 1 }] }),
    ], { techniqueLabels: labels });

    expect(flow.nodes.find((node) => node.id === 'technique:tech-a')).toBeDefined();
  });

  it('should return an empty flow for no scenarios', () => {
    const flow = buildExposureFlow([], { techniqueLabels: labels });

    expect(flow.total).toBe(0);
    expect(flow.nodes).toHaveLength(0);
    expect(flow.links).toHaveLength(0);
  });
});

describe('layoutSankey', () => {
  it('should position every node inside the canvas', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });
    const { nodes, geometry } = layoutSankey(flow);

    expect(nodes.length).toBe(flow.nodes.length);
    for (const node of nodes) {
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.height).toBeLessThanOrEqual(geometry.height);
      expect(node.x + node.width).toBeLessThanOrEqual(geometry.width);
    }
  });

  it('should keep node heights proportional to value', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });
    const { nodes } = layoutSankey(flow);

    const techA = nodes.find((node) => node.id === 'technique:tech-a');
    const techB = nodes.find((node) => node.id === 'technique:tech-b');
    expect((techA?.height ?? 0) / (techB?.height ?? 1)).toBeCloseTo(3, 5);
  });

  it('should order residual buckets last within their column', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });
    const actors = layoutSankey(flow).nodes.filter((node) => node.column === 'actor');

    expect(actors.at(-1)?.id).toBe(UNATTRIBUTED_ACTOR_ID);
  });

  it('should emit a closed path per link', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });
    const { links } = layoutSankey(flow);

    expect(links.length).toBe(flow.links.length);
    for (const link of links) {
      expect(link.path.startsWith('M ')).toBe(true);
      expect(link.path.endsWith('Z')).toBe(true);
    }
  });

  it('should not stack ribbons beyond their source node height', () => {
    const flow = buildExposureFlow([
      scenario(),
      scenario({ scenarioId: 's2', outcomeName: 'Ransomware', ale: 400 }),
    ], { techniqueLabels: labels });
    const { nodes, links } = layoutSankey(flow);

    for (const node of nodes) {
      const outgoing = links.filter((link) => link.source === node.id);
      if (outgoing.length === 0) {
        continue;
      }
      const total = outgoing.reduce((sum, link) => sum + link.value, 0);
      expect(total).toBeLessThanOrEqual(node.value + 1e-6);
    }
  });

  it('should tolerate an empty flow without dividing by zero', () => {
    const layout = layoutSankey(buildExposureFlow([], { techniqueLabels: labels }));

    expect(layout.nodes).toHaveLength(0);
    expect(layout.links).toHaveLength(0);
  });
});

describe('reachableNodeIds', () => {
  it('should collect the full upstream and downstream path of a node', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });
    const reachable = reachableNodeIds(flow.links, 'technique:tech-a');

    expect(reachable.has('actor:group-1')).toBe(true);
    expect(reachable.has('outcome:Data Exfiltration')).toBe(true);
    expect(reachable.has('driver:driver-1')).toBe(true);
  });

  it('should exclude nodes on a disjoint path', () => {
    const flow = buildExposureFlow([
      scenario({ techniques: [{ techniqueId: 'tech-a', value: 1 }] }),
      scenario({
        scenarioId: 's2',
        outcomeName: 'Ransomware',
        groups: [{ key: 'group-2', name: 'LockBit', share: 1 }],
        techniques: [{ techniqueId: 'tech-b', value: 1 }],
        driverExpectations: [{ driverId: 'driver-3', name: 'Legal', expected: 10 }],
      }),
    ], { techniqueLabels: labels });

    const reachable = reachableNodeIds(flow.links, 'actor:group-2');
    expect(reachable.has('outcome:Ransomware')).toBe(true);
    expect(reachable.has('outcome:Data Exfiltration')).toBe(false);
  });
});

describe('node entity ids', () => {
  const entityId = (flow: ReturnType<typeof buildExposureFlow>, nodeId: string): string | null | undefined =>
    flow.nodes.find((node) => node.id === nodeId)?.entityId;

  it('should expose the entity behind every named node', () => {
    const flow = buildExposureFlow([scenario({ outcomeId: 'outcome-1' })], { techniqueLabels: labels });

    // A group key IS the threat analysis id, which is what the detail route takes.
    expect(entityId(flow, 'actor:group-1')).toBe('group-1');
    expect(entityId(flow, 'outcome:Data Exfiltration')).toBe('outcome-1');
    expect(entityId(flow, 'technique:tech-a')).toBe('tech-a');
    expect(entityId(flow, 'driver:driver-1')).toBe('driver-1');
  });

  it('should expose no entity for a residual bucket', () => {
    const flow = buildExposureFlow([
      scenario({ driverExpectations: [] }),
      ...Array.from({ length: 8 }, (_, index) => scenario({
        scenarioId: `tail-${index}`,
        groups: [{ key: `tail-group-${index}`, name: `Tail ${index}`, share: 1 }],
        techniques: [{ techniqueId: `tail-tech-${index}`, value: 1 }],
      })),
    ], { techniqueLabels: labels });

    expect(entityId(flow, UNATTRIBUTED_ACTOR_ID)).toBeNull();
    expect(entityId(flow, UNALLOCATED_DRIVER_ID)).toBeNull();
    expect(entityId(flow, ACTOR_TAIL_ID)).toBeNull();
    expect(entityId(flow, TECHNIQUE_TAIL_ID)).toBeNull();
  });

  it('should expose no entity for an outcome the caller could not resolve', () => {
    const flow = buildExposureFlow([scenario()], { techniqueLabels: labels });

    expect(entityId(flow, 'outcome:Data Exfiltration')).toBeNull();
  });
});

describe('groupMovesIntoTiers', () => {
  const move = (id: string, value: number) => ({
    techniqueId: id,
    externalId: id,
    name: id,
    aleReduction: value,
    scenarioCount: 1,
  });

  it('should keep moves within 2x in one tier', () => {
    const tiers = groupMovesIntoTiers([move('a', 1.9), move('b', 1.4)]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0].moves.map((m) => m.techniqueId)).toEqual(['a', 'b']);
    expect(tiers[0].spread).toBeCloseTo(1.9 / 1.4, 5);
  });

  it('should open a new tier at or beyond a 2x drop', () => {
    const tiers = groupMovesIntoTiers([move('a', 2), move('b', 1)]);

    expect(tiers).toHaveLength(2);
  });

  it('should measure spread against the tier head, not the previous move', () => {
    // 1.0 / 0.55 is under 2x, but 1.0 / 0.28 is not: the third move opens a tier.
    const tiers = groupMovesIntoTiers([move('a', 1), move('b', 0.55), move('c', 0.28)]);

    expect(tiers.map((tier) => tier.moves.length)).toEqual([2, 1]);
  });

  it('should drop non-positive reductions', () => {
    const tiers = groupMovesIntoTiers([move('a', 1), move('b', 0), move('c', -1)]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0].moves).toHaveLength(1);
  });

  it('should return no tiers for an empty list', () => {
    expect(groupMovesIntoTiers([])).toEqual([]);
  });
});

describe('projectMeanReduction', () => {
  it('should take the mean reduction straight off the mean total', () => {
    expect(projectMeanReduction(1_000, 250)).toBe(750);
  });

  it('should never project below zero', () => {
    expect(projectMeanReduction(1_000, 1_500)).toBe(0);
  });

  it('should leave the total alone when the move reduces nothing', () => {
    expect(projectMeanReduction(1_000, 0)).toBe(1_000);
    expect(projectMeanReduction(1_000, -10)).toBe(1_000);
  });
});
