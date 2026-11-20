import type { PostureBand } from '@app/module/client';
import { postureBandForScore } from '@app/module/client';

export interface PostureCounts {
  success: number,
  failed: number,
}

export type PostureScoreResult =
  | { state: 'unmeasured' }
  | { state: 'no-data' }
  | { state: 'scored', score: number, band: PostureBand };

/**
 * OpenAEV's own posture score, recomputed here from the raw counts it reports rather than read back
 * as a number: `round(success / (success + failed) x 100)`, the formula its own gauge applies.
 * `counts` null means never measured (no gauge at all); `{ success: 0, failed: 0 }` means measured
 * with nothing yet validated — OpenAEV's own "-" state, distinct from a genuine 0% score.
 */
export const resolvePostureScore = (counts: PostureCounts | null): PostureScoreResult => {
  if (!counts) {
    return { state: 'unmeasured' };
  }
  const total = counts.success + counts.failed;
  if (total === 0) {
    return { state: 'no-data' };
  }
  const score = Math.round((counts.success / total) * 100);
  return { state: 'scored', score, band: postureBandForScore(score) };
};
