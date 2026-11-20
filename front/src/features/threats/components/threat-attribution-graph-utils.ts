import type { ThreatEntityType } from '@app/module/client';
import { compareText } from '@app/utils/text-fold';
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

/** Left to right: what a campaign is attributed to sits to its right. */
export const ATTRIBUTION_COLUMN_ORDER: ReadonlyArray<ThreatEntityType> = ['campaign', 'intrusion-set', 'threat-actor'];

/** Past this many threats of one type beside the current one, the column keeps one fewer and folds the rest. */
export const MAX_COLUMN_THREATS = 6;

/** The current threat's halo is always drawn, so its links and labels stop short of it. */
export const MARKED_REACH = NODE_RADIUS + HALO_GAP + HALO_WIDTH / 2;
const HALO_EDGE = NODE_RADIUS + HALO_GAP + HALO_WIDTH;

/**
 * Graph units between two rows of a column: at the smallest zoom, where a caption stops shrinking
 * and grows in graph units, the current threat's caption still ends short of the halo below it.
 */
export const ATTRIBUTION_ROW_GAP = Math.ceil(MARKED_REACH + LABEL_OFFSET + CAPTION_HEIGHT * (MIN_TEXT_SCALE / MIN_ZOOM) + HALO_EDGE);

export interface AttributionGraphNode {
  /** The threat's own id, or the fold's id, which no threat id can take. */
  id: string,
  kind: 'threat' | 'fold',
  /** The empty string on a fold, whose name is the count it stands for. */
  name: string,
  entityType: ThreatEntityType,
  isCurrent: boolean,
  /** How many threats a fold stands for, 0 on a threat. */
  foldedCount: number,
  level: number,
  pinnedY: number,
}

export interface AttributionGraphLink {
  id: string,
  /** The threat attributed, which the arrow leaves. */
  source: string,
  /** The threat it is attributed to, which the arrow points at. */
  target: string,
  /** The links of one column running the same way around the current threat share one bundle, and one pill. */
  bundle: string,
}

export interface AttributionGraphColumn {
  entityType: ThreatEntityType,
  level: number,
  /** Every threat of the type, the current one and the folded ones included. */
  count: number,
}

export interface AttributionGraph {
  nodes: Array<AttributionGraphNode>,
  links: Array<AttributionGraphLink>,
  columns: Array<AttributionGraphColumn>,
}

export const foldNodeId = (entityType: ThreatEntityType): string => `fold:${entityType}`;

interface Attributed {
  threat: AttributionReference,
  /** The current threat is attributed to it. */
  isTarget: boolean,
  /** It is attributed to the current threat. */
  isSource: boolean,
}

/**
 * The current threat and the threats one attribution away from it, a star: `getDetail` returns no
 * attribution between two neighbours. One column per type present, in `ATTRIBUTION_COLUMN_ORDER`;
 * each column sorted by name and centred on the current threat's row, except the current threat's own,
 * which it heads. A column holding more than `MAX_COLUMN_THREATS` neighbours keeps the first ones by
 * name and folds the rest into one node, unless its type is in `expanded`.
 */
export const buildAttributionGraph = (
  current: AttributionReference,
  attributedTo: ReadonlyArray<AttributionReference>,
  attributedFrom: ReadonlyArray<AttributionReference>,
  expanded: ReadonlySet<ThreatEntityType>,
): AttributionGraph => {
  const neighbours = new Map<string, Attributed>();
  const record = (threat: AttributionReference, side: 'isTarget' | 'isSource'): void => {
    if (threat.id === current.id) {
      return;
    }
    const entry = neighbours.get(threat.id) ?? { threat, isTarget: false, isSource: false };
    entry[side] = true;
    neighbours.set(threat.id, entry);
  };
  attributedTo.forEach((threat) => record(threat, 'isTarget'));
  attributedFrom.forEach((threat) => record(threat, 'isSource'));

  const presentTypes = new Set([current.entityType, ...[...neighbours.values()].map(({ threat }) => threat.entityType)]);
  const columnTypes = ATTRIBUTION_COLUMN_ORDER.filter((type) => presentTypes.has(type));

  const nodes: Array<AttributionGraphNode> = [];
  const links: Array<AttributionGraphLink> = [];
  const columns: Array<AttributionGraphColumn> = [];

  const linkTo = (nodeId: string, entityType: ThreatEntityType, attributed: Pick<Attributed, 'isTarget' | 'isSource'>): void => {
    if (attributed.isTarget) {
      links.push({ id: `to:${nodeId}`, source: current.id, target: nodeId, bundle: `to:${entityType}` });
    }
    if (attributed.isSource) {
      links.push({ id: `from:${nodeId}`, source: nodeId, target: current.id, bundle: `from:${entityType}` });
    }
  };

  columnTypes.forEach((entityType, level) => {
    const ofType = [...neighbours.values()]
      .filter(({ threat }) => threat.entityType === entityType)
      .sort((a, b) => compareText(a.threat.name, b.threat.name) || compareText(a.threat.id, b.threat.id));
    const folds = !expanded.has(entityType) && ofType.length > MAX_COLUMN_THREATS;
    const shown = folds ? ofType.slice(0, MAX_COLUMN_THREATS - 1) : ofType;
    const folded = folds ? ofType.slice(MAX_COLUMN_THREATS - 1) : [];
    const holdsCurrent = entityType === current.entityType;
    const rowCount = shown.length + (folded.length > 0 ? 1 : 0);
    const rowY = holdsCurrent
      ? (row: number): number => (row + 1) * ATTRIBUTION_ROW_GAP
      : (row: number): number => (row - (rowCount - 1) / 2) * ATTRIBUTION_ROW_GAP;

    if (holdsCurrent) {
      nodes.push({ id: current.id, kind: 'threat', name: current.name, entityType, isCurrent: true, foldedCount: 0, level, pinnedY: 0 });
    }
    shown.forEach((attributed, row) => {
      const { threat } = attributed;
      nodes.push({ id: threat.id, kind: 'threat', name: threat.name, entityType, isCurrent: false, foldedCount: 0, level, pinnedY: rowY(row) });
      linkTo(threat.id, entityType, attributed);
    });
    if (folded.length > 0) {
      const id = foldNodeId(entityType);
      nodes.push({ id, kind: 'fold', name: '', entityType, isCurrent: false, foldedCount: folded.length, level, pinnedY: rowY(shown.length) });
      linkTo(id, entityType, {
        isTarget: folded.some((attributed) => attributed.isTarget),
        isSource: folded.some((attributed) => attributed.isSource),
      });
    }
    columns.push({ entityType, level, count: ofType.length + (holdsCurrent ? 1 : 0) });
  });

  return { nodes, links, columns };
};
