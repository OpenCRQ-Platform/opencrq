import type { ChipSeverity } from '@filigran/design-system';

/**
 * The colour a tinted surface borrows, in the chips' own severity vocabulary so a tile never
 * disagrees with the chip it holds. `ee` is excluded: the design system paints it from the tonic
 * family, outside the feedback families the crosswalk below reads.
 */
type TileSeverity = Exclude<ChipSeverity, 'ee'>;

export type TileTone = TileSeverity | 'brand';

/** The design system's own crosswalk from a chip severity to the feedback family it is painted in. */
const TONE_FAMILY: Record<TileSeverity, string> = {
  neutral: 'neutral',
  info: 'info',
  low: 'success',
  medium: 'alert',
  high: 'warning',
  critical: 'error',
};

interface TilePaint {
  /** The translucent fill, also the stop the wash starts from. */
  fill: string,
  /** An icon on the fill, which needs 3:1 and is the shade the findings panel tiles already take. */
  glyph: string,
  /** Words on the fill or beside it, which need 4.5:1: the -tertiary token, repointed per theme. */
  text: string,
}

export const tileTonePaint = (tone: TileTone): TilePaint => {
  if (tone === 'brand') {
    const brand = 'var(--fds-color-filigran-brand-primary)';
    return { fill: 'var(--fds-color-filigran-brand-primary-transparency-10)', glyph: brand, text: brand };
  }
  const family = TONE_FAMILY[tone];
  return {
    fill: `var(--fds-color-feedback-${family}-secondary-transparency-30)`,
    glyph: `var(--fds-color-feedback-${family}-primary)`,
    text: `var(--fds-color-feedback-${family}-tertiary)`,
  };
};

/**
 * The accent wash a header panel carries, as a background image layered over the surface's own
 * colour. It dies out before the middle, so the readings on the right stay on the plain surface.
 *
 * Whatever carries it must also set `background-origin: border-box`. The default origin is the
 * padding box while the clip is the border box, so the image tiles into the border ring and prints
 * the gradient's first column down the right edge and its first row along the bottom one.
 */
/* eslint-disable lingui/no-unlocalized-strings -- a CSS value, not copy */
export const tileToneWash = (tone: TileTone): string => (
  `linear-gradient(135deg, ${tileTonePaint(tone).fill} 0%, transparent 60%)`
);
/* eslint-enable lingui/no-unlocalized-strings */
