import type { DeclaredCriticality } from '../supporting-assets/constants';
import { SILENT_FLAW_THREAT } from '../cve/silent-flaw-threat';
import { DETECTED_MAGNITUDE_FACTOR } from '../crq-indicators/engine/attack-run-constants';

/**
 * Floors a signal sets on the threat factor.
 *
 * `base` is the only number here that fabricates a threat out of silence, and it applies as a floor
 * at all times, not only when nothing else was received: a published probability below it must not
 * push a finding under what a finding nobody knows anything about is worth. The other two translate
 * a signal that was actually received into a strength.
 */
export const THREAT_FLOORS = {
  base: SILENT_FLAW_THREAT,
  knownExploited: 0.9,
  activeThreat: 0.35,
} as const;

/** Share of the remaining distance to certainty that two or more independent signals lift. */
export const INDEPENDENT_SIGNAL_LIFT = 1 / 3;

/** An unknown criticality has no entry: it is priced as the band the tenant picked, never between two. */
export const CRITICALITY_COST_FACTORS = {
  very_high: 1,
  high: 0.9,
  medium: 0.7,
  low: 0.4,
} as const satisfies Record<DeclaredCriticality, number>;

/** Tenant knobs at their defaults, which reproduce the behaviour of an estate that never set them. */
export const FINDING_SCORE_SETTING_DEFAULTS = {
  measuredValidityDays: null,
  unknownCriticalityCountsAs: 'low' satisfies DeclaredCriticality,
} as const;

/**
 * Even the best control is never fully reliable: a declared resistance is capped so the residual
 * susceptibility behind it never reads below 0.03, however much a tenant declares.
 */
export const RESISTANCE_MU_CAP = 0.97;

/**
 * The most a detection takes off what a technique lets through. Seeing an attack does not stop it
 * from landing, it lowers what the landing costs, so the credit is the CRQ engine's price of a
 * detected impact.
 */
export const DETECTION_CREDIT = 1 - DETECTED_MAGNITUDE_FACTOR;

/**
 * What the controls let through on a side of the score no technique stands on. Precautionary: a
 * side nothing can evaluate is read as nothing held, never dropped, so no finding is scored on fewer
 * terms than another.
 */
export const UNEVALUATED_LET_THROUGH = 1;
