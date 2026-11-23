import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { createLogger } from '../../utils/logger';

const { logTrace } = createLogger({ engine: 'job-runtime' });

export const dependencyRulesApplyHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and a sync would no longer wake it.
    throw newError('dependency rules apply must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const { rules, inserted, updated, deleted } = await services.assetDependencies.applyDependencyRules();
  logTrace('Dependency rules applied', { tenantId: ctx.tenantId, rules, inserted, updated, deleted });
};
