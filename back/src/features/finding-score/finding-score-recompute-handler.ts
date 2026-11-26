import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { findingScoreRunProgress } from './finding-score-run-progress';

const { logTrace } = createLogger({ engine: 'job-runtime' });

export const findingScoreRecomputeHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('finding-score recompute must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const summary = await services.findingScore.recomputeFindingScores({
    scoreHistoryRetentionDays: config().recompute.score_history_retention_days,
    signal: ctx.signal,
  });
  await ctx.updateProgress(findingScoreRunProgress(summary));
  logTrace('Finding scores recomputed', { tenantId: ctx.tenantId, ...summary });
};
