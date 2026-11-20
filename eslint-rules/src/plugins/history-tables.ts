/**
 * The append-only history tables `app/no-distinct-on-subquery` reads a top-level `selectDistinctOn`
 * over, by their Drizzle export name: a latest row per key read from one of them sorts the whole
 * history it can see. Every table whose export name ends in `History` must be listed.
 */
export const historyTables = [
  'assetEvidenceHistory',
  'assetEvidenceVerdicts',
  'assetPostureHistory',
  'controlCapabilityAssessmentEvents',
  'controlProvenPostureHistory',
  'crqIndicatorRuns',
  'findingScoreHistory',
  'jobErrors',
  'jobLogs',
  'jobs',
  'tefEstimates',
  'uniqueFindingScoreHistory',
];
