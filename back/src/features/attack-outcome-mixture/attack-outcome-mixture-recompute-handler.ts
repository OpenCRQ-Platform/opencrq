import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { createLogger } from '../../utils/logger';

const { logTrace } = createLogger({ engine: 'job-runtime' });

export const attackOutcomeMixtureRecomputeHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('attack outcome mixture recompute must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const { written, removed, unchanged } = await services.attackOutcomes.recomputeAttackOutcomeMixtures();
  logTrace('Attack outcome mixtures recomputed', { tenantId: ctx.tenantId, written, removed, unchanged });
};
