import { DETECTED_MAGNITUDE_FACTOR, RESPONSE_COST_FRACTION } from './attack-run-constants';

/**
 * The euro fraction of one loss event, given the outcome split. Blocked is priced at zero, an
 * eviction at the response it cost, a detected impact at a fraction of the magnitude, an undetected
 * one at all of it.
 */
export const pricedFraction = (outcomes: { evicted: number, impactDetected: number, impactUndetected: number }): number =>
  outcomes.evicted * RESPONSE_COST_FRACTION
  + outcomes.impactDetected * DETECTED_MAGNITUDE_FACTOR
  + outcomes.impactUndetected;
