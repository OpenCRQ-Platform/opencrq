const UNIQUE_SCORE_CAP = 100;

/**
 * A soft maximum of a unique finding's scores, `min(100, max + ln(Σ exp(score_i − max)))`: never
 * below the worst finding, and a finding a few points under it barely counts, so a mass of low
 * findings cannot outweigh a severe one. Unrounded; `null` for a group with no scored finding.
 *
 * The same scores in any order give the same double: the sum runs over them sorted, since a stored
 * score that drifts by one ulp is rewritten and rings the doorbell.
 */
export const computeUniqueScore = (scores: ReadonlyArray<number>): number | null => {
  if (scores.length === 0) {
    return null;
  }
  const sorted = scores.toSorted((left, right) => right - left);
  const worst = sorted[0];
  const spread = sorted.reduce((sum, score) => sum + Math.exp(score - worst), 0);
  return Math.min(UNIQUE_SCORE_CAP, worst + Math.log(spread));
};
