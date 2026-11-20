import { jobRuntimeEngine } from '../../engines/job-runtime';
import { registerFeature } from '../features-manager';
import { CRQ_PRICE_RECOMPUTE_JOB, crqPriceRecomputeHandler } from './crq-price-recompute-handler';
import { crqSimulationHandler } from './crq-simulation-handler';
import { CRQ_LEVERS_BOOKING_JOB, crqLeversBookingHandler } from './crq-levers-booking-handler';
import { tefRecomputeHandler } from './tef-recompute-handler';

registerFeature({
  key: 'crq-indicators',
  activate: () => {
    /*
     * One simulation per tenant at a time: two estate-sized runs side by side each took two and a
     * half times as long as one alone, so a wider queue buys no throughput and makes the tail worse.
     * Scoped per tenant, so one tenant's run never stalls another's.
     */
    jobRuntimeEngine.registerHandler('crq-simulation', crqSimulationHandler, { serialized: true });
    // The daily door covers what no write announces: the actor mixture decays with the clock.
    jobRuntimeEngine.registerHandler(CRQ_PRICE_RECOMPUTE_JOB, crqPriceRecomputeHandler, {
      observed: true,
      daily: true,
      serializedWith: 'crq-simulation',
    });
    jobRuntimeEngine.registerHandler('tef-recompute', tefRecomputeHandler);
    jobRuntimeEngine.registerHandler(CRQ_LEVERS_BOOKING_JOB, crqLeversBookingHandler);
  },
});
