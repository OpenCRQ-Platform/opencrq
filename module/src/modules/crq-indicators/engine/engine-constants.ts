/**
 * The attack run engine's platform constants. Module constants are the documented fallback until
 * the per-tenant engine-settings surface ships: a future tenant override reads over these, it
 * never remodels them. All are subject to sensitivity analysis before release.
 */

/** Residual capability of a misconfigured control: 0 inert, 1 intact. */
export const MISCONFIGURED_RESIDUAL_DELTA = 0.3;

/** Collection-step weight multiplier of assets matched by the scenario group. */
export const SCENARIO_GROUP_BOOST_G = 10;

/** Ceiling of any per-couple success probability. */
export const COUPLE_SUCCESS_CAP = 0.98;

/** Success floor of an actor-exploited CVE on its exploitation step, before control damping. */
export const ACTOR_EXPLOITED_CVE_FLOOR = 0.9;

/**
 * Test freshness decay, w = exp(-age/tau). Shipped present but off: v1 runs with w = 1, so a
 * stale test weighs like a fresh one until the freshness unlock turns this on.
 */
export const TEST_FRESHNESS_TAU_DAYS = 180;
export const TEST_FRESHNESS_ENABLED = false;
