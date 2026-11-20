import type { ThreatEntityType } from '@app/module/client';
import type { GlyphPrimitive } from '../../../components/shared/column-graph-paint';

/* eslint-disable lingui/no-unlocalized-strings -- SVG path data, not copy */
/** The glyphs `ThreatTypeIcon` draws, on lucide's own 24x24 box (`lucide-react`, ISC), for the canvas. */
export const THREAT_GLYPHS = {
  'diamond': [
    { shape: 'path', d: 'M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z' },
  ],
  'users': [
    { shape: 'path', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' },
    { shape: 'path', d: 'M16 3.128a4 4 0 0 1 0 7.744' },
    { shape: 'path', d: 'M22 21v-2a4 4 0 0 0-3-3.87' },
    { shape: 'circle', cx: 9, cy: 7, r: 4 },
  ],
  'chess-knight': [
    { shape: 'path', d: 'M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z' },
    { shape: 'path', d: 'M16.5 18c1-2 2.5-5 2.5-9a7 7 0 0 0-7-7H6.635a1 1 0 0 0-.768 1.64L7 5l-2.32 5.802a2 2 0 0 0 .95 2.526l2.87 1.456' },
    { shape: 'path', d: 'm15 5 1.425-1.425' },
    { shape: 'path', d: 'm17 8 1.53-1.53' },
    { shape: 'path', d: 'M9.713 12.185 7 18' },
  ],
  'layers': [
    { shape: 'path', d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z' },
    { shape: 'path', d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12' },
    { shape: 'path', d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' },
  ],
} satisfies Record<string, Array<GlyphPrimitive>>;
/* eslint-enable lingui/no-unlocalized-strings */

export const THREAT_TYPE_GLYPH: Record<ThreatEntityType, keyof typeof THREAT_GLYPHS> = {
  'intrusion-set': 'diamond',
  'threat-actor': 'users',
  'campaign': 'chess-knight',
};

/** What a fold stands for, several threats at once. */
export const FOLD_GLYPH = 'layers';
