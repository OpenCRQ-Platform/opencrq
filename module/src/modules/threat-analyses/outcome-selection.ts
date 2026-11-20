import { OUTCOME_WEIGHT_THRESHOLD } from './outcome-counter/outcome-weight';

interface OutcomeProbabilityRow {
  analysisId: string,
  attackOutcomeId: string,
  probability: number,
}

interface OutcomeScoreRow {
  analysisId: string,
  attackOutcomeId: string,
  tenantId: string,
  score: number,
  isTop: boolean,
}

/**
 * One list-projection row per (analysis, outcome) the counter puts above `OUTCOME_WEIGHT_THRESHOLD`,
 * scored at its probability. Exactly one row per analysis carries `isTop`: the highest probability,
 * and among equals the first outcome name. That flag is what lets the unfiltered list read one row
 * per analysis straight from its index instead of grouping the tenant's scores per page.
 */
export const projectOutcomeScoreRows = (
  rows: Array<OutcomeProbabilityRow>,
  outcomeNameById: Map<string, string>,
  tenantId: string,
): Array<OutcomeScoreRow> => {
  const nameOf = (row: OutcomeProbabilityRow): string => outcomeNameById.get(row.attackOutcomeId) ?? '';
  const kept = rows.filter((row) => row.probability > OUTCOME_WEIGHT_THRESHOLD);
  const winnerByAnalysisId = new Map<string, OutcomeProbabilityRow>();
  for (const row of kept) {
    const incumbent = winnerByAnalysisId.get(row.analysisId);
    const wins = incumbent === undefined
      || row.probability > incumbent.probability
      || (row.probability === incumbent.probability && nameOf(row).localeCompare(nameOf(incumbent)) < 0);
    if (wins) {
      winnerByAnalysisId.set(row.analysisId, row);
    }
  }
  return kept.map((row) => ({
    analysisId: row.analysisId,
    attackOutcomeId: row.attackOutcomeId,
    tenantId,
    score: row.probability,
    isTop: winnerByAnalysisId.get(row.analysisId) === row,
  }));
};

/** Relevance descending, then name, then id: the order of the Relevant Threats tab. */
export const compareRelevantThreats = (
  first: { id: string, name: string, combinedRelevance: number },
  second: { id: string, name: string, combinedRelevance: number },
): number =>
  (second.combinedRelevance - first.combinedRelevance)
  || first.name.localeCompare(second.name)
  || first.id.localeCompare(second.id);
