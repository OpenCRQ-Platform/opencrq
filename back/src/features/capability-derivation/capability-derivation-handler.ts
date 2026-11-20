import type { EventOrigin, JobContext, JobHandler, PostureCrossing } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { newError } from '@app/utils';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { CRQ_LEVERS_BOOKING_JOB } from '../crq-indicators/crq-levers-booking-handler';

const { logFromError, logTrace } = createLogger({ feature: 'capability-derivation' });

const bookLevers = async (ctx: JobContext, origin: EventOrigin, crossings: ReadonlyArray<PostureCrossing>): Promise<void> => {
  if (crossings.length === 0) {
    return;
  }
  // Queue work goes through the shared instance: on `runDb` it would subscribe this kind to `jobs`.
  // The crossings are committed already and a retry would find none, so a failure is logged, not thrown.
  await createServices([...allServiceDefinitions], dbEngine.db).withOrigin(origin).jobs.enqueueJob({
    kind: CRQ_LEVERS_BOOKING_JOB,
    tenantId: ctx.tenantId,
    payload: { crossings: [...crossings] },
    triggeredBy: 'event',
    interactive: ctx.interactive,
  }).catch((error: unknown) => {
    logFromError(error, 'Could not book the levers of the controls a derivation moved', { tenantId: ctx.tenantId });
  });
};

/**
 * Rewrites the tenant's controls from the Drata mirror and the published compliance assessments,
 * then their per-technique test results from OpenAEV's. The results go second because they are told
 * what the first pass moved: one booking run reprices those controls anyway in every scope the move
 * reaches, so their stored results there are marked as the ones their levers are priced on.
 *
 * Its read set includes the assessment rows it writes, since a manual axis must survive the write:
 * its own writes carry its kind and never wake it, a user's declaration does and finds nothing to
 * change, which is what makes the loop converge.
 */
export const capabilityDerivationHandler: JobHandler = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }
  if (!ctx.runDb) {
    // Falling back to the shared instance would run unobserved, and the subscription would go stale.
    throw newError('capability derivation must run as an observed job', { kind: ctx.kind });
  }
  const origin: EventOrigin = { type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive };
  const services = createServices([...allServiceDefinitions], ctx.runDb).withOrigin(origin);
  const derived = await services.controlCapabilities.rederiveAssessments();
  logTrace('Capability assessments derived', { tenantId: ctx.tenantId, written: derived.written, cleared: derived.cleared, crossed: derived.crossings.length });
  // The posture is committed already and a retry would find it unmoved, so its moves are booked
  // even when the measurement fails; the retry measures again against the results still booked.
  const measured = await services.controlValidation.measureTechniqueTestResults({ now: new Date(), crossings: derived.crossings })
    .catch(async (error: unknown) => {
      await bookLevers(ctx, origin, derived.crossings);
      throw error;
    });
  logTrace('Technique test results measured', { tenantId: ctx.tenantId, written: measured.written, deleted: measured.deleted, crossed: measured.crossings.length });
  await bookLevers(ctx, origin, [...derived.crossings, ...measured.crossings]);
};
