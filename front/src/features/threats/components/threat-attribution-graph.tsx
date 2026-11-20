import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ThreatEntityType } from '@app/module/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, MoveRight } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Curve, Point } from '../../../components/shared/column-graph-geometry';
import type { ColumnGraphLinkTarget, ColumnGraphView, PlacedNode } from '../../../components/shared/column-graph';
import type { AttributionGraphColumn, AttributionGraphLink, AttributionGraphNode } from './threat-attribution-graph-utils';
import type { AttributionReference } from './threat-overview-utils';
import { useTheme } from '../../../providers/theme-provider';
import { ColumnGraph, LEVEL_DISTANCE } from '../../../components/shared/column-graph';
import { boxesClearOfEachOther, curveMidpoint, endTangent, trimCurve } from '../../../components/shared/column-graph-geometry';
import {
  ARROW_LENGTH,
  fitLabel,
  GLYPH_SIZE,
  HALO_ALPHA,
  LABEL_OFFSET,
  LINK_COLOR_PROPERTY,
  LINK_INK,
  LINK_INK_ALPHA,
  LINK_WIDTH,
  MARKED_HALO_ALPHA,
  MARKED_HALO_INK,
  MIN_TEXT_SCALE,
  NODE_RADIUS,
  paintArrowHead,
  paintGlyphPrimitives,
  paintHalo,
  paintNodeCaption,
  paintTintedDisc,
  readCanvasColor,
  TINT_ALPHA,
} from '../../../components/shared/column-graph-paint';
import { FOLD_GLYPH, THREAT_GLYPHS, THREAT_TYPE_GLYPH } from './threat-attribution-graph-glyphs';
import { ATTRIBUTION_ROW_GAP, buildAttributionGraph, MARKED_REACH } from './threat-attribution-graph-utils';
import { threatEntityTypeLabel } from './threat-type-badge';
import { ThreatTypeIcon } from './threat-type-icon';

/** The card grows with its longest column, so a long one is not shrunk to fit, up to the most a half-width card should take. */
const MIN_GRAPH_HEIGHT = 360;
const MAX_GRAPH_HEIGHT = 640;
/** Room for the column headings above the drawing and the last captions under it. */
const GRAPH_FRAME_HEIGHT = 170;
/** The width of the controls on the canvas's left, which the framing keeps the drawing clear of. */
const CONTROLS_INSET = 56;
/** Half the widest a caption is drawn at a text scale of one, which a pill beside its node stays clear of. */
const CAPTION_HALF_WIDTH = 75;
/** In screen pixels, so a pill and a column heading read at any zoom. */
const PILL_TEXT_PX = 10;
const PILL_HEIGHT_PX = 18;
const PILL_PADDING_PX = 8;
const PILL_GAP_PX = 4;
const HEADING_TEXT_PX = 11;
const HEADING_TOP_PX = 22;
const HEADING_COUNT_GAP_PX = 6;
/** Two ends closer than this across are one column, which an arc joins rather than a curve between columns. */
const SAME_COLUMN_SPAN = NODE_RADIUS * 2;
const THREAT_COLOR_PROPERTY = '--fds-color-entities-all-threats';
/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const SUBTLE_BORDER = '1px solid var(--fds-border-elevation-subtle-soft)';
/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const HALO_SWATCH_SHADOW = `0 0 0 2px var(--fds-bg-elevation-default-layer-1), 0 0 0 4px ${MARKED_HALO_INK}`;

interface ThreatAttributionGraphProps {
  threat: AttributionReference,
  attributedTo: ReadonlyArray<AttributionReference>,
  attributedFrom: ReadonlyArray<AttributionReference>,
  /** The types whose column shows every threat; held by the caller, so it outlives the graph. */
  expanded: ReadonlySet<ThreatEntityType>,
  onExpand: (entityType: ThreatEntityType) => void,
}

const columnHeading = (entityType: ThreatEntityType): string => {
  switch (entityType) {
    case 'campaign':
      return t`Campaigns`;
    case 'intrusion-set':
      return t`Intrusion sets`;
    case 'threat-actor':
      return t`Threat actors`;
  }
};

const foldName = (node: AttributionGraphNode): string => {
  const count = node.foldedCount;
  switch (node.entityType) {
    case 'campaign':
      return plural(count, { one: '# campaign', other: '# campaigns' });
    case 'intrusion-set':
      return plural(count, { one: '# intrusion set', other: '# intrusion sets' });
    case 'threat-actor':
      return plural(count, { one: '# threat actor', other: '# threat actors' });
  }
};

const nodeReach = (node: AttributionGraphNode): number => (node.isCurrent ? MARKED_REACH : NODE_RADIUS);

/** The scale a caption is painted at, which stops shrinking below `MIN_TEXT_SCALE` and grows in graph units instead. */
const textUnit = (globalScale: number): number => Math.max(1, MIN_TEXT_SCALE / globalScale);

/** What is stroked: the curve short of the head on the threat it is attributed to. */
const lineOf = (curve: Curve): Curve => trimCurve(curve, 0, ARROW_LENGTH);

const graphSignature = (nodes: ReadonlyArray<AttributionGraphNode>, links: ReadonlyArray<AttributionGraphLink>): string => [
  ...nodes.map((node) => [node.id, node.kind, node.name, node.foldedCount, node.level, node.pinnedY].join(':')),
  ...links.map((link) => `${link.id}:${link.source}:${link.target}`),
].sort().join('|');

/**
 * One pill per bundle, where its links meet: on the link itself when it is alone or runs within a
 * column, else halfway across, level with the threat the bundle converges on.
 */
const bundleAnchor = (curves: ReadonlyArray<Curve>, hub: Point, halfWidth: number, unit: number): Point => {
  const [first] = curves;
  if (Math.abs(first.end.x - first.start.x) < SAME_COLUMN_SPAN) {
    const middle = curveMidpoint(lineOf(first));
    return { x: Math.max(middle.x, hub.x + CAPTION_HALF_WIDTH * unit + halfWidth), y: middle.y };
  }
  if (curves.length === 1) {
    return curveMidpoint(lineOf(first));
  }
  return { x: (first.start.x + first.end.x) / 2, y: hub.y };
};

/**
 * The current threat's attributions as a star around it: one column per type, an arrow from each
 * threat attributed to the one it is attributed to, one "Attributed to" pill per bundle of arrows. A
 * click opens a threat's page, or unfolds the column a fold node stands for.
 */
export const ThreatAttributionGraph: FunctionComponent<ThreatAttributionGraphProps> = ({
  threat,
  attributedTo,
  attributedFrom,
  expanded,
  onExpand,
}) => {
  const navigate = useNavigate();
  const { effectiveTheme } = useTheme();
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  // The overlay covers the page, so the key that leaves every other overlay has to leave this one.
  useEffect(() => {
    if (!isFullScreen) {
      return;
    }
    const leave = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setIsFullScreen(false);
        setFitSignal((signal) => signal + 1);
      }
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [isFullScreen]);

  const { nodes, links, columns } = buildAttributionGraph(threat, attributedTo, attributedFrom, expanded);
  const presentTypes = columns.map((column) => column.entityType);
  const longestColumn = Math.max(...columns.map((column) => nodes.filter((node) => node.level === column.level).length));
  const graphHeight = Math.min(MAX_GRAPH_HEIGHT, Math.max(MIN_GRAPH_HEIGHT, longestColumn * ATTRIBUTION_ROW_GAP + GRAPH_FRAME_HEIGHT));

  const palette = {
    surface: readCanvasColor('--fds-bg-elevation-default-layer-1', '#ffffff'),
    glyph: readCanvasColor('--fds-text-default-secondary', '#52514e'),
    label: readCanvasColor('--fds-text-default-primary', '#0b0b0b'),
    border: readCanvasColor('--fds-border-elevation-subtle-soft', '#cfcdc5'),
    fold: readCanvasColor('--fds-border-elevation-subtle', '#cfcdc5'),
    accent: readCanvasColor('--fds-color-filigran-brand-primary', '#0079a8'),
    edge: readCanvasColor(LINK_COLOR_PROPERTY, '#0079a8'),
    pill: readCanvasColor('--fds-color-feedback-neutral-secondary', '#62636a'),
    threat: readCanvasColor(THREAT_COLOR_PROPERTY, '#ff9800'),
  };

  const openThreat = (threatId: string): void => {
    void navigate({
      from: '/$tenantId/{-$organizationId}',
      to: 'threat-center/threats/$threatId',
      params: { threatId },
    });
  };

  const activate = (node: AttributionGraphNode | undefined): void => {
    if (node === undefined || node.isCurrent) {
      return;
    }
    if (node.kind === 'fold') {
      onExpand(node.entityType);
      return;
    }
    openThreat(node.id);
  };

  const paintNode = (node: PlacedNode<AttributionGraphNode>, ctx: CanvasRenderingContext2D, globalScale: number, hoveredNodeId: string | null): void => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const hovered = hoveredNodeId === node.id;
    ctx.save();
    if (node.kind === 'fold') {
      ctx.beginPath();
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hovered ? palette.accent : palette.fold;
      ctx.stroke();
      ctx.setLineDash([]);
      paintGlyphPrimitives(ctx, THREAT_GLYPHS[FOLD_GLYPH], x, y, GLYPH_SIZE, palette.glyph);
    } else {
      if (hovered) {
        paintHalo(ctx, x, y, NODE_RADIUS, null, { color: palette.accent, alpha: HALO_ALPHA[effectiveTheme] });
      } else if (node.isCurrent) {
        paintHalo(ctx, x, y, NODE_RADIUS, null, { color: palette.label, alpha: MARKED_HALO_ALPHA });
      }
      paintTintedDisc(ctx, x, y, NODE_RADIUS, palette.threat, palette.surface, TINT_ALPHA[effectiveTheme]);
      paintGlyphPrimitives(ctx, THREAT_GLYPHS[THREAT_TYPE_GLYPH[node.entityType]], x, y, GLYPH_SIZE, palette.threat);
    }
    paintNodeCaption(ctx, x, y + nodeReach(node) + LABEL_OFFSET, textUnit(globalScale), {
      name: node.kind === 'fold' ? foldName(node) : node.name,
      weight: hovered || node.isCurrent ? '600' : '500',
      nameInk: hovered && node.kind === 'threat' ? palette.surface : palette.label,
      highlight: hovered && node.kind === 'threat' ? palette.accent : null,
      type: node.kind === 'fold' ? t`Click to expand` : threatEntityTypeLabel(node.entityType),
      typeInk: node.kind === 'fold' ? palette.accent : palette.glyph,
    });
    ctx.restore();
  };

  const paintLink = (_link: AttributionGraphLink, curve: Curve, ctx: CanvasRenderingContext2D): void => {
    const line = lineOf(curve);
    ctx.save();
    ctx.globalAlpha = LINK_INK_ALPHA;
    ctx.strokeStyle = palette.edge;
    ctx.fillStyle = palette.edge;
    ctx.lineWidth = LINK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(line.start.x, line.start.y);
    ctx.bezierCurveTo(line.c1.x, line.c1.y, line.c2.x, line.c2.y, line.end.x, line.end.y);
    ctx.stroke();
    paintArrowHead(ctx, curve.end, endTangent(curve));
    ctx.restore();
  };

  const paintPills = (
    ctx: CanvasRenderingContext2D,
    globalScale: number,
    view: ColumnGraphView<AttributionGraphNode, AttributionGraphLink>,
  ): void => {
    const screenPx = 1 / globalScale;
    const current = view.nodes.find((node) => node.isCurrent);
    const bundles = new Map<string, Array<Curve>>();
    for (const { link, curve } of view.links) {
      if (curve !== null) {
        bundles.set(link.bundle, [...(bundles.get(link.bundle) ?? []), curve]);
      }
    }
    const text = t`Attributed to`;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    ctx.font = `500 ${PILL_TEXT_PX * screenPx}px sans-serif`;
    const halfWidth = (ctx.measureText(text).width + PILL_PADDING_PX * 2 * screenPx) / 2;
    const halfHeight = (PILL_HEIGHT_PX * screenPx) / 2;
    const margin = (PILL_GAP_PX / 2) * screenPx;
    const pills = boxesClearOfEachOther([...bundles.values()].map((curves) => {
      const anchor = bundleAnchor(curves, { x: current?.x ?? 0, y: current?.y ?? 0 }, halfWidth, textUnit(globalScale));
      return { box: { ...anchor, halfWidth: halfWidth + margin, halfHeight: halfHeight + margin } };
    }));
    for (const { box } of pills) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(box.x - halfWidth, box.y - halfHeight, halfWidth * 2, halfHeight * 2, halfHeight);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.fillStyle = palette.pill;
      ctx.globalAlpha = TINT_ALPHA[effectiveTheme];
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = screenPx;
      ctx.strokeStyle = palette.border;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = palette.label;
      ctx.fillText(text, box.x, box.y);
      ctx.restore();
    }
  };

  /** Pinned to the top of the canvas, so a column stays named however far the reader pans down. */
  const paintHeadings = (ctx: CanvasRenderingContext2D, screenPx: number, view: ColumnGraphView<AttributionGraphNode, AttributionGraphLink>): void => {
    const top = view.screenToGraph(0, HEADING_TOP_PX).y;
    for (const column of columns) {
      const x = view.nodes.find((node) => node.level === column.level)?.fx;
      if (x !== undefined) {
        paintHeading(ctx, screenPx, column, x, top);
      }
    }
  };

  const paintHeading = (ctx: CanvasRenderingContext2D, screenPx: number, column: AttributionGraphColumn, x: number, top: number): void => {
    const heading = columnHeading(column.entityType).toLocaleUpperCase();
    const count = String(column.count);
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    const headingFont = `500 ${HEADING_TEXT_PX * screenPx}px sans-serif`;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
    const countFont = `600 ${HEADING_TEXT_PX * screenPx}px sans-serif`;
    ctx.font = countFont;
    const countWidth = ctx.measureText(count).width;
    const gap = HEADING_COUNT_GAP_PX * screenPx;
    ctx.font = headingFont;
    const shown = fitLabel(ctx, heading, LEVEL_DISTANCE - countWidth - gap * 3);
    const headingWidth = ctx.measureText(shown).width;
    const left = x - (headingWidth + gap + countWidth) / 2;
    ctx.font = headingFont;
    ctx.fillStyle = palette.glyph;
    ctx.fillText(shown, left, top);
    ctx.font = countFont;
    ctx.fillStyle = palette.label;
    ctx.fillText(count, left + headingWidth + gap, top);
    ctx.restore();
  };

  const paintOverlay = (
    ctx: CanvasRenderingContext2D,
    globalScale: number,
    view: ColumnGraphView<AttributionGraphNode, AttributionGraphLink>,
  ): Array<ColumnGraphLinkTarget> => {
    paintPills(ctx, globalScale, view);
    paintHeadings(ctx, 1 / globalScale, view);
    return [];
  };

  const nodeTooltip = (node: AttributionGraphNode): ReactNode => (node.kind === 'threat'
    ? (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <Trans>Open its page</Trans>
        <ArrowUpRight className="size-3" aria-hidden />
      </span>
    )
    : null);

  const byId = new Map([...attributedTo, ...attributedFrom].map((other) => [other.id, other]));
  const neighbours = [...byId.values()].filter((other) => other.id !== threat.id);
  const isTarget = new Set(attributedTo.map((other) => other.id));
  const isSource = new Set(attributedFrom.map((other) => other.id));
  const threatName = threat.name;
  const named = (ids: Set<string>): string => neighbours.filter((other) => ids.has(other.id)).map((other) => other.name).join(', ');
  const currentSentence = (): string => {
    const said = [`${threatName}, ${threatEntityTypeLabel(threat.entityType)}, ${t`this threat`}`];
    const targets = named(isTarget);
    const sources = named(isSource);
    if (targets !== '') {
      said.push(t`Attributed to ${targets}`);
    }
    if (sources !== '') {
      said.push(t`Attributed to it: ${sources}`);
    }
    return `${said.join('. ')}.`;
  };
  const neighbourSentence = (other: AttributionReference): string => {
    const said = [`${other.name}, ${threatEntityTypeLabel(other.entityType)}`];
    if (isSource.has(other.id)) {
      said.push(t`attributed to ${threatName}`);
    }
    if (isTarget.has(other.id)) {
      said.push(t`${threatName} is attributed to it`);
    }
    return said.join(', ');
  };

  const graph = (
    <ColumnGraph
      nodes={nodes}
      links={links}
      signature={graphSignature(nodes, links)}
      columnGap={ATTRIBUTION_ROW_GAP}
      nodeReach={nodeReach}
      paintNode={paintNode}
      paintLink={paintLink}
      paintOverlay={paintOverlay}
      isInteractiveNode={(node) => !node.isCurrent}
      onNodeClick={activate}
      nodeTooltip={nodeTooltip}
      fitSignal={fitSignal}
      isFullScreen={isFullScreen}
      onToggleFullScreen={() => {
        setIsFullScreen((current) => !current);
        setFitSignal((signal) => signal + 1);
      }}
      height={isFullScreen ? undefined : graphHeight}
      markedNodeId={threat.id}
      controlsInset={CONTROLS_INSET}
      centreOnMarkedLabel={t`Centre on this threat`}
      accessibleLabel={t`Attributions of ${threatName}`}
      accessibleItems={(
        <>
          <li>{currentSentence()}</li>
          {neighbours.map((other) => (
            <li key={other.id}>
              <Link
                from="/$tenantId/{-$organizationId}"
                to="threat-center/threats/$threatId"
                params={{ threatId: other.id }}
              >
                {neighbourSentence(other)}
              </Link>
            </li>
          ))}
        </>
      )}
    />
  );

  return (
    <div
      className={`flex flex-col ${isFullScreen ? 'fixed inset-0 z-50 bg-[var(--fds-bg-elevation-default-layer-1)]' : ''}`}
      style={{ borderTop: SUBTLE_BORDER }}
    >
      {graph}
      <AttributionGraphLegend types={presentTypes} />
    </div>
  );
};

const AttributionGraphLegend: FunctionComponent<{ types: ReadonlyArray<ThreatEntityType> }> = ({ types }) => (
  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 text-content-caption text-default-secondary" style={{ borderTop: SUBTLE_BORDER }}>
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-default-primary"><Trans>Types</Trans></span>
      {types.map((type) => (
        <span key={type} className="flex items-center gap-1.5">
          <ThreatTypeIcon entityType={type} size={13} />
          {threatEntityTypeLabel(type)}
        </span>
      ))}
    </span>
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-default-primary"><Trans>Links</Trans></span>
      <span className="flex items-center gap-1.5">
        <MoveRight className="size-3.5" style={{ color: LINK_INK }} aria-hidden />
        <Trans>Attributed to</Trans>
      </span>
    </span>
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="mx-1 size-2.5 rounded-full border-2"
        style={{ borderColor: `var(${THREAT_COLOR_PROPERTY})`, boxShadow: HALO_SWATCH_SHADOW }}
      />
      <Trans>this threat</Trans>
    </span>
    <span className="ml-auto">
      <Trans>Ctrl or Cmd and the wheel zoom the graph</Trans>
    </span>
  </div>
);
