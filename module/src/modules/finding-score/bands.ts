/** Ordinal, hottest first. Sorting reads this order and never the alphabet. */
export const SEVERITY_BANDS = ['critical', 'high', 'medium', 'low'] as const;

export type SeverityBand = (typeof SEVERITY_BANDS)[number];

/** Lowest score each band accepts, on the finding score and never on CVSS. */
export const SEVERITY_BAND_MINIMUMS: Record<SeverityBand, number> = {
  critical: 90,
  high: 70,
  medium: 40,
  low: 0,
};

/**
 * Rendering truncates rather than rounds: the internal-exposure ceiling is published as 79, and
 * `100 x 0.4^(1/4)` is 79.53, which rounding would print as 80.
 */
export const truncateScore = (value: number): number => Math.trunc(value);

export const resolveSeverityBand = (score: number): SeverityBand => {
  if (score >= SEVERITY_BAND_MINIMUMS.critical) {
    return 'critical';
  }
  if (score >= SEVERITY_BAND_MINIMUMS.high) {
    return 'high';
  }
  return score >= SEVERITY_BAND_MINIMUMS.medium ? 'medium' : 'low';
};

export type PostureBand = 'strong' | 'moderate' | 'weak' | 'critical';

/**
 * The same four bands OpenAEV itself qualifies a posture score with, at the same cut-offs and under
 * the same names (`PostureScore.tsx`, `postureBandColor` in `usePostureScores.ts`): the two products
 * must not disagree on whether an asset is weak or moderate.
 */
export const POSTURE_BANDS: ReadonlyArray<PostureBand> = ['strong', 'moderate', 'weak', 'critical'];

const POSTURE_BAND_MINIMUMS: Record<PostureBand, number> = { strong: 75, moderate: 50, weak: 25, critical: 0 };

export const postureBandForScore = (score: number): PostureBand =>
  POSTURE_BANDS.find((band) => score >= POSTURE_BAND_MINIMUMS[band]) ?? 'critical';

/** The scores a band covers, as `75-100`. */
export const postureBandRange = (band: PostureBand): string => {
  const index = POSTURE_BANDS.indexOf(band);
  const highest = index === 0 ? 100 : POSTURE_BAND_MINIMUMS[POSTURE_BANDS[index - 1]] - 1;
  return `${POSTURE_BAND_MINIMUMS[band]}-${highest}`;
};

const POSTURE_SEVERITY_BAND: Record<PostureBand, SeverityBand> = {
  strong: 'low',
  moderate: 'medium',
  weak: 'high',
  critical: 'critical',
};

/**
 * The severity ramp runs the opposite way from posture (its worst band is a high score, posture's
 * worst is a low one), so a strong posture takes the band a low, safe finding score would, not the
 * band named "strong" would suggest by analogy. `critical` keeps its name on both ramps.
 */
export const postureSeverityBand = (band: PostureBand): SeverityBand => POSTURE_SEVERITY_BAND[band];
