import type { TechniqueClaimLane } from '@app/module/client';
import { readCvssMetrics } from '@app/module/client';

export interface TechniqueScoreCell {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  score: number,
  /** Null for a susceptibility cell, which no finding holds. */
  evidenceId: string | null,
  source: 'finding' | 'susceptibility',
  lane: TechniqueClaimLane | null,
  /** Present on a susceptibility cell only. */
  susceptibility?: { rate: number, declared: boolean, expired: boolean, measuredOn: string | null },
}

export interface TechniqueScoreFinding {
  evidenceId: string,
  cveId: string,
  cvssVector: string,
  epss: number | null,
  knownExploited: boolean,
  access: number,
  threat: number,
  impact: number,
}

/** The finding holding a cell, or undefined when none does or the read could not describe it. */
export const holdingFindingOf = (
  cell: TechniqueScoreCell | null,
  findingsById: ReadonlyMap<string, TechniqueScoreFinding>,
): TechniqueScoreFinding | undefined => (cell?.evidenceId == null ? undefined : findingsById.get(cell.evidenceId));

/** A share as a percentage with up to one decimal, so a declared 12.6 % is not read as 13 %. */
export const ratePercent = (rate: number): number => Math.round(rate * 1000) / 10;

// eslint-disable-next-line lingui/no-unlocalized-strings -- CVSS 2.0 metric letter, not copy
const ACCESS_METRICS = ['AV', 'PR', 'Au', 'UI'];

export interface OpeningEvidence {
  accessMetrics: Array<{ metric: string, value: string }>,
  highComplexity: boolean,
  requirementsPresent: boolean,
}

export const openingEvidence = (cvssVector: string): OpeningEvidence => {
  const metrics = readCvssMetrics(cvssVector);
  const valueOf = (metric: string): string | undefined => metrics.find((entry) => entry.metric === metric)?.value;
  return {
    accessMetrics: metrics.filter((entry) => ACCESS_METRICS.includes(entry.metric)),
    highComplexity: valueOf('AC') === 'H',
    requirementsPresent: valueOf('AT') === 'P',
  };
};
