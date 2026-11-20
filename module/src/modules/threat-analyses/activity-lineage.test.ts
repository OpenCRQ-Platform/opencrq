import { describe, expect, it } from 'vitest';
import type { ActivityAttributionEdge, ActivityLineage } from './activity-lineage';
import { DEFAULT_RELATION_CONFIDENCE } from './constants';
import { buildActivityLineage } from './activity-lineage';

const GATE = 60;

const edge = (values: Partial<ActivityAttributionEdge>): ActivityAttributionEdge => ({
  sourceId: 'campaign-1',
  sourceEntityType: 'campaign',
  targetStixId: 'intrusion-set--1',
  targetId: 'intrusion-set-1',
  confidence: 80,
  ...values,
});

const campaignTo = (sourceId: string, targets: Array<string>, values: Partial<ActivityAttributionEdge> = {}) =>
  targets.map((target) => edge({ sourceId, targetStixId: `stix--${target}`, targetId: target, ...values }));

const chain = (ids: Array<string>): Array<ActivityAttributionEdge> =>
  ids.slice(0, -1).map((id, index) => edge({
    sourceId: id,
    sourceEntityType: 'intrusion-set',
    targetStixId: `stix--${ids[index + 1]}`,
    targetId: ids[index + 1],
  }));

const sorted = (set: ReadonlySet<string> | undefined): Array<string> | undefined =>
  (set === undefined ? undefined : [...set].sort());

const descendantsOf = (lineage: ActivityLineage, id: string) => sorted(lineage.descendants.get(id));
const ancestorsOf = (lineage: ActivityLineage, id: string) => sorted(lineage.ancestors.get(id));

describe('buildActivityLineage', () => {
  it('gives an intrusion set the campaign attributed to it as a descendant', () => {
    const lineage = buildActivityLineage(campaignTo('campaign-1', ['set-1']), GATE);

    expect(descendantsOf(lineage, 'set-1')).toEqual(['campaign-1']);
    expect(ancestorsOf(lineage, 'campaign-1')).toEqual(['set-1']);
  });

  it('climbs campaign to intrusion set to threat actor without any descent', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1']),
      edge({
        sourceId: 'set-1',
        sourceEntityType: 'intrusion-set',
        targetStixId: 'stix--actor-1',
        targetId: 'actor-1',
      }),
    ], GATE);

    expect(descendantsOf(lineage, 'actor-1')).toEqual(['campaign-1', 'set-1']);
    expect(descendantsOf(lineage, 'set-1')).toEqual(['campaign-1']);
    expect(lineage.descendants.has('campaign-1')).toBe(false);
    expect(ancestorsOf(lineage, 'campaign-1')).toEqual(['actor-1', 'set-1']);
    expect(ancestorsOf(lineage, 'set-1')).toEqual(['actor-1']);
    expect(lineage.ancestors.has('actor-1')).toBe(false);
  });

  it('stops after the hop limit on a chain of four links', () => {
    const lineage = buildActivityLineage(chain(['a', 'b', 'c', 'd', 'e']), GATE);

    expect(ancestorsOf(lineage, 'a')).toEqual(['b', 'c', 'd']);
    expect(descendantsOf(lineage, 'e')).toEqual(['b', 'c', 'd']);
    expect(ancestorsOf(lineage, 'b')).toEqual(['c', 'd', 'e']);
    expect(descendantsOf(lineage, 'd')).toEqual(['a', 'b', 'c']);
  });

  it('keeps a cycle finite and never makes a threat its own descendant or ancestor', () => {
    const lineage = buildActivityLineage([...chain(['a', 'b']), ...chain(['b', 'a'])], GATE);

    expect(descendantsOf(lineage, 'a')).toEqual(['b']);
    expect(descendantsOf(lineage, 'b')).toEqual(['a']);
    expect(ancestorsOf(lineage, 'a')).toEqual(['b']);
    expect(ancestorsOf(lineage, 'b')).toEqual(['a']);
  });

  it('keeps a longer cycle finite and free of self membership', () => {
    const lineage = buildActivityLineage([...chain(['a', 'b', 'c']), ...chain(['c', 'a'])], GATE);

    expect(descendantsOf(lineage, 'a')).toEqual(['b', 'c']);
    expect(ancestorsOf(lineage, 'a')).toEqual(['b', 'c']);
  });

  it('drops a link under the gate and keeps one at the gate', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1'], { confidence: GATE - 1 }),
      ...campaignTo('campaign-2', ['set-2'], { confidence: GATE }),
    ], GATE);

    expect(lineage.descendants.has('set-1')).toBe(false);
    expect(lineage.ancestors.has('campaign-1')).toBe(false);
    expect(descendantsOf(lineage, 'set-2')).toEqual(['campaign-2']);
  });

  it('judges a link without confidence at the default relation confidence', () => {
    const edges = campaignTo('campaign-1', ['set-1'], { confidence: null });

    expect(descendantsOf(buildActivityLineage(edges, DEFAULT_RELATION_CONFIDENCE), 'set-1')).toEqual(['campaign-1']);
    expect(buildActivityLineage(edges, DEFAULT_RELATION_CONFIDENCE + 1).descendants.has('set-1')).toBe(false);
  });

  it('gates every hop of a chain', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1']),
      edge({
        sourceId: 'set-1',
        sourceEntityType: 'intrusion-set',
        targetStixId: 'stix--actor-1',
        targetId: 'actor-1',
        confidence: GATE - 1,
      }),
    ], GATE);

    expect(descendantsOf(lineage, 'set-1')).toEqual(['campaign-1']);
    expect(lineage.descendants.has('actor-1')).toBe(false);
  });

  it('lets a campaign with three targets climb to all three', () => {
    const lineage = buildActivityLineage(campaignTo('campaign-1', ['set-1', 'set-2', 'set-3']), GATE);

    expect(ancestorsOf(lineage, 'campaign-1')).toEqual(['set-1', 'set-2', 'set-3']);
    expect(descendantsOf(lineage, 'set-3')).toEqual(['campaign-1']);
  });

  it('lets a campaign with four distinct targets, one not ingested, climb to none', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1', 'set-2', 'set-3']),
      edge({ sourceId: 'campaign-1', targetStixId: 'stix--unknown', targetId: null }),
    ], GATE);

    expect(lineage.ancestors.size).toBe(0);
    expect(lineage.descendants.size).toBe(0);
  });

  it('counts a fourth target under the gate, so the campaign climbs to none', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1', 'set-2', 'set-3']),
      ...campaignTo('campaign-1', ['set-4'], { confidence: GATE - 1 }),
    ], GATE);

    expect(lineage.ancestors.size).toBe(0);
    expect(lineage.descendants.size).toBe(0);
  });

  it('counts two links to the same target once', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1', 'set-2', 'set-3']),
      ...campaignTo('campaign-1', ['set-3']),
    ], GATE);

    expect(ancestorsOf(lineage, 'campaign-1')).toEqual(['set-1', 'set-2', 'set-3']);
  });

  it('keeps a capped campaign from dating anything while another one still does', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1', 'set-2', 'set-3', 'set-4']),
      ...campaignTo('campaign-2', ['set-1']),
    ], GATE);

    expect(descendantsOf(lineage, 'set-1')).toEqual(['campaign-2']);
    expect(lineage.descendants.has('set-4')).toBe(false);
    expect(lineage.ancestors.has('campaign-1')).toBe(false);
  });

  it('lets an intrusion set with four targets climb to all four', () => {
    const lineage = buildActivityLineage(
      campaignTo('set-1', ['actor-1', 'actor-2', 'actor-3', 'actor-4'], { sourceEntityType: 'intrusion-set' }),
      GATE,
    );

    expect(ancestorsOf(lineage, 'set-1')).toEqual(['actor-1', 'actor-2', 'actor-3', 'actor-4']);
  });

  it('propagates nothing to a target that is not ingested', () => {
    const lineage = buildActivityLineage([edge({ targetId: null })], GATE);

    expect(lineage.ancestors.size).toBe(0);
    expect(lineage.descendants.size).toBe(0);
  });

  it('propagates nothing through a link to itself', () => {
    const lineage = buildActivityLineage(campaignTo('campaign-1', ['campaign-1']), GATE);

    expect(lineage.ancestors.size).toBe(0);
    expect(lineage.descendants.size).toBe(0);
  });

  it('keeps the two maps symmetric', () => {
    const lineage = buildActivityLineage([
      ...campaignTo('campaign-1', ['set-1', 'set-2']),
      ...chain(['set-1', 'actor-1', 'actor-2']),
      ...chain(['actor-2', 'set-1']),
    ], GATE);

    for (const [parent, children] of lineage.descendants) {
      for (const child of children) {
        expect(lineage.ancestors.get(child)?.has(parent)).toBe(true);
      }
    }
    for (const [child, parents] of lineage.ancestors) {
      for (const parent of parents) {
        expect(lineage.descendants.get(parent)?.has(child)).toBe(true);
      }
    }
  });
});
