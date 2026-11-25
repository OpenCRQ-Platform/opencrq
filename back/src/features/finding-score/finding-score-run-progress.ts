import type { FindingScoreRecomputeSummary } from '@app/module';

/**
 * The run's progress once the recompute commits: the walk as processed and expected totals, and what
 * it changed as a JSON message, so a reader of the run (the events it raises included) tells a pass
 * that moved a score, a band or a posture from one that moved nothing (`changedCount` 0).
 */
export const findingScoreRunProgress = (summary: FindingScoreRecomputeSummary) => ({
  processedTotal: summary.scored,
  expectedTotal: summary.scored,
  message: JSON.stringify(summary),
});
