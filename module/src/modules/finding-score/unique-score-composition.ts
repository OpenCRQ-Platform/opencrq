import type { SeverityBand } from './bands';
import { resolveSeverityBand, truncateScore } from './bands';
import { computeUniqueScore } from './unique-score';

export interface UniqueScoreLevel {
  /** The truncated score the level's findings display. */
  score: number,
  band: SeverityBand,
  assetCount: number,
  /** How many assets at the worst finding's exact score the level weighs as: `Σ exp(score − worst)`. */
  equivalent: number,
}

export interface UniqueScoreComposition {
  worst: number,
  /** Highest level first. */
  levels: Array<UniqueScoreLevel>,
  equivalentSum: number,
  breadth: number,
  /** `computeUniqueScore` over the same scores, so it equals a persisted score read from them. */
  unrounded: number,
}

/** A reduction rather than a spread, which a CVE on a few hundred thousand assets would push past the argument limit. */
const highestOf = (scores: ReadonlyArray<number>): number => scores.reduce((highest, score) => Math.max(highest, score), -Infinity);

const sumOfEquivalents = (scores: ReadonlyArray<number>, worst: number): number => scores
  .toSorted((left, right) => right - left)
  .reduce((sum, score) => sum + Math.exp(score - worst), 0);

/**
 * The terms of a unique score. Each level holds the scores of one truncated figure; the total sums
 * them in the order `computeUniqueScore` does, so `worst + ln(equivalentSum)` is its result to the
 * last bit. Null when no member is scored.
 */
export const explainUniqueScore = (
  levels: ReadonlyArray<{ scores: ReadonlyArray<number>, assetCount: number }>,
): UniqueScoreComposition | null => {
  const scores = levels.flatMap((level) => level.scores);
  const unrounded = computeUniqueScore(scores);
  if (unrounded === null) {
    return null;
  }
  const worst = highestOf(scores);
  const equivalentSum = sumOfEquivalents(scores, worst);
  return {
    worst,
    levels: levels
      .flatMap((level) => (level.scores.length === 0 ? [] : [{ ...level, score: truncateScore(highestOf(level.scores)) }]))
      .toSorted((left, right) => right.score - left.score)
      .map((level) => ({
        score: level.score,
        band: resolveSeverityBand(level.score),
        assetCount: level.assetCount,
        equivalent: sumOfEquivalents(level.scores, worst),
      })),
    equivalentSum,
    breadth: Math.log(equivalentSum),
    unrounded,
  };
};
