import type { EventOrigin, JobHandler, PostureCrossing } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { dbEngine } from '../../engines/db';
import { enqueueLeversOnTenantCrossings } from './levers-recompute';

export const CRQ_LEVERS_BOOKING_JOB = 'crq-levers-booking';

export interface CrqLeversBookingPayload extends Record<string, unknown> {
  crossings: Array<PostureCrossing>,
}

/**
 * Resolves and books the levers an observed job's crossings owe. A run of its own because the
 * resolution reads the whole threat model, which must not join the observed job's read set.
 */
export const crqLeversBookingHandler: JobHandler<CrqLeversBookingPayload> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  const origin: EventOrigin = { type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive };
  const services = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(origin);
  await enqueueLeversOnTenantCrossings(services, origin, ctx.tenantId, ctx.payload.crossings);
};
