export const FEATURE_FLAG_ALL = '*';

/**
 * Closed registry of feature flags, shared by `back` and `front` so both type-check a flag name
 * against the same literal union and a typo is a compile error.
 *
 * Each entry designates a feature that is disabled by default. A flag is temporary: once its
 * feature ships globally, delete the entry — every gate still naming it stops compiling, which is
 * how the gates get removed with it.
 */
export const FEATURE_FLAGS = [
  FEATURE_FLAG_ALL,
  /** The Settings card reporting which edition the platform runs and what its XTM One contract covers. */
  'enterprise-edition-status',
  /** The technique and asset family pairs entering or leaving the reach gaps, listed among a scenario's changes between two runs. */
  'technique-coverage-changes',
] as const;

/** Every value the configuration accepts, the wildcard included. */
export type FeatureFlag = typeof FEATURE_FLAGS[number];

/**
 * What a gate may name. The wildcard is a configuration value only: gating on it would mean "on
 * only when every flag is on", true in a dev stack and false in production, so the mistake would
 * survive every local check.
 */
export type GatedFeatureFlag = Exclude<FeatureFlag, typeof FEATURE_FLAG_ALL>;

/**
 * The one resolution rule, applied identically on both sides of the wire: a flag is on when it is
 * listed, or when the wildcard turns everything on at once.
 *
 * Takes plain strings rather than `FeatureFlag`, so a payload that crossed the wire is resolved
 * without being trusted to still match the registry the sender compiled against.
 */
export const isFeatureFlagEnabled = (enabledFlags: ReadonlyArray<string>, flag: GatedFeatureFlag): boolean => enabledFlags.includes(FEATURE_FLAG_ALL) || enabledFlags.includes(flag);
