import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { createLogger } from '../../utils/logger';

const { logTrace } = createLogger({ engine: 'job-runtime' });

/**
 * The daily booking is the only one carrying an occurrence date, which is what separates a run the
 * clock owes from a run a change asked for: only the former folds every actor again.
 */
export const threatActivityRecomputeHandler: JobHandler<{ date?: string }> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('threat activity recompute must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const { scope, rebuilt, folded } = await services.threatActivity.recomputeActivity({
    now: new Date(),
    isDailyBooking: typeof ctx.payload.date === 'string',
  });
  logTrace('Threat activity recomputed', { tenantId: ctx.tenantId, scope, rebuilt, folded });
};
