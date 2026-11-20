import type { Point } from './column-graph-geometry';

/** Graph units, not pixels: the view is fitted to the drawing, so these only set relative sizes. */
export const NODE_RADIUS = 22;
export const GLYPH_SIZE = 20;
export const LABEL_OFFSET = 7;
/**
 * A label is sized with the node it names, so the two keep their proportions at any zoom, down to the
 * zoom where it would read smaller than `MIN_TEXT_SCALE` of its size: past it, the text stops shrinking.
 */
export const MIN_TEXT_SCALE = 0.8;
export const LABEL_TEXT = 12;
export const SUBLABEL_TEXT = 10;
const SUBLABEL_GAP = 3;
/** How much further down a highlighted name pushes the type line, clearing the pill under the name. */
const HIGHLIGHT_SHIFT = 3;
/** The tallest a caption runs, highlighted name and type line, at a text scale of one. */
export const CAPTION_HEIGHT = LABEL_TEXT + SUBLABEL_GAP + HIGHLIGHT_SHIFT + SUBLABEL_TEXT;
/**
 * A label is painted at a size divided by the zoom, so an unbounded zoom out asks the canvas for
 * text thousands of pixels tall and hangs the tab.
 */
export const MIN_ZOOM = 0.3;
const LABEL_PILL_PADDING = 5;
const LABEL_PILL_HEIGHT = 16;
/** A name longer than this is cut: the whole of it is one click away. */
const MAX_LABEL_WIDTH = 150;
export const HALO_GAP = 6;
export const HALO_WIDTH = 4;
/** Read against the card behind it, like the tint, which is why it is not one value. */
export const HALO_ALPHA = { light: 0.3, dark: 0.7 };
export const ARROW_LENGTH = 8;
const ARROW_HALF_WIDTH = 3.4;
export const LINK_WIDTH = 1.6;

/**
 * A node's colour is laid over the surface at this opacity, rather than as a colour of its
 * own: the tint has to sit on whichever surface the theme puts behind it, which no single token does.
 */
export const TINT_ALPHA = { light: 0.09, dark: 0.22 };

/** At a reduced opacity, so a link reads under the nodes it joins, which carry the brand colour at full strength. */
export const LINK_COLOR_PROPERTY = '--fds-color-filigran-brand-primary';
export const LINK_INK_ALPHA = 0.7;
// eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy
export const LINK_INK = `color-mix(in srgb, var(${LINK_COLOR_PROPERTY}) ${LINK_INK_ALPHA * 100}%, transparent)`;

/** The page's own node is haloed in the label colour, never the accent, which is the selection's. */
const MARKED_HALO_PROPERTY = '--fds-text-default-primary';
export const MARKED_HALO_ALPHA = 0.55;
// eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy
export const MARKED_HALO_INK = `color-mix(in srgb, var(${MARKED_HALO_PROPERTY}) ${MARKED_HALO_ALPHA * 100}%, transparent)`;

/**
 * A lucide glyph as canvas primitives, on lucide's own 24x24 box and in its own node vocabulary. The
 * React components cannot serve here: a canvas painter needs the geometry, not an element, and lucide
 * publishes it only through per-icon deep imports.
 */
export type GlyphPrimitive =
  | { shape: 'path', d: string }
  | { shape: 'rect', x: number, y: number, width: number, height: number, rx: number }
  | { shape: 'circle', cx: number, cy: number, r: number }
  | { shape: 'line', x1: number, y1: number, x2: number, y2: number };

const GLYPH_BOX = 24;

/** Canvas takes resolved colours, read from the document's own custom properties. */
export const readCanvasColor = (property: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return value === '' ? fallback : value;
};

/** The context is saved and restored, so the caller's stroke width and transform survive the call. */
export const paintGlyphPrimitives = (
  ctx: CanvasRenderingContext2D,
  primitives: ReadonlyArray<GlyphPrimitive>,
  x: number,
  y: number,
  size: number,
  color: string,
  /** In the glyph's own 24x24 box, as lucide's `stroke-width`. */
  lineWidth = 2,
): void => {
  const scale = size / GLYPH_BOX;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const primitive of primitives) {
    if (primitive.shape === 'path') {
      ctx.stroke(new Path2D(primitive.d));
    } else if (primitive.shape === 'rect') {
      ctx.beginPath();
      ctx.roundRect(primitive.x, primitive.y, primitive.width, primitive.height, primitive.rx);
      ctx.stroke();
    } else if (primitive.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(primitive.cx, primitive.cy, primitive.r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(primitive.x1, primitive.y1);
      ctx.lineTo(primitive.x2, primitive.y2);
      ctx.stroke();
    }
  }
  ctx.restore();
};

export const fitLabel = (ctx: CanvasRenderingContext2D, label: string, maxWidth: number): string => {
  if (ctx.measureText(label).width <= maxWidth) {
    return label;
  }
  let kept = label;
  while (kept.length > 1 && ctx.measureText(`${kept}…`).width > maxWidth) {
    kept = kept.slice(0, -1);
  }
  return `${kept}…`;
};

export const paintArrowHead = (ctx: CanvasRenderingContext2D, tip: Point, direction: Point): void => {
  const tailX = tip.x - direction.x * ARROW_LENGTH;
  const tailY = tip.y - direction.y * ARROW_LENGTH;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tailX - direction.y * ARROW_HALF_WIDTH, tailY + direction.x * ARROW_HALF_WIDTH);
  ctx.lineTo(tailX + direction.y * ARROW_HALF_WIDTH, tailY - direction.x * ARROW_HALF_WIDTH);
  ctx.closePath();
  ctx.fill();
};

export interface HaloInk {
  color: string,
  alpha: number,
}

/** A ring `HALO_GAP` off the node's outline, round, or square with `corner` when one is given. */
export const paintHalo = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  corner: number | null,
  ink: HaloInk,
): void => {
  const opacity = ctx.globalAlpha;
  const reach = radius + HALO_GAP;
  ctx.beginPath();
  if (corner === null) {
    ctx.arc(x, y, reach, 0, Math.PI * 2);
  } else {
    ctx.roundRect(x - reach, y - reach, reach * 2, reach * 2, corner + HALO_GAP);
  }
  ctx.lineWidth = HALO_WIDTH;
  ctx.strokeStyle = ink.color;
  ctx.globalAlpha = opacity * ink.alpha;
  ctx.stroke();
  ctx.globalAlpha = opacity;
};

/** Laid over the surface rather than mixed into it, so the tint follows whatever theme is on. */
export const paintTintedDisc = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  surface: string,
  tintAlpha: number,
): void => {
  const opacity = ctx.globalAlpha;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity * tintAlpha;
  ctx.fill();
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
};

export interface NodeCaption {
  name: string,
  /** A CSS font weight. */
  weight: string,
  nameInk: string,
  /** The fill of a pill drawn under the name, which then takes `nameInk` over it. */
  highlight: string | null,
  /** Left out when empty. */
  type: string,
  typeInk: string,
}

/**
 * The node's name, then its type a line below, centred on `x` from `top`. Returns where the type line
 * starts, or `null` when there is none, for a caller adding a line of its own under it.
 */
export const paintNodeCaption = (ctx: CanvasRenderingContext2D, x: number, top: number, unit: number, caption: NodeCaption): number | null => {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
  ctx.font = `${caption.weight} ${LABEL_TEXT * unit}px sans-serif`;
  const name = fitLabel(ctx, caption.name, MAX_LABEL_WIDTH * unit);
  if (caption.highlight !== null) {
    const pillWidth = ctx.measureText(name).width + LABEL_PILL_PADDING * 2 * unit;
    const pillHeight = LABEL_PILL_HEIGHT * unit;
    ctx.beginPath();
    ctx.roundRect(x - pillWidth / 2, top - 2 * unit, pillWidth, pillHeight, 4 * unit);
    ctx.fillStyle = caption.highlight;
    ctx.fill();
  }
  ctx.fillStyle = caption.nameInk;
  ctx.fillText(name, x, top);

  if (caption.type === '') {
    return null;
  }
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS font shorthand, not copy
  ctx.font = `400 ${SUBLABEL_TEXT * unit}px sans-serif`;
  ctx.fillStyle = caption.typeInk;
  const typeTop = top + (LABEL_TEXT + SUBLABEL_GAP + (caption.highlight === null ? 0 : HIGHLIGHT_SHIFT)) * unit;
  ctx.fillText(fitLabel(ctx, caption.type, MAX_LABEL_WIDTH * unit), x, typeTop);
  return typeTop;
};
