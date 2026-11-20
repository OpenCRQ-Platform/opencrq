import { plural, t } from '@lingui/core/macro';
import type { FunctionComponent, MouseEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ExposureFlow, PositionedNode, SankeyLayout } from '../exposure-flow-utils';
import { DEFAULT_SANKEY_GEOMETRY, layoutSankey, reachableNodeIds, sankeyGeometryForWidth } from '../exposure-flow-utils';
import { chartSeriesColors } from '../../../components/shared/chart-utils';
import { formatFractionAsPercent } from '../../../utils/format-number';
import { useTheme } from '../../../providers';
import { actorClassLabel } from '../../threats';

const RESIDUAL_VAR = 'hsl(var(--muted-foreground))';

/**
 * Column hue reuses the two chart series colours the dashboard already gives ApexCharts,
 * with `muted-foreground` for residual buckets.
 */
const nodeColor = (node: PositionedNode, index: number, count: number, series: Array<string>): string => {
  if (node.residualKind !== null) {
    return RESIDUAL_VAR;
  }
  const base = node.column === 'actor' ? series[1] : series[0];
  const ramp = 92 - (index / Math.max(count - 1, 1)) * 40;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS colour expression, not copy
  return `color-mix(in srgb, ${base} ${Math.round(ramp)}%, hsl(var(--card)))`;
};

/**
 * Residual buckets carry no database name: the util hands over a discriminant and a count
 * so the text is built (and pluralised) here.
 */
const flowNodeLabel = (node: PositionedNode): string => {
  const folded = node.foldedCount;
  switch (node.residualKind) {
    case 'unattributed-actors':
      return t`Unattributed`;
    case 'unattributed-techniques':
      return t`No technique attributed`;
    case 'unallocated-drivers':
      return t`Unallocated`;
    case 'actor-tail':
      return plural(folded, { one: '# other actor', other: '# other actors' });
    case 'technique-tail':
      return plural(folded, { one: '# other technique', other: '# other techniques' });
    case 'driver-tail':
      return plural(folded, { one: '# other loss driver', other: '# other loss drivers' });
    case null:
      return node.actorClass === null ? node.label : actorClassLabel(node.actorClass);
  }
};

/**
 * Truncate at a FIXED font size against the width actually free. Letting SVG condense
 * glyph spacing (`textLength`) is what makes adjacent labels render at visibly different
 * sizes. The full label stays reachable through a `<title>`.
 */
const clip = (text: string, available: number, fontSize: number): string => {
  const max = Math.max(4, Math.floor(available / (fontSize * 0.55)));
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/**
 * Type scale borrowed from OpenAEV's command-center visualizations, which run captions at
 * 9.5px letterspaced and secondary text at 10px rather than at body size. The `txt-*` scale
 * has no rung between `txt-mini` (9px) and `txt-sub-content` (12px), so these stay numeric:
 * the same latitude every hand-rolled SVG viz needs, and the reason the chart components set
 * their own sizes too.
 */
const COLUMN_FONT = 9.5;
const LABEL_FONT = 11;
const VALUE_FONT = 11.5;
const META_FONT = 9.5;
const COLUMN_LETTER_SPACING = '0.08em';
const VALUE_CHAR_WIDTH = 6.4;
const PADDING = 8;
/** Breathing room between the value, the meta and the gate or share percentage. */
const META_GAP = 8;
/** Under this the meta is more ellipsis than text, so it is dropped instead. */
const MIN_META_WIDTH = 46;
/** Two rows at these offsets span 24px, so 26 is the smallest chip that can carry both. */
const TWO_ROW_MIN_HEIGHT = 26;

/**
 * A chip's destination. `href` is what makes it a real link (status bar, middle-click and
 * ctrl-click all come for free), while `navigate` keeps a plain click client-side.
 */
export interface FlowNodeLink {
  href: string,
  navigate: () => void,
}

interface SankeyFlowProps {
  flow: ExposureFlow,
  formatValue: (value: number) => string,
  /** `null` for a chip with nothing to open: every residual bucket, and an unresolved outcome. */
  linkForNode: (node: PositionedNode) => FlowNodeLink | null,
  /**
   * Short corroborating text for a node, rendered between its value and whatever occupies the
   * right of the row: the resistance gate on a technique, the share percentage elsewhere.
   * Dropped silently when the chip is too narrow to carry it legibly.
   */
  nodeMeta?: (node: PositionedNode) => string | null,
}

export const SankeyFlow: FunctionComponent<SankeyFlowProps> = ({ flow, formatValue, linkForNode, nodeMeta }) => {
  // Hover isolates the path through the diagram. This is purely a reading aid and is separate
  // from the click, which navigates: tracing where a number comes from and opening the entity
  // behind it are two different questions.
  const [focused, setFocused] = useState<string | null>(null);
  // Measured, not scaled: the geometry is rebuilt for the width available so the drawing fills
  // the card while the type stays at its literal size. Same ResizeObserver + rAF shape as
  // `badge-group`, which has the same "lay out against the real width" problem.
  const svgRef = useRef<SVGSVGElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    // The PARENT is measured on purpose. This svg's own width is capped by the geometry derived
    // from this measurement, so observing the svg itself would feed back and never grow.
    const container = svgRef.current?.parentElement ?? null;
    if (container === null) {
      return;
    }
    let frame: number | null = null;
    const measure = (): void => {
      frame = null;
      setAvailable(container.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const { effectiveTheme } = useTheme();
  const series = chartSeriesColors(effectiveTheme);
  const layout: SankeyLayout = layoutSankey(flow, sankeyGeometryForWidth(available));
  const { geometry, nodes, links } = layout;

  const lit = focused === null ? null : reachableNodeIds(flow.links, focused);
  const colorById = new Map<string, string>();
  for (const column of ['actor', 'outcome', 'technique', 'driver'] as const) {
    const columnNodes = nodes.filter((node) => node.column === column);
    columnNodes.forEach((node, index) => {
      colorById.set(node.id, nodeColor(node, index, columnNodes.length, series));
    });
  }

  const columnTitles = [t`Threat actor`, t`Attack outcome`, t`Technique chokepoint`, t`Loss driver`];

  // Let the browser handle any click it can do better than we can. A modified or
  // non-primary click means "open elsewhere", and preventing it would break the link.
  const activate = (link: FlowNodeLink) => (event: MouseEvent): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    link.navigate();
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      className="mx-auto block h-auto w-full"
      /*
       * A viewBox scales EVERYTHING with the element, so `w-full` with no cap stretched this
       * drawing to the full-width card and rendered 11px labels near 20px while every `txt-*`
       * class around them stayed put. The geometry is rebuilt for the measured width instead, and
       * capped here, so the drawing fills the card at exactly 1:1. `minWidth` holds the base width
       * as a floor, which is what forces a horizontal scroll on narrow screens rather than
       * shrinking the type into illegibility.
       */
      style={{ minWidth: DEFAULT_SANKEY_GEOMETRY.width, maxWidth: geometry.width }}
      role="img"
      aria-label={t`Exposure flow from threat actors through attack outcomes and techniques into loss drivers`}
    >
      <g>
        {columnTitles.map((title, index) => (
          <text
            key={title}
            x={geometry.columnX[index] + 1}
            y={12}
            fill="hsl(var(--muted-foreground))"
            style={{
              fontSize: COLUMN_FONT,
              textTransform: 'uppercase',
              letterSpacing: COLUMN_LETTER_SPACING,
            }}
          >
            {title}
          </text>
        ))}
        <text
          x={geometry.width - 1}
          y={12}
          textAnchor="end"
          fill="hsl(var(--muted-foreground))"
          style={{
            fontSize: COLUMN_FONT,
            textTransform: 'uppercase',
            letterSpacing: COLUMN_LETTER_SPACING,
          }}
        >
          {formatValue(flow.total)}
        </text>
      </g>

      <g>
        {links.map((link) => {
          const on = lit === null || (lit.has(link.source) && lit.has(link.target));
          return (
            <path
              key={`${link.source}->${link.target}`}
              d={link.path}
              fill={colorById.get(link.source) ?? RESIDUAL_VAR}
              opacity={lit === null ? 0.3 : on ? 0.68 : 0.05}
              className="transition-opacity"
            />
          );
        })}
      </g>

      <g>
        {nodes.map((node) => {
          const color = colorById.get(node.id) ?? RESIDUAL_VAR;
          const centerY = node.y + node.height / 2;
          const label = flowNodeLabel(node);
          const valueText = formatValue(node.value);
          const valueWidth = valueText.length * VALUE_CHAR_WIDTH;
          const twoRow = node.height >= TWO_ROW_MIN_HEIGHT;
          const labelAvailable = twoRow
            ? node.width - PADDING * 2
            : node.width - PADDING * 2 - valueWidth - 8;
          const share = formatFractionAsPercent(flow.total > 0 ? node.value / flow.total : 0, 0);
          const shareWidth = share.length * META_FONT * 0.62;
          const metaAvailable = node.width - PADDING * 2 - valueWidth - META_GAP * 2 - shareWidth;
          // Below this a meta string is all ellipsis, which reads as a rendering fault rather than
          // as omitted detail. Dropping it is the better failure.
          const meta = twoRow && metaAvailable >= MIN_META_WIDTH ? nodeMeta?.(node) ?? null : null;

          const link = linkForNode(node);
          const chip: ReactNode = (
            <>
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={4}
                fill={`color-mix(in srgb, ${color} 18%, hsl(var(--card)))`}
                stroke={color}
                strokeWidth={1}
              />
              <rect x={node.x} y={node.y} width={3} height={node.height} rx={1.5} fill={color} />

              <text
                x={node.x + PADDING}
                y={twoRow ? centerY - 3 : centerY + 4}
                fill="hsl(var(--foreground))"
                style={{ fontSize: LABEL_FONT }}
                // Underlines only inside an anchor: a chip with no destination has no `group`
                // ancestor, so the variant never matches.
                className="group-hover:underline"
              >
                <title>{label}</title>
                {clip(label, labelAvailable, LABEL_FONT)}
              </text>

              {twoRow ? (
                <>
                  <text
                    x={node.x + PADDING}
                    y={centerY + 9}
                    fill={color}
                    style={{ fontSize: VALUE_FONT, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {valueText}
                  </text>
                  {/*
                    Row 2 is the value on the left and the share on the right, so the middle
                    is free. The label row is deliberately left alone: the columns are sized to fit
                    their longest labels without truncating, and reserving space up there would
                    undo that.
                  */}
                  {meta !== null && (
                    <text
                      x={node.x + PADDING + valueWidth + META_GAP}
                      y={centerY + 9}
                      fill="hsl(var(--muted-foreground))"
                      style={{ fontSize: META_FONT }}
                    >
                      {clip(meta, metaAvailable, META_FONT)}
                    </text>
                  )}
                  <text
                    x={node.x + node.width - PADDING}
                    y={centerY + 9}
                    textAnchor="end"
                    fill="hsl(var(--muted-foreground))"
                    style={{ fontSize: META_FONT }}
                  >
                    {share}
                  </text>
                </>
              ) : (
                <text
                  x={node.x + node.width - PADDING}
                  y={centerY + 4}
                  textAnchor="end"
                  fill={color}
                  style={{ fontSize: VALUE_FONT, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                >
                  {valueText}
                </text>
              )}
            </>
          );

          // On the wrapper, not the chip, so a residual bucket still isolates its own flow even
          // though it has nowhere to navigate to.
          const isolation = {
            opacity: lit !== null && !lit.has(node.id) ? 0.28 : 1,
            onMouseEnter: () => setFocused(node.id),
            onMouseLeave: () => setFocused(null),
            onFocus: () => setFocused(node.id),
            onBlur: () => setFocused(null),
          };

          if (link === null) {
            return (
              <g
                key={node.id}
                aria-label={`${label}, ${valueText}`}
                className="transition-opacity"
                {...isolation}
              >
                {chip}
              </g>
            );
          }
          return (
            <a
              key={node.id}
              href={link.href}
              aria-label={`${label}, ${valueText}`}
              tabIndex={0}
              className="group cursor-pointer transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={activate(link)}
              {...isolation}
            >
              {chip}
            </a>
          );
        })}
      </g>
    </svg>
  );
};
