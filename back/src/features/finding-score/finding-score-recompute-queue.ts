import type { allServiceDefinitions, createServices, EventOrigin } from '@app/module';
import { originTrigger } from '@app/module';
import { config } from '../../config';

// Declared here rather than in the feature barrel: importing that barrel activates the job
// runtime, which a router only wanting to enqueue has no business booting.
export const FINDING_SCORE_RECOMPUTE_JOB = 'finding-score-recompute';

type Services = ReturnType<ReturnType<typeof createServices<typeof allServiceDefinitions>>['withOrigin']>;

/**
 * A resync rewrites the asset the scores were derived from, so the scores are stale the moment it
 * returns. Enqueueing is a no-op when the job runtime is off: an http-only process has no worker
 * to pick the job up, and the daily run will catch up.
 */
export const requestFindingScoreRecompute = async (services: Services, origin: EventOrigin, tenantId: string): Promise<void> => {
  if (!config().jobs?.enabled) {
    return;
  }
  await services.jobs.enqueueJob({
    kind: FINDING_SCORE_RECOMPUTE_JOB,
    tenantId,
    payload: {},
    ...originTrigger(origin),
    // The resync that made them stale was a click, and the scores are what it was clicked for.
    interactive: true,
  });
};
