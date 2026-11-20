import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';

const { logTrace } = createLogger({ feature: 'proven-posture-record' });

/**
 * The integration settings are read before the deployment credentials are checked, so that binding
 * OpenAEV is in the read set and wakes the job even on a run the credentials turned away.
 */
export const provenPostureRecordHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    throw newError('proven posture recording must run as an observed job', { kind: ctx.kind });
  }
  const services = createServices([...allServiceDefinitions], ctx.runDb)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });
  const settings = await services.integrationSettings.getIntegrationSettings('openaev');
  if (!config().connectors?.openaev?.[ctx.tenantId] || !settings?.serviceAccountId) {
    return;
  }
  const startedAt = Date.now();
  const recorded = await services.controlValidation.recordProvenPostureHistory({ now: new Date(startedAt), signal: ctx.signal });
  logTrace('Proven posture recorded', { tenantId: ctx.tenantId, ...recorded, durationMs: Date.now() - startedAt });
};
