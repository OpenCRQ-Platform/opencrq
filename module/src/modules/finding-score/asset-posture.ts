import type { SeverityBand } from './bands';
import { SEVERITY_BANDS } from './bands';

/** No asset loses more than its whole posture, so it never goes below zero. */
const POINTS_CEILING = 100;

/** What each applicable finding takes off the posture, by the band its exploitability falls in. */
export const POSTURE_POINTS_PER_FINDING: Record<SeverityBand, number> = {
  critical: 0.07,
  high: 0.02,
  medium: 0.005,
  low: 0.005,
};

/** Past this many, a medium or a low finding takes nothing more, so a long tail cannot outweigh the worst one. */
export const POSTURE_TAIL_CAP = 2000;

/** The arithmetic behind a posture, term by term, so a surface can replay it without restating the rule. */
export interface AssetPostureComposition {
  /** Only the bands with a finding counted, the count already cut at the tail cap. */
  tail: Array<{ band: SeverityBand, count: number, pointsPerFinding: number }>,
  tailPoints: number,
  /** Before the ceiling. */
  removedPoints: number,
  capped: boolean,
  unrounded: number,
}

export interface AssetPosture {
  score: number,
  /** Its exploitability, its impact and its score, all three on 0 to 100. */
  worstFinding: {
    evidenceId: string,
    name: string,
    exploitability: number,
    impact: number,
    score: number,
  },
  countsByBand: Record<SeverityBand, number>,
  composition: AssetPostureComposition,
}

/**
 * How a line's worst finding compares with the previous line's. `worst` is a change the two lines
 * cannot explain apart: the previous line has no recorded cause, or only the bands' mix moved.
 */
export type AssetPostureChange =
  | { kind: 'first' }
  | { kind: 'regained' }
  | { kind: 'worst' }
  | { kind: 'exploitability', from: number }
  | { kind: 'tail', fromApplicable: number, toApplicable: number }
  | { kind: 'newWorst' }
  | { kind: 'resolved', resolvedName: string };

export interface AssetPostureCause {
  /** Null once the finding's evidence is gone. */
  worstFinding: { evidenceId: string, name: string } | null,
  /** On 0 to 100. */
  worstExploitability: number,
  countsByBand: Record<SeverityBand, number>,
  /** Null when the worst finding is gone, or when the line opens the read without its predecessor. */
  change: AssetPostureChange | null,
}

export interface AssetPostureHistoryLine {
  at: Date,
  /** Null from the moment the asset lost its posture until it gets one back. */
  score: number | null,
  /** Null on a lost posture, and on a line journaled before causes were. */
  cause: AssetPostureCause | null,
}

const countedForBand = (band: SeverityBand, count: number): number =>
  (band === 'medium' || band === 'low' ? Math.min(count, POSTURE_TAIL_CAP) : count);

/**
 * An asset's posture from 0 to 100, 100 being safe, read from the exploitability of its applicable
 * findings alone: neither the asset criticality nor the flaw's impact enters it.
 *
 * The worst finding takes its exploitability, out of 100, off 100, and every applicable finding,
 * the worst included, takes a fixed amount more by its band.
 */
export const explainAssetPosture = (
  worstExploitability: number,
  counts: Record<SeverityBand, number>,
): { score: number, composition: AssetPostureComposition } => {
  const tail = SEVERITY_BANDS
    .map((band) => ({ band, count: countedForBand(band, counts[band]), pointsPerFinding: POSTURE_POINTS_PER_FINDING[band] }))
    .filter((term) => term.count > 0);
  const tailPoints = tail.reduce((total, term) => total + term.count * term.pointsPerFinding, 0);
  const removedPoints = worstExploitability + tailPoints;
  const unrounded = 100 - Math.min(POINTS_CEILING, removedPoints);
  return {
    score: Math.round(unrounded),
    composition: { tail, tailPoints, removedPoints, capped: removedPoints > POINTS_CEILING, unrounded },
  };
};

export const computeAssetPosture = (worstExploitability: number, counts: Record<SeverityBand, number>): number =>
  explainAssetPosture(worstExploitability, counts).score;
