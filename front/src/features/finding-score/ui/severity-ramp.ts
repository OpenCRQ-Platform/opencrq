import { t } from '@lingui/core/macro';
import type { SeverityBand } from '@app/module/client';
import { SEVERITY_BAND_MINIMUMS, SEVERITY_BANDS } from '@app/module/client';

export const severityBandLabel = (band: SeverityBand): string => {
  switch (band) {
    case 'critical': return t`Critical`;
    case 'high': return t`High`;
    case 'medium': return t`Medium`;
    case 'low': return t`Low`;
    default: return band;
  }
};

/** The numeric range that travels beside the word wherever a band is named in a legend. */
export const severityBandRange = (band: SeverityBand): string => {
  const index = SEVERITY_BANDS.indexOf(band);
  const highest = index === 0 ? 100 : SEVERITY_BAND_MINIMUMS[SEVERITY_BANDS[index - 1]] - 1;
  return `${SEVERITY_BAND_MINIMUMS[band]}-${highest}`;
};

/** An FDS feedback colour family, for a figure that reads a verdict rather than a severity band. */
export type FeedbackFamily = 'error' | 'warning' | 'alert' | 'success' | 'info';

/**
 * The FDS feedback family each band is painted in. One crosswalk, so a band's figure, its arc and
 * the wash a panel carries can never end up drawn from three different ramps.
 */
const BAND_FAMILY: Record<SeverityBand, FeedbackFamily> = {
  critical: 'error',
  high: 'warning',
  medium: 'alert',
  low: 'success',
};

export const severityBandFamily = (band: SeverityBand): FeedbackFamily => BAND_FAMILY[band];

/**
 * The colour a family, and a band through it, lends to a bare figure.
 *
 * The -tertiary feedback token, which the design system re-points per theme so all four
 * bands clear 4.5:1 on the page surfaces in both themes. The -primary fills do not (1.54:1 for
 * medium in light), hence tertiary.
 */
export const feedbackFigureColor = (family: FeedbackFamily): string => `var(--fds-color-feedback-${family}-tertiary)`;

export const severityBandFigureColor = (band: SeverityBand): string => feedbackFigureColor(BAND_FAMILY[band]);

/** A family's fill, for a bar, an arc or a border rather than for words: it only has to carry 3:1. */
export const feedbackFillColor = (family: FeedbackFamily): string => `var(--fds-color-feedback-${family}-primary)`;

export const severityBandFillColor = (band: SeverityBand): string => feedbackFillColor(BAND_FAMILY[band]);

/**
 * The accent wash a panel carries, as a background image layered over the surface's own colour.
 * It dies out before the middle, so whatever sits on the right stays on the plain surface.
 *
 * Whatever carries it must also set `background-origin: border-box`. The default origin is the
 * padding box while the clip is the border box, so the image tiles into the border ring and prints
 * the gradient's first column down the right edge and its first row along the bottom one.
 */
/* eslint-disable lingui/no-unlocalized-strings -- a CSS value, not copy */
export const feedbackWash = (family: FeedbackFamily): string => (
  `linear-gradient(135deg, var(--fds-color-feedback-${family}-secondary-transparency-30) 0%, transparent 60%)`
);

export const severityBandWash = (band: SeverityBand): string => feedbackWash(BAND_FAMILY[band]);
/* eslint-enable lingui/no-unlocalized-strings */
