export const THREAT_RELEVANCE_DEFAULTS = {
  actHalfLifeObservedDays: 180,
  actHalfLifeAuthoredDays: 365,
  confidenceGate: 60,
  unknownActivityAgeDays: 365,
} as const;

export const MIN_ACT_HALF_LIFE_DAYS = 7;
export const MAX_ACT_HALF_LIFE_DAYS = 3650;

export const MIN_UNKNOWN_ACTIVITY_AGE_DAYS = 7;
export const MAX_UNKNOWN_ACTIVITY_AGE_DAYS = 3650;

// Strictest first, matching the order the setting lists them.
export const CONFIDENCE_GATE_LEVELS = [100, 80, 60, 40, 20, 0] as const;
