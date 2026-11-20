import { weighsOnOutcome } from './relevance-proof-utils';

interface ThreatOutcomeScore {
  attackOutcomeId: string,
  outcomeName: string,
  score: number,
}

/**
 * The outcomes of a threat with enough evidence to weigh, highest percentage first, each marked when
 * the threat weighs on it.
 */
export const rankOutcomesForThreat = <T extends ThreatOutcomeScore>(
  outcomes: ReadonlyArray<T>,
): Array<T & { weighsOn: boolean }> => outcomes
  .map((outcome) => ({ ...outcome, weighsOn: weighsOnOutcome({ probability: outcome.score, evidenceSufficient: true }) }))
  .sort((a, b) => (b.score - a.score) || a.outcomeName.localeCompare(b.outcomeName));
