import type { PrimaryToPrimaryLinkStrength, SecurityNeedLevel } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { Box, Curve } from '../../../components/shared/column-graph-geometry';
import type { ColumnGraphLinkTarget, ColumnGraphView, PlacedNode } from '../../../components/shared/column-graph';
import type { PrimaryGraphEdge, PrimaryGraphLink, PrimaryGraphModel, PrimaryGraphNode } from '../primary-asset-graph-utils';
import type { DependencyGraphSelection } from '../dependency-graph-utils';
import { ColumnGraph } from '../../../components/shared/column-graph';
import { boxesClearOfEachOther, curveMidpoint, endTangent, startTangent, trimCurve } from '../../../components/shared/column-graph-geometry';
import {
  ARROW_LENGTH,
  GLYPH_SIZE,
  HALO_ALPHA,
  LINK_COLOR_PROPERTY,
  LINK_WIDTH,
  MIN_TEXT_SCALE,
  paintArrowHead,
  paintHalo,
  paintNodeCaption,
  readCanvasColor,
  TINT_ALPHA,
} from '../../../components/shared/column-graph-paint';
import { useTheme } from '../../../providers/theme-provider';
import { securityNeedLabel } from '../../primary-assets/primary-asset-fields-labels';
import { criticalityRingProperty, focusOnNode, ringAlpha } from '../dependency-graph-utils';
import { paintGlyph, PRIMARY_ASSET_GLYPH } from '../dependency-graph-painter';
import { getLinkStrengthLabel } from '../link-strength-labels';
import { edgeStrength } from '../primary-asset-graph-utils';

/** Graph units, the same square the dependency graph draws a primary asset as. */
const HALF_SIZE = 23;
const CORNER = 9;
/** Sized for a node and its two caption lines. */
const COLUMN_GAP = 110;
/**
 * Below this zoom a caption, which stops shrinking at `MIN_TEXT_SCALE`, runs into the next one of its
 * column: names are then left to the tooltip and the selection.
 */
const NAME_MIN_SCALE = 0.5;
/** A neighbour outside the list's filters stays legible as context. */
const OUTSIDE_FILTERS_ALPHA = 0.4;
/** Strength is told by ink alone, every line having the same width. */
export const STRENGTH_INK_ALPHA: Record<PrimaryToPrimaryLinkStrength, number> = {
  critical: 1,
  important: 0.55,
  minor: 0.22,
  unknown: 0.7,
};
const SELECTED_LINK_WIDTH = 2.8;
/** In screen pixels, so a pill stays a click target at any zoom. */
const PILL_TEXT_PX = 10;
const PILL_HEIGHT_PX = 18;
const PILL_PADDING_PX = 8;
const PILL_GAP_PX = 4;

interface PrimaryAssetGraphProps {
  model: PrimaryGraphModel,
  selection: DependencyGraphSelection | null,
  onSelect: (selection: DependencyGraphSelection | null) => void,
  fitSignal: number,
  isFullScreen: boolean,
  onToggleFullScreen: () => void,
  height?: number,
}

export const overallLevelLabel = (level: SecurityNeedLevel | null): string => (level === null ? t`Not set` : securityNeedLabel(level));

/** The canvas property of a level's ink: the tones of the level chip of the list. */
export const overallLevelColorProperty = (level: SecurityNeedLevel | null): string => criticalityRingProperty(level ?? 'unknown');

export const resourceTypeLabel = (link: Pick<PrimaryGraphLink, 'dependencyResourceTypeName'>): string =>
  link.dependencyResourceTypeName ?? t`No type`;

const graphSignature = (model: PrimaryGraphModel): string => [
  ...model.nodes.map((node) => [node.id, node.level, node.asset.name, node.overallLevel ?? '', node.outsideFilters].join(':')),
  ...model.edges.map((edge) => [edge.id, ...edge.links.map((link) => `${link.id}:${link.strength}:${link.dependencyResourceTypeName ?? ''}`)].join(':')),
].sort().join('|');

const shapeSignature = (model: PrimaryGraphModel): string =>
  `${model.nodes.map((node) => node.id).sort().join()}|${model.edges.map((edge) => edge.id).sort().join()}`;

/** One entry per stored link, so a mutual dependency is walked both ways. */
const focusLinks = (model: PrimaryGraphModel) => model.edges.flatMap((edge) => edge.links.map((link) => ({
  id: link.id,
  source: link.dependentAssetId,
  target: link.providerAssetId,
})));

const isMutual = (edge: PrimaryGraphEdge): boolean => edge.links.length > 1;

const lineOf = (curve: Curve, edge: PrimaryGraphEdge): Curve => trimCurve(curve, ARROW_LENGTH, isMutual(edge) ? ARROW_LENGTH : 0);

const nameIn = (model: PrimaryGraphModel, id: string): string => model.nodes.find((node) => node.id === id)?.asset.name ?? '';

/** A canvas has no nodes to focus, so the same selection is offered from a list only a keyboard or a reader reaches. */
const nodeSentence = (model: PrimaryGraphModel, node: PrimaryGraphNode): string => {
  const links = model.edges.flatMap((edge) => edge.links);
  const level = overallLevelLabel(node.overallLevel);
  const dependsOn = links.filter((link) => link.dependentAssetId === node.id).map((link) => nameIn(model, link.providerAssetId)).join(', ');
  const supports = links.filter((link) => link.providerAssetId === node.id).map((link) => nameIn(model, link.dependentAssetId)).join(', ');
  const { name } = node.asset;
  const said = [t`${name}, overall level ${level}`];
  if (node.outsideFilters) {
    said.push(t`Outside the filters`);
  }
  if (dependsOn !== '') {
    said.push(t`Depends on ${dependsOn}`);
  }
  if (supports !== '') {
    said.push(t`Supports ${supports}`);
  }
  return `${said.join('. ')}.`;
};

const edgeSentence = (model: PrimaryGraphModel, edge: PrimaryGraphEdge): string => edge.links.map((link) => {
  const dependent = nameIn(model, link.dependentAssetId);
  const provider = nameIn(model, link.providerAssetId);
  const strength = getLinkStrengthLabel(link.strength);
  const resource = resourceTypeLabel(link);
  return t`${dependent} depends on ${provider}: ${strength}, runs through ${resource}.`;
}).join(' ');

export const PrimaryAssetGraph: FunctionComponent<PrimaryAssetGraphProps> = ({
  model,
  selection,
  onSelect,
  fitSignal,
  isFullScreen,
  onToggleFullScreen,
  height,
}) => {
  const { effectiveTheme } = useTheme();
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));

  const palette = {
    surface: readCanvasColor('--fds-bg-elevation-default-layer-1', '#ffffff'),
    label: readCanvasColor('--fds-text-default-primary', '#0b0b0b'),
    secondary: readCanvasColor('--fds-text-default-secondary', '#52514e'),
    accent: readCanvasColor('--fds-color-filigran-brand-primary', '#0079a8'),
    edge: readCanvasColor(LINK_COLOR_PROPERTY, '#0079a8'),
    unknown: readCanvasColor('--fds-color-feedback-neutral-primary', '#7a7c85'),
    border: readCanvasColor('--fds-border-elevation-subtle-soft', '#cfcdc5'),
    level: {
      very_high: readCanvasColor(overallLevelColorProperty('very_high'), '#e51e10'),
      high: readCanvasColor(overallLevelColorProperty('high'), '#e6700f'),
      medium: readCanvasColor(overallLevelColorProperty('medium'), '#b8870a'),
      low: readCanvasColor(overallLevelColorProperty('low'), '#17ab1f'),
      none: readCanvasColor(overallLevelColorProperty(null), '#7a7c85'),
    },
  };
  const levelInk = (level: SecurityNeedLevel | null): string => (level === null ? palette.level.none : palette.level[level]);

  const selectedNodeId = selection?.kind === 'node' ? selection.id : null;
  const selectedEdge = selection?.kind === 'edge' ? model.edges.find((edge) => edge.id === selection.id) : undefined;
  const focus = selectedNodeId !== null && nodesById.has(selectedNodeId) ? focusOnNode({ links: focusLinks(model) }, selectedNodeId) : null;

  const nodeAlpha = (node: PrimaryGraphNode): number => {
    const base = node.outsideFilters ? OUTSIDE_FILTERS_ALPHA : 1;
    if (selectedEdge !== undefined) {
      return node.id === selectedEdge.source || node.id === selectedEdge.target ? base : ringAlpha(undefined);
    }
    return focus === null ? base : Math.min(base, ringAlpha(focus.nodeRings.get(node.id)));
  };

  const edgeAlpha = (edge: PrimaryGraphEdge): number => {
    if (selectedEdge !== undefined) {
      return selectedEdge.id === edge.id ? 1 : ringAlpha(undefined);
    }
    if (focus === null) {
      return 1;
    }
    const reached = edge.links.some((link) => focus.linkRings.has(link.id));
    return ringAlpha(reached ? 1 : undefined);
  };

  const paintNode = (node: PlacedNode<PrimaryGraphNode>, ctx: CanvasRenderingContext2D, globalScale: number): void => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const selected = selectedNodeId === node.id;
    const ink = levelInk(node.overallLevel);
    ctx.save();
    ctx.globalAlpha = nodeAlpha(node);
    if (selected) {
      paintHalo(ctx, x, y, HALF_SIZE, CORNER, { color: palette.accent, alpha: HALO_ALPHA[effectiveTheme] });
    }
    const opacity = ctx.globalAlpha;
    ctx.beginPath();
    ctx.roundRect(x - HALF_SIZE, y - HALF_SIZE, HALF_SIZE * 2, HALF_SIZE * 2, CORNER);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.globalAlpha = opacity * TINT_ALPHA[effectiveTheme];
    ctx.fill();
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
    paintGlyph(ctx, PRIMARY_ASSET_GLYPH, x, y, GLYPH_SIZE + 2, ink);

    if (selected || globalScale >= NAME_MIN_SCALE) {
      const unit = Math.max(1, MIN_TEXT_SCALE / globalScale);
      paintNodeCaption(ctx, x, y + HALF_SIZE + 7, unit, {
        name: node.asset.name,
        weight: selected ? '600' : '500',
        nameInk: selected ? palette.surface : palette.label,
        highlight: selected ? palette.accent : null,
        type: overallLevelLabel(node.overallLevel),
        typeInk: palette.secondary,
      });
    }
    ctx.restore();
  };

  const paintLink = (edge: PrimaryGraphEdge, curve: Curve, ctx: CanvasRenderingContext2D): void => {
    const strength = edgeStrength(edge);
    const line = lineOf(curve, edge);
    ctx.save();
    ctx.globalAlpha = edgeAlpha(edge) * STRENGTH_INK_ALPHA[strength];
    ctx.strokeStyle = strength === 'unknown' ? palette.unknown : palette.edge;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = selectedEdge?.id === edge.id ? SELECTED_LINK_WIDTH : LINK_WIDTH;
    if (strength === 'unknown') {
      ctx.setLineDash([5, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(line.start.x, line.start.y);
    ctx.bezierCurveTo(line.c1.x, line.c1.y, line.c2.x, line.c2.y, line.end.x, line.end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    paintArrowHead(ctx, curve.start, startTangent(curve));
    if (isMutual(edge)) {
      paintArrowHead(ctx, curve.end, endTangent(curve));
    }
    ctx.restore();
  };

  /**
   * The resource types are named on the links of the selection only: written on every line of a
   * graph this size, they would cover it. A pill touching one already placed is left out.
   */
  const paintPills = (
    ctx: CanvasRenderingContext2D,
    globalScale: number,
    view: ColumnGraphView<PrimaryGraphNode, PrimaryGraphEdge>,
  ): Array<ColumnGraphLinkTarget> => {
    if (selectedNodeId === null && selectedEdge === undefined) {
      return [];
    }
    const screenPx = 1 / globalScale;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `500 ${PILL_TEXT_PX * screenPx}px sans-serif`;
    const pills: Array<ColumnGraphLinkTarget & { text: string, selected: boolean }> = [];
    for (const { link: edge, curve } of view.links) {
      const touches = selectedEdge === undefined
        ? edge.source === selectedNodeId || edge.target === selectedNodeId
        : selectedEdge.id === edge.id;
      if (curve === null || !touches) {
        continue;
      }
      const text = [...new Set(edge.links.map(resourceTypeLabel))].join(', ');
      const box: Box = {
        ...curveMidpoint(lineOf(curve, edge)),
        halfWidth: (ctx.measureText(text).width + PILL_PADDING_PX * 2 * screenPx) / 2,
        halfHeight: (PILL_HEIGHT_PX * screenPx) / 2,
      };
      pills.push({ linkId: edge.id, box, text, selected: selectedEdge?.id === edge.id });
    }
    const margin = (PILL_GAP_PX / 2) * screenPx;
    const placed = boxesClearOfEachOther(pills.map((pill) => ({
      pill,
      box: { ...pill.box, halfWidth: pill.box.halfWidth + margin, halfHeight: pill.box.halfHeight + margin },
    }))).map(({ pill }) => pill);

    for (const { box, text, selected } of placed) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(box.x - box.halfWidth, box.y - box.halfHeight, box.halfWidth * 2, box.halfHeight * 2, box.halfHeight);
      ctx.fillStyle = selected ? palette.accent : palette.surface;
      ctx.fill();
      if (!selected) {
        ctx.lineWidth = screenPx;
        ctx.strokeStyle = palette.border;
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = selected ? palette.surface : palette.label;
      ctx.fillText(text, box.x, box.y);
      ctx.restore();
    }
    return placed.map(({ linkId, box }) => ({ linkId, box }));
  };

  const activate = (node: PrimaryGraphNode | undefined): void => {
    onSelect(node === undefined || selectedNodeId === node.id ? null : { kind: 'node', id: node.id });
  };

  const activateEdge = (edge: PrimaryGraphEdge): void => {
    onSelect(selectedEdge?.id === edge.id ? null : { kind: 'edge', id: edge.id });
  };

  return (
    <ColumnGraph
      nodes={model.nodes}
      links={model.edges}
      signature={graphSignature(model)}
      shapeSignature={shapeSignature(model)}
      columnGap={COLUMN_GAP}
      nodeReach={() => HALF_SIZE}
      paintNode={paintNode}
      paintLink={paintLink}
      paintOverlay={paintPills}
      isSelectableLink={() => true}
      onNodeClick={activate}
      onLinkClick={activateEdge}
      nodeTooltip={(node) => node.asset.name}
      followedNodeId={selectedNodeId}
      fitSignal={fitSignal}
      isFullScreen={isFullScreen}
      onToggleFullScreen={onToggleFullScreen}
      height={height}
      accessibleLabel={t`Graph of the dependencies between primary assets`}
      accessibleItems={(
        <>
          {model.nodes.map((node) => (
            <li key={node.id}>
              <button type="button" aria-pressed={selectedNodeId === node.id} onClick={() => activate(node)}>
                {nodeSentence(model, node)}
              </button>
            </li>
          ))}
          {model.edges.map((edge) => (
            <li key={edge.id}>
              <button type="button" aria-pressed={selectedEdge?.id === edge.id} onClick={() => activateEdge(edge)}>
                {edgeSentence(model, edge)}
              </button>
            </li>
          ))}
        </>
      )}
    />
  );
};
