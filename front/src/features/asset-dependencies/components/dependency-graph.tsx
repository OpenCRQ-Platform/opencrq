import { plural, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { AssetCriticality, AssetRelationKind, SeverityBand } from '@app/module/client';
import type { Box, Curve } from '../../../components/shared/column-graph-geometry';
import type { ColumnGraphLinkTarget, ColumnGraphView, PlacedNode } from '../../../components/shared/column-graph';
import type {
  CategoryGlyph,
  DependencyFocus,
  DependencyGraphModel,
  DependencyGraphNode,
  DependencyGraphSelection,
  DrawnEdge,
  GraphGrammar,
  PrimaryNeighbour,
} from '../dependency-graph-utils';
import type { AssetRelationDirection } from '../../supporting-assets/asset-relations-utils';
import { postureSeverityBand } from '@app/module/client';
import { useTheme } from '../../../providers/theme-provider';
import { ColumnGraph } from '../../../components/shared/column-graph';
import { boxesClearOfEachOther, curveMidpoint, endTangent, startTangent, trimCurve } from '../../../components/shared/column-graph-geometry';
import {
  ARROW_LENGTH,
  GLYPH_SIZE,
  HALO_ALPHA,
  HALO_GAP,
  HALO_WIDTH,
  LABEL_OFFSET,
  LINK_COLOR_PROPERTY,
  LINK_INK_ALPHA,
  LINK_WIDTH,
  MARKED_HALO_ALPHA,
  MIN_TEXT_SCALE,
  NODE_RADIUS,
  paintArrowHead,
  paintHalo,
  paintNodeCaption,
  paintTintedDisc,
  readCanvasColor,
  SUBLABEL_TEXT,
  TINT_ALPHA,
} from '../../../components/shared/column-graph-paint';
import {
  AGGREGATE_GLYPH,
  ANTENNA_GLYPH,
  CROWN_GLYPH,
  INTERNET_GLYPH,
  LIFT_GLYPH,
  MUTUAL_GLYPH,
  paintGlyph,
  PRIMARY_ASSET_GLYPH,
  SHIELD_GLYPH,
} from '../dependency-graph-painter';
import {
  assetDomain,
  assetDomainColor,
  categoryGlyph,
  criticalityRingProperty,
  drawnEdges,
  edgeLift,
  findingPills,
  focusOnEdge,
  focusOnNode,
  isDirectedEdge,
  isMutualEdge,
  isSelectableEdge,
  isStoredLinkKind,
  isUnknownStrengthEdge,
  nodeNeighbours,
  nodePins,
  PRIMARY_LINK_COLOR_PROPERTY,
  primaryEdgeAlpha,
  primaryNeighbours,
  ringAlpha,
  UNKNOWN_STRENGTH_COLOR_PROPERTY,
} from '../dependency-graph-utils';
import { getLinkRoleLabel } from '../link-role-labels';
import { getLinkStrengthLabel } from '../link-strength-labels';
import { getAssetCategoryLabel, getAssetCriticalityLabel } from '../../../utils';
import { assetRelationGroupLine, assetRelationKindLabel, assetRelationSentence } from '../../supporting-assets/asset-relation-labels';
import { findingCountLabel, postureScoreLabel } from './asset-findings-labels';

/** Graph units, not pixels: the view is fitted to the drawing, so these only set relative sizes. */
const PRIMARY_HALF_SIZE = 23;
const PRIMARY_CORNER = 9;
const INTERNET_RADIUS = 30;
/** In screen pixels, like the role pills, so the pins and the finding pills read at any zoom. */
const PIN_SIZE_PX = 15;
const PIN_GAP_PX = 4;
const PIN_OFFSET_PX = 5;
const PIN_STROKE = 2.25;
const FINDING_PILL_HEIGHT_PX = 14;
const FINDING_PILL_MIN_WIDTH_PX = 16;
const FINDING_PILL_PADDING_PX = 4;
const FINDING_PILL_TEXT_PX = 10;
const FINDING_PILL_GAP_PX = 2;
const FINDING_PILL_INSET_X = 12;
const FINDING_PILL_TOP = 24;
/** The marked asset's halo is always drawn, so its links and labels stop short of it. */
const MARKED_REACH = NODE_RADIUS + HALO_GAP + HALO_WIDTH / 2;
const FOCUSED_LINK_WIDTH = 2.2;
const SELECTED_LINK_WIDTH = 2.8;
const PRIMARY_LINK_WIDTH_FACTOR = 1.5;
/** In screen pixels, like the labels, so a pill stays a click target at any zoom. */
const PILL_TEXT_PX = 10;
const PILL_HEIGHT_PX = 18;
const PILL_PADDING_PX = 8;
const MUTUAL_PILL_RADIUS_PX = 10;
const MUTUAL_GLYPH_PX = 12;
const PILL_GAP_PX = 4;
const PILL_LIFT_GAP_PX = 6;
const PILL_LIFT_GLYPH_PX = 10;
/** Graph units two nodes of one column are kept apart by, sized for a node and its two label lines. */
const COLUMN_GAP = 120;
/** The same, with the criticality pill as a third line under the labels. */
const COLUMN_GAP_WITH_CRITICALITY = 145;
const CRITICALITY_PILL_GAP = 4;
const CRITICALITY_PILL_HEIGHT = 16;
const CRITICALITY_PILL_PADDING = 6;
const CRITICALITY_DOT_RADIUS = 3;
const CRITICALITY_TEXT = 10;
const LIFT_GLYPH_SIZE = 10;
const LIFT_GLYPH_STROKE = 3;
/** The pill's wash under its band's ink, as the criticality chip on the asset's header reads. */
const CRITICALITY_WASH_ALPHA = 0.2;

interface DependencyGraphProps {
  model: DependencyGraphModel,
  selection: DependencyGraphSelection | null,
  onSelect: (selection: DependencyGraphSelection | null) => void,
  /** What an aggregate node's expand link does: the assets behind it only exist one depth further. */
  onExpand: () => void,
  canExpand: boolean,
  /** Bumped by the recentre button; every new value refits the view to the whole drawing. */
  fitSignal: number,
  isFullScreen: boolean,
  onToggleFullScreen: () => void,
  /** Left out when the container sizes the graph itself, which is what full screen does. */
  height?: number,
  /** The supporting asset the page is about, haloed and reachable from the controls, since the walk can put it in any column. */
  markedNodeId?: string,
  grammar?: GraphGrammar,
}

/**
 * Everything the canvas paints from the node objects, not the shape alone: a refetch that renames an
 * asset or moves its posture band leaves the ids untouched, and a signature made of those would
 * keep the old ink. A link's roles are read from the model at paint time instead, so saving them
 * repaints the pill without laying the graph out again.
 *
 * Both are sorted: the payload's rows come in no stated order, and an updated row can move in it.
 */
const graphSignature = (model: DependencyGraphModel): string => [
  ...model.nodes.map((node) => [
    node.id, node.kind, node.label, node.hiddenProviderCount, node.foldedBy ?? '',
    node.asset?.categoryId ?? '', node.asset?.criticality ?? '', node.asset?.postureScore ?? '',
    node.asset?.criticalFindingCount ?? '', node.asset?.highFindingCount ?? '', node.asset?.criticalityLift?.fromAssetId ?? '',
  ].join(':')),
  ...model.links.map((link) => `${link.id}:${link.kind}`),
].sort().join('|');

/** Ids alone: what the simulation has to lay out again, as opposed to what it only has to repaint. */
const shapeSignature = (model: DependencyGraphModel): string =>
  `${model.nodes.map((node) => node.id).sort().join()}|${model.links.map((link) => link.id).sort().join()}`;

/** An aggregate node's name is the count it stands for, which no plural of the model can hold. */
const nodeName = (node: DependencyGraphNode): string => {
  if (node.kind !== 'aggregate') {
    return node.label;
  }
  return node.primaryFoldSide === undefined
    ? plural(node.hiddenProviderCount, { one: '# asset', other: '# assets' })
    : plural(node.hiddenProviderCount, { one: '# primary asset', other: '# primary assets' });
};

const primaryNeighbourName = (neighbour: PrimaryNeighbour): string => {
  const name = nodeName(neighbour.node);
  if (neighbour.strength === null) {
    return name;
  }
  const strength = getLinkStrengthLabel(neighbour.strength);
  return t`${name} (${strength})`;
};

/**
 * What the canvas draws, said in words. A canvas has no nodes to focus and no relations to announce,
 * so the same selection is driven from a list of buttons that only a keyboard or a reader reaches.
 */
const nodeSentence = (node: DependencyGraphNode, model: DependencyGraphModel, grammar: GraphGrammar): string => {
  const { providers, dependents } = nodeNeighbours(model, node.id);
  const name = nodeName(node);
  const { asset } = node;
  const said = [
    asset === null ? name : [
      name,
      getAssetCriticalityLabel(asset.criticality),
      ...(asset.postureScore === null ? [] : [postureScoreLabel(asset.postureScore)]),
      ...findingPills(asset).map(findingCountLabel),
    ].join(', '),
  ];
  if (grammar === 'access_relations') {
    return `${[...said, ...relationLines(node, model)].join('. ')}.`;
  }
  const { dependsOn, dependedOnBy } = primaryNeighbours(model, node.id);
  if (dependsOn.length > 0) {
    const named = dependsOn.map(primaryNeighbourName).join(', ');
    said.push(t`Depends on ${named}`);
  }
  if (dependedOnBy.length > 0) {
    const named = dependedOnBy.map(primaryNeighbourName).join(', ');
    said.push(t`Depended on by ${named}`);
  }
  if (providers.length > 0) {
    const named = providers.map(nodeName).join(', ');
    said.push(t`Supported by ${named}`);
  }
  if (dependents.length > 0) {
    const named = dependents.map(nodeName).join(', ');
    said.push(t`Supporting ${named}`);
  }
  return `${said.join('. ')}.`;
};

const relationLines = (node: DependencyGraphNode, model: DependencyGraphModel): Array<string> => {
  const byId = new Map(model.nodes.map((candidate) => [candidate.id, candidate]));
  const groups = new Map<string, { kind: AssetRelationKind, direction: AssetRelationDirection, names: Array<string> }>();
  for (const link of model.links) {
    const direction = link.source === node.id ? 'outgoing' : link.target === node.id ? 'incoming' : null;
    const other = byId.get(direction === 'outgoing' ? link.target : link.source);
    if (direction === null || other === undefined || !isStoredLinkKind(link.kind) || link.kind === 'depends_on') {
      continue;
    }
    const key = `${link.kind}:${direction}`;
    const group = groups.get(key) ?? { kind: link.kind, direction, names: [] };
    group.names.push(nodeName(other));
    groups.set(key, group);
  }
  return [...groups.values()].map(({ kind, direction, names }) => assetRelationGroupLine(kind, direction, names.join(', ')));
};

/** The canvas has no edges to focus either, so each selectable one is a button of the same list. */
const edgeSentence = (edge: DrawnEdge, model: DependencyGraphModel): string => {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  return edge.links.map((link) => {
    if (link.kind !== 'depends_on' && isStoredLinkKind(link.kind)) {
      const lift = edgeLift(byId, link);
      return assetRelationSentence(
        link.kind,
        byId.get(link.target)?.label ?? '',
        byId.get(link.source)?.label ?? '',
        lift === null ? null : getAssetCriticalityLabel(lift),
      );
    }
    const supported = byId.get(link.source)?.label ?? '';
    const supporting = byId.get(link.target)?.label ?? '';
    const said = t`${supporting} supports ${supported}`;
    if (link.strength !== undefined) {
      const strength = getLinkStrengthLabel(link.strength);
      return `${said}: ${strength}.`;
    }
    if (link.roles === null) {
      return `${said}.`;
    }
    const roles = link.roles.map(getLinkRoleLabel).join(', ');
    return `${said}: ${roles}.`;
  }).join(' ');
};

/** How far a node's ink reaches from its centre, which is where a line touching it must stop. */
const nodeReach = (node: DependencyGraphNode, markedNodeId: string | undefined): number => {
  if (node.kind === 'primary') {
    return node.id === markedNodeId ? PRIMARY_HALF_SIZE + HALO_GAP + HALO_WIDTH / 2 : PRIMARY_HALF_SIZE;
  }
  if (node.kind === 'internet') {
    return INTERNET_RADIUS;
  }
  return node.id === markedNodeId ? MARKED_REACH : NODE_RADIUS;
};

/** What is stroked: the curve short of each end that carries a head, which the pill has to sit on. */
const lineOf = (curve: Curve, edge: DrawnEdge): Curve =>
  trimCurve(curve, ARROW_LENGTH, isMutualEdge(edge) ? ARROW_LENGTH : 0);

/** A relation's pill names its kind and, on the edge an asset's band came from, that band. */
interface PillContent {
  text: string,
  lift: AssetCriticality | null,
}

const pillLabel = (edge: DrawnEdge): string | null => {
  const [link] = edge.links;
  if (link.roles === null || link.roles.length === 0) {
    return null;
  }
  const [first] = link.roles;
  const more = link.roles.length - 1;
  return more > 0 ? `${getLinkRoleLabel(first)} +${more}` : getLinkRoleLabel(first);
};

const pillContent = (edge: DrawnEdge, nodesById: ReadonlyMap<string, DependencyGraphNode>): PillContent | null => {
  const [link] = edge.links;
  if (link.kind !== 'depends_on' && isStoredLinkKind(link.kind)) {
    return { text: assetRelationKindLabel(link.kind), lift: edgeLift(nodesById, link) };
  }
  const label = pillLabel(edge);
  return label === null ? null : { text: label, lift: null };
};

const edgeRing = (focus: DependencyFocus, edge: DrawnEdge): number | undefined => {
  const rings = edge.links.flatMap((link) => {
    const ring = focus.linkRings.get(link.id);
    return ring === undefined ? [] : [ring];
  });
  return rings.length === 0 ? undefined : Math.min(...rings);
};

export const DependencyGraph: FunctionComponent<DependencyGraphProps> = ({
  model,
  selection,
  onSelect,
  onExpand,
  canExpand,
  fitSignal,
  isFullScreen,
  onToggleFullScreen,
  height,
  markedNodeId,
  grammar,
}) => {
  const drawsCriticality = grammar === 'access_relations';
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const columnGap = drawsCriticality ? COLUMN_GAP_WITH_CRITICALITY : COLUMN_GAP;
  // Subscribed for the palette below, which is read from the document's own custom properties, and
  // for the tint, whose opacity is the one value that cannot be read from a token.
  const { effectiveTheme } = useTheme();

  /** Canvas takes resolved colours, and the feedback families repoint between the two themes. */
  const palette = {
    surface: readCanvasColor('--fds-bg-elevation-default-layer-1', '#ffffff'),
    glyph: readCanvasColor('--fds-text-default-secondary', '#52514e'),
    label: readCanvasColor('--fds-text-default-primary', '#0b0b0b'),
    link: readCanvasColor('--fds-border-elevation-subtle-soft', '#cfcdc5'),
    accent: readCanvasColor('--fds-color-filigran-brand-primary', '#0079a8'),
    edge: readCanvasColor(LINK_COLOR_PROPERTY, '#0079a8'),
    primaryEdge: readCanvasColor(PRIMARY_LINK_COLOR_PROPERTY, '#1fa9a9'),
    unknownStrength: readCanvasColor(UNKNOWN_STRENGTH_COLOR_PROPERTY, '#7a7c85'),
    /** The neutral chip's own wash, laid over the surface like the tint. */
    pill: readCanvasColor('--fds-color-feedback-neutral-secondary', '#62636a'),
    icon: readCanvasColor('--fds-icon-default', '#0b0b0b'),
    pillInk: readCanvasColor('--fds-text-negative-primary', '#18191b'),
    severity: {
      critical: readCanvasColor('--fds-color-feedback-error-primary', '#e51e10'),
      high: readCanvasColor('--fds-color-feedback-warning-primary', '#e6700f'),
      medium: readCanvasColor('--fds-color-feedback-alert-primary', '#b8870a'),
      low: readCanvasColor('--fds-color-feedback-success-primary', '#17ab1f'),
    } satisfies Record<SeverityBand, string>,
    criticality: {
      very_high: readCanvasColor(criticalityRingProperty('very_high'), '#e51e10'),
      high: readCanvasColor(criticalityRingProperty('high'), '#e6700f'),
      medium: readCanvasColor(criticalityRingProperty('medium'), '#b8870a'),
      low: readCanvasColor(criticalityRingProperty('low'), '#17ab1f'),
      unknown: readCanvasColor(criticalityRingProperty('unknown'), '#7a7c85'),
    } satisfies Record<AssetCriticality, string>,
  };

  const selectedId = selection?.kind === 'node' ? selection.id : null;
  const edges = drawnEdges(model);
  const selectedEdge = selection?.kind === 'edge' ? edges.find((edge) => edge.id === selection.id) : undefined;

  const nodeFocus = selectedId === null ? null : focusOnNode(model, selectedId);
  const focus = selectedEdge === undefined ? nodeFocus : focusOnEdge(selectedEdge);

  const paintSelectionHalo = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, square: boolean): void =>
    paintHalo(ctx, x, y, radius, square ? PRIMARY_CORNER : null, { color: palette.accent, alpha: HALO_ALPHA[effectiveTheme] });

  /** Only a fold past the depth hides assets one level deeper; a fold past the width stays one at any depth. */
  const expandsOnClick = (node: DependencyGraphNode): boolean => canExpand && node.foldedBy !== 'width';

  /** The class of node in words, which is what the glyph alone never says. */
  const nodeTypeLabel = (node: DependencyGraphNode): string => {
    if (node.kind === 'primary') {
      return t`Primary asset`;
    }
    if (node.kind === 'internet') {
      return t`Not inventoried`;
    }
    if (node.kind === 'aggregate') {
      if (node.foldedBy === 'width') {
        return t`Too many to draw`;
      }
      return canExpand ? t`Click to expand` : t`Beyond the depth`;
    }
    return node.asset === null ? '' : getAssetCategoryLabel(node.asset.categoryId);
  };

  const paintLabels = (node: DependencyGraphNode, ctx: CanvasRenderingContext2D, x: number, y: number, globalScale: number): void => {
    const selected = selectedId === node.id;
    const unit = Math.max(1, MIN_TEXT_SCALE / globalScale);
    const top = y + nodeReach(node, markedNodeId) + LABEL_OFFSET;
    const typeTop = paintNodeCaption(ctx, x, top, unit, {
      name: nodeName(node),
      weight: selected || node.id === markedNodeId ? '600' : '500',
      nameInk: selected ? palette.surface : palette.label,
      highlight: selected ? palette.accent : null,
      type: nodeTypeLabel(node),
      typeInk: node.kind === 'aggregate' && expandsOnClick(node) ? palette.accent : palette.glyph,
    });
    if (typeTop !== null && drawsCriticality && node.asset !== null) {
      const lifted = node.asset.criticalityLift !== undefined && node.asset.criticalityLift !== null;
      paintCriticalityPill(ctx, x, typeTop + (SUBLABEL_TEXT + CRITICALITY_PILL_GAP) * unit, unit, node.asset.criticality, lifted);
    }
  };

  const paintCriticalityPill = (
    ctx: CanvasRenderingContext2D,
    x: number,
    top: number,
    unit: number,
    criticality: AssetCriticality,
    lifted: boolean,
  ): void => {
    const ink = palette.criticality[criticality];
    const label = getAssetCriticalityLabel(criticality);
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `600 ${CRITICALITY_TEXT * unit}px sans-serif`;
    const padding = CRITICALITY_PILL_PADDING * unit;
    const dot = CRITICALITY_DOT_RADIUS * 2 * unit;
    const gap = 4 * unit;
    const glyph = LIFT_GLYPH_SIZE * unit;
    const labelWidth = ctx.measureText(label).width;
    const width = padding * 2 + dot + gap + labelWidth + (lifted ? gap + glyph : 0);
    const pillHeight = CRITICALITY_PILL_HEIGHT * unit;
    const left = x - width / 2;
    const middle = top + pillHeight / 2;
    const opacity = ctx.globalAlpha;
    ctx.beginPath();
    ctx.roundRect(left, top, width, pillHeight, pillHeight / 2);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.globalAlpha = opacity * CRITICALITY_WASH_ALPHA;
    ctx.fill();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(left + padding + dot / 2, middle, dot / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const textLeft = left + padding + dot + gap;
    ctx.fillText(label, textLeft, middle);
    if (lifted) {
      paintGlyph(ctx, LIFT_GLYPH, textLeft + labelWidth + gap + glyph / 2, middle, glyph, ink, LIFT_GLYPH_STROKE);
    }
  };

  const paintPins = (node: DependencyGraphNode, ctx: CanvasRenderingContext2D, x: number, y: number, globalScale: number): void => {
    const pins = node.asset === null ? [] : nodePins(node.asset, node.impact);
    if (pins.length === 0) {
      return;
    }
    const screenPx = 1 / globalScale;
    const pinSize = PIN_SIZE_PX * screenPx;
    const gap = PIN_GAP_PX * screenPx;
    const rowWidth = pins.length * pinSize + (pins.length - 1) * gap;
    const centreY = y - nodeReach(node, markedNodeId) - PIN_OFFSET_PX * screenPx - pinSize / 2;
    pins.forEach((pin, index) => {
      const centreX = x - rowWidth / 2 + index * (pinSize + gap) + pinSize / 2;
      if (pin.kind === 'crown') {
        paintGlyph(ctx, CROWN_GLYPH, centreX, centreY, pinSize, palette.severity[pin.band], PIN_STROKE);
      } else if (pin.kind === 'shield') {
        paintGlyph(ctx, SHIELD_GLYPH, centreX, centreY, pinSize, palette.severity[postureSeverityBand(pin.band)], PIN_STROKE);
      } else {
        paintGlyph(ctx, ANTENNA_GLYPH, centreX, centreY, pinSize, palette.icon, PIN_STROKE);
      }
    });
  };

  const paintFindingPills = (node: DependencyGraphNode, ctx: CanvasRenderingContext2D, x: number, y: number, globalScale: number): void => {
    const pills = node.asset === null ? [] : findingPills(node.asset);
    if (pills.length === 0) {
      return;
    }
    const screenPx = 1 / globalScale;
    const pillHeight = FINDING_PILL_HEIGHT_PX * screenPx;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `700 ${FINDING_PILL_TEXT_PX * screenPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let top = y - FINDING_PILL_TOP;
    for (const pill of pills) {
      const label = String(pill.count);
      const width = Math.max(FINDING_PILL_MIN_WIDTH_PX * screenPx, ctx.measureText(label).width + FINDING_PILL_PADDING_PX * 2 * screenPx);
      const left = x - FINDING_PILL_INSET_X - width;
      ctx.beginPath();
      ctx.roundRect(left, top, width, pillHeight, pillHeight / 2);
      ctx.fillStyle = palette.severity[pill.band];
      ctx.fill();
      ctx.fillStyle = palette.pillInk;
      ctx.fillText(label, left + width / 2, top + pillHeight / 2);
      top += pillHeight + FINDING_PILL_GAP_PX * screenPx;
    }
  };

  const paintNode = (node: PlacedNode<DependencyGraphNode>, ctx: CanvasRenderingContext2D, globalScale: number): void => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const selected = selectedId === node.id;
    ctx.save();
    ctx.globalAlpha = focus === null ? 1 : ringAlpha(focus.nodeRings.get(node.id));

    if (node.kind === 'primary') {
      if (selected) {
        paintSelectionHalo(ctx, x, y, PRIMARY_HALF_SIZE, true);
      } else if (node.id === markedNodeId) {
        paintHalo(ctx, x, y, PRIMARY_HALF_SIZE, PRIMARY_CORNER, { color: palette.label, alpha: MARKED_HALO_ALPHA });
      }
      ctx.beginPath();
      ctx.roundRect(x - PRIMARY_HALF_SIZE, y - PRIMARY_HALF_SIZE, PRIMARY_HALF_SIZE * 2, PRIMARY_HALF_SIZE * 2, PRIMARY_CORNER);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.accent;
      ctx.stroke();
      paintGlyph(ctx, PRIMARY_ASSET_GLYPH, x, y, GLYPH_SIZE + 2, palette.accent);
    } else if (node.kind === 'internet') {
      if (selected) {
        paintSelectionHalo(ctx, x, y, INTERNET_RADIUS, false);
      }
      ctx.beginPath();
      ctx.arc(x, y, INTERNET_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.glyph;
      ctx.stroke();
      ctx.setLineDash([]);
      paintGlyph(ctx, INTERNET_GLYPH, x, y, GLYPH_SIZE + 14, palette.glyph);
    } else if (node.kind === 'aggregate') {
      ctx.beginPath();
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.link;
      ctx.stroke();
      ctx.setLineDash([]);
      paintGlyph(ctx, AGGREGATE_GLYPH, x, y, GLYPH_SIZE, palette.glyph);
    } else {
      if (selected) {
        paintSelectionHalo(ctx, x, y, NODE_RADIUS, false);
      } else if (node.id === markedNodeId) {
        paintHalo(ctx, x, y, NODE_RADIUS, null, { color: palette.label, alpha: MARKED_HALO_ALPHA });
      }
      const color = assetDomainColor(node.asset === null ? 'to_classify' : assetDomain(node.asset.categoryId));
      paintTintedDisc(ctx, x, y, NODE_RADIUS, color, palette.surface, TINT_ALPHA[effectiveTheme]);
      const glyph: CategoryGlyph = node.asset === null ? 'shapes' : categoryGlyph(node.asset.categoryId);
      paintGlyph(ctx, glyph, x, y, GLYPH_SIZE, color);
      paintPins(node, ctx, x, y, globalScale);
      paintFindingPills(node, ctx, x, y, globalScale);
    }

    paintLabels(node, ctx, x, y, globalScale);
    ctx.restore();
  };

  const paintLink = (edge: DrawnEdge, curve: Curve, ctx: CanvasRenderingContext2D): void => {
    const mutual = isMutualEdge(edge);
    const ring = focus === null ? undefined : edgeRing(focus, edge);
    const headed = isDirectedEdge(edge, grammar ?? 'dependencies');
    const line = headed ? lineOf(curve, edge) : curve;
    const undeclared = edge.kind === 'internet_exposure';
    const betweenPrimaryAssets = edge.kind === 'primary_dependency';
    const unknownStrength = betweenPrimaryAssets && isUnknownStrengthEdge(edge);

    ctx.save();
    ctx.globalAlpha = (focus === null ? 1 : ringAlpha(ring)) * (betweenPrimaryAssets ? primaryEdgeAlpha(edge) : LINK_INK_ALPHA);
    ctx.strokeStyle = undeclared ? palette.glyph : unknownStrength ? palette.unknownStrength : betweenPrimaryAssets ? palette.primaryEdge : palette.edge;
    ctx.fillStyle = ctx.strokeStyle;
    if (selectedEdge?.id === edge.id) {
      ctx.lineWidth = SELECTED_LINK_WIDTH;
    } else {
      ctx.lineWidth = (ring === undefined ? LINK_WIDTH : FOCUSED_LINK_WIDTH) * (betweenPrimaryAssets ? PRIMARY_LINK_WIDTH_FACTOR : 1);
    }
    if (undeclared || unknownStrength) {
      ctx.setLineDash([5, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(line.start.x, line.start.y);
    ctx.bezierCurveTo(line.c1.x, line.c1.y, line.c2.x, line.c2.y, line.end.x, line.end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (headed) {
      paintArrowHead(ctx, curve.start, startTangent(curve));
    }
    if (mutual) {
      paintArrowHead(ctx, curve.end, endTangent(curve));
    }
    ctx.restore();
  };

  const pillContentWidth = (ctx: CanvasRenderingContext2D, content: PillContent, screenPx: number): number => {
    const text = ctx.measureText(content.text).width;
    if (content.lift === null) {
      return text;
    }
    const band = getAssetCriticalityLabel(content.lift);
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `600 ${PILL_TEXT_PX * screenPx}px sans-serif`;
    const lift = ctx.measureText(band).width;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `500 ${PILL_TEXT_PX * screenPx}px sans-serif`;
    return text + (PILL_LIFT_GAP_PX * 2 + PILL_LIFT_GLYPH_PX + 2) * screenPx + lift;
  };

  const paintPillContent = (
    ctx: CanvasRenderingContext2D,
    content: PillContent,
    box: Box,
    screenPx: number,
    ink: string,
    selected: boolean,
  ): void => {
    ctx.textBaseline = 'middle';
    if (content.lift === null) {
      ctx.textAlign = 'center';
      ctx.fillStyle = ink;
      ctx.fillText(content.text, box.x, box.y);
      return;
    }
    const liftInk = selected ? ink : palette.criticality[content.lift];
    let cursor = box.x - box.halfWidth + PILL_PADDING_PX * screenPx;
    ctx.textAlign = 'left';
    ctx.fillStyle = ink;
    ctx.fillText(content.text, cursor, box.y);
    cursor += ctx.measureText(content.text).width + PILL_LIFT_GAP_PX * screenPx;
    ctx.beginPath();
    ctx.moveTo(cursor, box.y - box.halfHeight + 3 * screenPx);
    ctx.lineTo(cursor, box.y + box.halfHeight - 3 * screenPx);
    ctx.lineWidth = screenPx;
    ctx.strokeStyle = selected ? ink : palette.link;
    ctx.stroke();
    cursor += PILL_LIFT_GAP_PX * screenPx;
    const glyph = PILL_LIFT_GLYPH_PX * screenPx;
    paintGlyph(ctx, LIFT_GLYPH, cursor + glyph / 2, box.y, glyph, liftInk, LIFT_GLYPH_STROKE);
    cursor += glyph + 2 * screenPx;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `600 ${PILL_TEXT_PX * screenPx}px sans-serif`;
    ctx.fillStyle = liftInk;
    ctx.fillText(getAssetCriticalityLabel(content.lift), cursor, box.y);
  };

  /**
   * After the nodes, so a pill sits over the label under it. A pill touching one already placed is
   * left out, since a pill half under another names neither, and the selected link's goes first.
   */
  const paintPills = (
    ctx: CanvasRenderingContext2D,
    globalScale: number,
    view: ColumnGraphView<DependencyGraphNode, DrawnEdge>,
  ): Array<ColumnGraphLinkTarget> => {
    const screenPx = 1 / globalScale;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `500 ${PILL_TEXT_PX * screenPx}px sans-serif`;
    const pills: Array<ColumnGraphLinkTarget & { edge: DrawnEdge, content: PillContent | null }> = [];
    for (const { link: edge, curve } of view.links) {
      const content = pillContent(edge, nodesById);
      const mutual = isMutualEdge(edge);
      if (curve === null || (content === null && !mutual)) {
        continue;
      }
      const middle = curveMidpoint(lineOf(curve, edge));
      const box = content === null
        ? { ...middle, halfWidth: MUTUAL_PILL_RADIUS_PX * screenPx, halfHeight: MUTUAL_PILL_RADIUS_PX * screenPx }
        : {
          ...middle,
          halfWidth: (pillContentWidth(ctx, content, screenPx) + PILL_PADDING_PX * 2 * screenPx) / 2,
          halfHeight: (PILL_HEIGHT_PX * screenPx) / 2,
        };
      const entry = { linkId: edge.id, box, edge, content };
      if (selectedEdge?.id === edge.id) {
        pills.unshift(entry);
      } else {
        pills.push(entry);
      }
    }
    const margin = (PILL_GAP_PX / 2) * screenPx;
    const placed = boxesClearOfEachOther(pills.map((pill) => ({
      pill,
      box: { ...pill.box, halfWidth: pill.box.halfWidth + margin, halfHeight: pill.box.halfHeight + margin },
    }))).map(({ pill }) => pill);

    for (const { edge, box, content } of placed) {
      const selected = selectedEdge?.id === edge.id;
      const unknown = edge.links[0].roles?.every((role) => role === 'unknown') ?? false;
      ctx.save();
      ctx.globalAlpha = focus === null ? 1 : ringAlpha(edgeRing(focus, edge));
      ctx.beginPath();
      if (content === null) {
        ctx.arc(box.x, box.y, box.halfWidth, 0, Math.PI * 2);
      } else {
        ctx.roundRect(box.x - box.halfWidth, box.y - box.halfHeight, box.halfWidth * 2, box.halfHeight * 2, box.halfHeight);
      }
      ctx.fillStyle = selected ? palette.accent : palette.surface;
      ctx.fill();
      if (!selected && !unknown) {
        const opacity = ctx.globalAlpha;
        ctx.fillStyle = palette.pill;
        ctx.globalAlpha = opacity * TINT_ALPHA[effectiveTheme];
        ctx.fill();
        ctx.globalAlpha = opacity;
      }
      if (!selected) {
        ctx.lineWidth = screenPx;
        ctx.strokeStyle = unknown ? palette.glyph : palette.link;
        if (unknown) {
          ctx.setLineDash([3 * screenPx, 2 * screenPx]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const ink = unknown ? palette.glyph : palette.label;
      if (content === null) {
        paintGlyph(ctx, MUTUAL_GLYPH, box.x, box.y, MUTUAL_GLYPH_PX * screenPx, selected ? palette.surface : ink);
      } else {
        paintPillContent(ctx, content, box, screenPx, selected ? palette.surface : ink, selected);
      }
      ctx.restore();
    }
    return placed.map(({ linkId, box }) => ({ linkId, box }));
  };

  const activate = (node: DependencyGraphNode | undefined): void => {
    if (node === undefined) {
      onSelect(null);
      return;
    }
    if (node.kind === 'aggregate') {
      if (expandsOnClick(node)) {
        onExpand();
      }
      return;
    }
    onSelect(selectedId === node.id ? null : { kind: 'node', id: node.id });
  };

  const activateEdge = (edge: DrawnEdge): void => {
    onSelect(selectedEdge?.id === edge.id ? null : { kind: 'edge', id: edge.id });
  };

  return (
    <ColumnGraph
      nodes={model.nodes}
      links={edges}
      signature={graphSignature(model)}
      shapeSignature={shapeSignature(model)}
      columnGap={columnGap}
      nodeReach={(node) => nodeReach(node, markedNodeId)}
      paintNode={paintNode}
      paintLink={paintLink}
      paintOverlay={paintPills}
      isSelectableLink={isSelectableEdge}
      onNodeClick={activate}
      onLinkClick={activateEdge}
      followedNodeId={selectedId}
      fitSignal={fitSignal}
      isFullScreen={isFullScreen}
      onToggleFullScreen={onToggleFullScreen}
      height={height}
      markedNodeId={markedNodeId}
      centreOnMarkedLabel={t`Centre on this asset`}
      accessibleLabel={grammar === 'access_relations' ? t`Access relation graph` : t`Dependency graph`}
      accessibleItems={(
        <>
          {model.nodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                aria-pressed={selectedId === node.id}
                onClick={() => activate(node)}
              >
                {nodeSentence(node, model, grammar ?? 'dependencies')}
              </button>
            </li>
          ))}
          {edges.filter(isSelectableEdge).map((edge) => (
            <li key={edge.id}>
              <button
                type="button"
                aria-pressed={selectedEdge?.id === edge.id}
                onClick={() => activateEdge(edge)}
              >
                {edgeSentence(edge, model)}
              </button>
            </li>
          ))}
        </>
      )}
    />
  );
};
