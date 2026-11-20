import { COVERAGE_BUCKETS, COVERAGE_COEFFICIENTS, STRENGTH_BY_RUNG, STRENGTH_RUNGS } from '@app/module/client';
import type { CoverageBucket, StrengthRung } from '@app/module/client';
import { roundPercentPoints } from '@app/utils/decimals';
import type { CapabilityAssessment } from '../types/capability';
import { formatPointsAsPercent } from '../../../../utils/format-number';

// `not-deployed` is the L0 declaration itself and reads as such; `none` is a deployed control
// whose declared coverage leaves it with no effect. Both score 0, but they say different things.
export type EffectivenessBand = 'not-deployed' | 'none' | 'marginal' | 'moderate' | 'solid' | 'strong';

interface SoloEffectiveness {
  /** Effectiveness score (0..1): how fully the control is deployed on its two declared axes. */
  score: number,
  band: EffectivenessBand,
}

// Strength axis normalised so the top rung (L3 / Master) scores 1.0. We reuse the engine's
// strength mods as the rung ladder, divided by the L3 ceiling, so the gauge stays tied to
// the same knobs without re-encoding a separate scale. L0 (capability absent) scores 0.
const STRENGTH_CEILING = STRENGTH_BY_RUNG.L3;

const strengthScore = (rung: StrengthRung): number =>
  (rung === 'L0' ? 0 : STRENGTH_BY_RUNG[rung] / STRENGTH_CEILING);

const toBand = (score: number): EffectivenessBand => {
  if (score <= 0) {
    return 'none';
  }
  if (score <= 0.3) {
    return 'marginal';
  }
  if (score <= 0.55) {
    return 'moderate';
  }
  if (score <= 0.8) {
    return 'solid';
  }
  return 'strong';
};

/**
 * Deployment effectiveness of a single control: how fully it is rolled out across the two axes
 * the tenant controls: strength (rung) times coverage (bucket). This is intentionally independent of
 * the catalogue prior classes and of any risk-scenario context, both of which only enter the
 * susceptibility engine downstream. Master + Full scores 1.0; a missing rung (L0) or no coverage
 * scores 0.
 */
export const computeSoloEffectiveness = (
  assessment: Pick<CapabilityAssessment, 'strengthRung' | 'coverageBucket'>,
): SoloEffectiveness => {
  const score = strengthScore(assessment.strengthRung) * COVERAGE_COEFFICIENTS[assessment.coverageBucket];
  if (assessment.strengthRung === 'L0') {
    return { score, band: 'not-deployed' };
  }
  return { score, band: toBand(score) };
};

/** The score in whole percentage points, the figures' and the lifeline's alike so they never disagree. */
export const effectivenessPoints = (score: number): number => roundPercentPoints(score, 0);

export const formatEffectivenessPercent = (score: number): string => formatPointsAsPercent(effectivenessPoints(score), 0);

/** Compares the band as well as the score, since `not-deployed` and `none` both score 0. */
export const isSameEffectiveness = (a: SoloEffectiveness, b: SoloEffectiveness): boolean =>
  a.band === b.band && a.score === b.score;

export interface EffectivenessGridCell {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  band: EffectivenessBand,
}

/** Every declarable pair, rows from the top rung down so strength reads upward, columns by coverage. */
export const effectivenessGrid = (): Array<Array<EffectivenessGridCell>> =>
  [...STRENGTH_RUNGS].reverse().map((strengthRung) => COVERAGE_BUCKETS.map((coverageBucket) => ({
    strengthRung,
    coverageBucket,
    band: computeSoloEffectiveness({ strengthRung, coverageBucket }).band,
  })));
