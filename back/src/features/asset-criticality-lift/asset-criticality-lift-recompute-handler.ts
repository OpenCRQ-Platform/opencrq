import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { createLogger } from '../../utils/logger';

const { logTrace } = createLogger({ engine: 'job-runtime' });

export const assetCriticalityLiftRecomputeHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('asset criticality lift recompute must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const { lifted, changed } = await services.supportingAssets.recomputeCriticalityLifts();
  logTrace('Asset criticality lifts recomputed', { tenantId: ctx.tenantId, lifted, changed });
};
