import type { ThreatEntityType } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { AttributionReference } from './threat-overview-utils';
import {
  CAPTION_HEIGHT,
  HALO_GAP,
  HALO_WIDTH,
  LABEL_OFFSET,
  MIN_TEXT_SCALE,
  MIN_ZOOM,
  NODE_RADIUS,
} from '../../../components/shared/column-graph-paint';
import { ATTRIBUTION_ROW_GAP, buildAttributionGraph, foldNodeId, MARKED_REACH } from './threat-attribution-graph-utils';

const APT28: AttributionReference = { id: 'apt28', name: 'APT28', entityType: 'intrusion-set' };
const GRU: AttributionReference = { id: 'gru', name: 'GRU Unit 26165', entityType: 'threat-actor' };
const UAC: AttributionReference = { id: 'uac', name: 'UAC-0063', entityType: 'intrusion-set' };

const campaign = (name: string): AttributionReference => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, entityType: 'campaign' });

const NONE = new Set<ThreatEntityType>();

describe('buildAttributionGraph', () => {
  it('puts each threat in its type column, campaigns, then intrusion sets, then actors', () => {
    const graph = buildAttributionGraph(APT28, [GRU], [campaign('Pawn Storm')], NONE);

    const level = (id: string): number | undefined => graph.nodes.find((node) => node.id === id)?.level;
    expect([level('pawn-storm'), level('apt28'), level('gru')]).toEqual([0, 1, 2]);
    expect(graph.columns.map((column) => [column.entityType, column.count])).toEqual([
      ['campaign', 1],
      ['intrusion-set', 1],
      ['threat-actor', 1],
    ]);
  });

  it('leaves out the columns no threat fills', () => {
    const graph = buildAttributionGraph(campaign('Pawn Storm'), [APT28], [], NONE);

    expect(graph.columns.map((column) => [column.entityType, column.level])).toEqual([['campaign', 0], ['intrusion-set', 1]]);
  });

  it('points every arrow from the threat attributed to the threat it is attributed to', () => {
    const graph = buildAttributionGraph(APT28, [GRU], [campaign('Pawn Storm')], NONE);

    expect(graph.links.map((link) => [link.source, link.target])).toEqual([
      ['pawn-storm', 'apt28'],
      ['apt28', 'gru'],
    ]);
  });

  it('draws a threat attributed both ways once, with a link each way', () => {
    const graph = buildAttributionGraph(APT28, [GRU], [GRU], NONE);

    expect(graph.nodes.filter((node) => node.id === 'gru')).toHaveLength(1);
    expect(graph.links.map((link) => [link.source, link.target, link.bundle])).toEqual([
      ['apt28', 'gru', 'to:threat-actor'],
      ['gru', 'apt28', 'from:threat-actor'],
    ]);
  });

  it('sorts each column by name, centred on the current threat, which heads its own column', () => {
    const graph = buildAttributionGraph(APT28, [], [campaign('Steal-It'), campaign('Dear Joohn'), campaign('Komplex'), UAC], NONE);

    const column = (level: number) => graph.nodes.filter((node) => node.level === level).map((node) => [node.name, node.pinnedY]);
    expect(column(0)).toEqual([
      ['Dear Joohn', -ATTRIBUTION_ROW_GAP],
      ['Komplex', 0],
      ['Steal-It', ATTRIBUTION_ROW_GAP],
    ]);
    expect(column(1)).toEqual([['APT28', 0], ['UAC-0063', ATTRIBUTION_ROW_GAP]]);
  });

  it('keeps six threats of a column apart', () => {
    const campaigns = ['A', 'B', 'C', 'D', 'E', 'F'].map(campaign);
    const graph = buildAttributionGraph(APT28, [], campaigns, NONE);

    expect(graph.nodes.filter((node) => node.kind === 'fold')).toEqual([]);
    expect(graph.nodes.filter((node) => node.level === 0)).toHaveLength(6);
  });

  it('past six threats in a column, keeps the first five by name and folds the rest into one node', () => {
    const campaigns = ['G', 'C', 'A', 'L', 'E', 'B', 'D', 'K', 'F', 'H', 'I', 'J'].map(campaign);
    const graph = buildAttributionGraph(APT28, [], campaigns, NONE);

    const column = graph.nodes.filter((node) => node.level === 0);
    expect(column.map((node) => node.name)).toEqual(['A', 'B', 'C', 'D', 'E', '']);
    expect(column.at(-1)).toMatchObject({ id: foldNodeId('campaign'), kind: 'fold', foldedCount: 7 });
    expect(graph.links.find((link) => link.source === foldNodeId('campaign'))?.target).toBe('apt28');
    expect(graph.columns[0].count).toBe(12);
  });

  it('draws every threat of a column once its type is expanded', () => {
    const campaigns = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(campaign);
    const graph = buildAttributionGraph(APT28, [], campaigns, new Set<ThreatEntityType>(['campaign']));

    expect(graph.nodes.filter((node) => node.level === 0).map((node) => node.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('spaces the rows so a caption at the smallest zoom ends short of the halo of the node below', () => {
    const campaigns = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(campaign);
    const graph = buildAttributionGraph(APT28, [], [...campaigns, UAC], new Set<ThreatEntityType>(['campaign']));
    const captionHeight = CAPTION_HEIGHT * (MIN_TEXT_SCALE / MIN_ZOOM);
    const haloEdge = NODE_RADIUS + HALO_GAP + HALO_WIDTH;

    for (const level of [0, 1]) {
      const column = graph.nodes.filter((node) => node.level === level);
      column.slice(1).forEach((below, index) => {
        const above = column[index];
        const captionEnd = above.pinnedY + (above.isCurrent ? MARKED_REACH : NODE_RADIUS) + LABEL_OFFSET + captionHeight;
        expect(captionEnd).toBeLessThanOrEqual(below.pinnedY - haloEdge);
      });
    }
  });

  it('never draws the current threat as its own neighbour', () => {
    const graph = buildAttributionGraph(APT28, [APT28], [], NONE);

    expect(graph.nodes.map((node) => node.id)).toEqual(['apt28']);
    expect(graph.links).toEqual([]);
  });
});
