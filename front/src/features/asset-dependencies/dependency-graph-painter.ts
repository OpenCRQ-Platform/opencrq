import type { GlyphPrimitive } from '../../components/shared/column-graph-paint';
import type { CategoryGlyph } from './dependency-graph-utils';
import { paintGlyphPrimitives } from '../../components/shared/column-graph-paint';

/** The primary asset carries no category, so it is drawn from a glyph no category maps to. */
export const PRIMARY_ASSET_GLYPH = 'building-2';
/** Distinct from `globe`, which a web application already takes. */
export const INTERNET_GLYPH = 'earth';
/** The providers of one asset that the depth left undrawn, standing for all of them at once. */
export const AGGREGATE_GLYPH = 'layers';
export const MUTUAL_GLYPH = 'arrow-right-left';
export const SHIELD_GLYPH = 'shield';
export const CROWN_GLYPH = 'crown';
/** Lucide's `rss`, the antenna of an internet-facing asset. */
export const ANTENNA_GLYPH = 'rss';
export const LIFT_GLYPH = 'arrow-up';

type CanvasGlyph =
  | CategoryGlyph
  | typeof PRIMARY_ASSET_GLYPH
  | typeof INTERNET_GLYPH
  | typeof AGGREGATE_GLYPH
  | typeof MUTUAL_GLYPH
  | typeof SHIELD_GLYPH
  | typeof CROWN_GLYPH
  | typeof ANTENNA_GLYPH
  | typeof LIFT_GLYPH;

/* eslint-disable lingui/no-unlocalized-strings -- SVG path data, not copy */
/** On lucide's own 24x24 box (`lucide-react`, ISC). */
export const GLYPHS: Record<
  CanvasGlyph,
  Array<GlyphPrimitive>
> = {
  'arrow-right-left': [
    { shape: 'path', d: 'm16 3 4 4-4 4' },
    { shape: 'path', d: 'M20 7H4' },
    { shape: 'path', d: 'm8 21-4-4 4-4' },
    { shape: 'path', d: 'M4 17h16' },
  ],
  'arrow-up': [
    { shape: 'path', d: 'm5 12 7-7 7 7' },
    { shape: 'path', d: 'M12 19V5' },
  ],
  shield: [
    { shape: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
  ],
  'shield-check': [
    { shape: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
    { shape: 'path', d: 'm9 12 2 2 4-4' },
  ],
  crown: [
    { shape: 'path', d: 'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z' },
    { shape: 'path', d: 'M5 21h14' },
  ],
  rss: [
    { shape: 'path', d: 'M4 11a9 9 0 0 1 9 9' },
    { shape: 'path', d: 'M4 4a16 16 0 0 1 16 16' },
    { shape: 'circle', cx: 5, cy: 19, r: 1 },
  ],
  layers: [
    { shape: 'path', d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z' },
    { shape: 'path', d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12' },
    { shape: 'path', d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' },
  ],
  earth: [
    { shape: 'path', d: 'M21.54 15H17a2 2 0 0 0-2 2v4.54' },
    { shape: 'path', d: 'M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17' },
    { shape: 'path', d: 'M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05' },
    { shape: 'circle', cx: 12, cy: 12, r: 10 },
  ],
  'building-2': [
    { shape: 'path', d: 'M10 12h4' },
    { shape: 'path', d: 'M10 8h4' },
    { shape: 'path', d: 'M14 21v-3a2 2 0 0 0-4 0v3' },
    { shape: 'path', d: 'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2' },
    { shape: 'path', d: 'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16' },
  ],
  server: [
    { shape: 'rect', x: 2, y: 2, width: 20, height: 8, rx: 2 },
    { shape: 'rect', x: 2, y: 14, width: 20, height: 8, rx: 2 },
    { shape: 'line', x1: 6, y1: 6, x2: 6.01, y2: 6 },
    { shape: 'line', x1: 6, y1: 18, x2: 6.01, y2: 18 },
  ],
  box: [
    { shape: 'path', d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' },
    { shape: 'path', d: 'm3.3 7 8.7 5 8.7-5' },
    { shape: 'path', d: 'M12 22V12' },
  ],
  cloud: [
    { shape: 'path', d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' },
  ],
  globe: [
    { shape: 'circle', cx: 12, cy: 12, r: 10 },
    { shape: 'path', d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' },
    { shape: 'path', d: 'M2 12h20' },
  ],
  network: [
    { shape: 'rect', x: 16, y: 16, width: 6, height: 6, rx: 1 },
    { shape: 'rect', x: 2, y: 16, width: 6, height: 6, rx: 1 },
    { shape: 'rect', x: 9, y: 2, width: 6, height: 6, rx: 1 },
    { shape: 'path', d: 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3' },
    { shape: 'path', d: 'M12 12V8' },
  ],
  smartphone: [
    { shape: 'rect', x: 5, y: 2, width: 14, height: 20, rx: 2 },
    { shape: 'path', d: 'M12 18h.01' },
  ],
  cpu: [
    { shape: 'path', d: 'M12 20v2' },
    { shape: 'path', d: 'M12 2v2' },
    { shape: 'path', d: 'M17 20v2' },
    { shape: 'path', d: 'M17 2v2' },
    { shape: 'path', d: 'M2 12h2' },
    { shape: 'path', d: 'M2 17h2' },
    { shape: 'path', d: 'M2 7h2' },
    { shape: 'path', d: 'M20 12h2' },
    { shape: 'path', d: 'M20 17h2' },
    { shape: 'path', d: 'M20 7h2' },
    { shape: 'path', d: 'M7 20v2' },
    { shape: 'path', d: 'M7 2v2' },
    { shape: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 2 },
    { shape: 'rect', x: 8, y: 8, width: 8, height: 8, rx: 1 },
  ],
  user: [
    { shape: 'path', d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' },
    { shape: 'circle', cx: 12, cy: 7, r: 4 },
  ],
  'app-window': [
    { shape: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
    { shape: 'path', d: 'M10 4v4' },
    { shape: 'path', d: 'M2 8h20' },
    { shape: 'path', d: 'M6 4v4' },
  ],
  brain: [
    { shape: 'path', d: 'M12 18V5' },
    { shape: 'path', d: 'M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4' },
    { shape: 'path', d: 'M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294' },
    { shape: 'path', d: 'M17.996 5.125a4 4 0 012.526 5.77' },
    { shape: 'path', d: 'M18 18a4 4 0 002-7.465' },
    { shape: 'path', d: 'M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517' },
    { shape: 'path', d: 'M6 18a4 4 0 01-2-7.465' },
    { shape: 'path', d: 'M6.004 5.125a4 4 0 00-2.526 5.77' },
  ],
  'git-branch': [
    { shape: 'path', d: 'M15 6a9 9 0 0 0-9 9V3' },
    { shape: 'circle', cx: 18, cy: 6, r: 3 },
    { shape: 'circle', cx: 6, cy: 18, r: 3 },
  ],
  shapes: [
    { shape: 'path', d: 'M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z' },
    { shape: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 1 },
    { shape: 'circle', cx: 17.5, cy: 17.5, r: 3.5 },
  ],
};
/* eslint-enable lingui/no-unlocalized-strings */

export const paintGlyph = (
  ctx: CanvasRenderingContext2D,
  glyph: CanvasGlyph,
  x: number,
  y: number,
  size: number,
  color: string,
  lineWidth?: number,
): void => paintGlyphPrimitives(ctx, GLYPHS[glyph], x, y, size, color, lineWidth);
