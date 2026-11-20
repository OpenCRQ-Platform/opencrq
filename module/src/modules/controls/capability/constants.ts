export const STRENGTH_RUNGS = ['L0', 'L1', 'L2', 'L3'] as const;
export type StrengthRung = typeof STRENGTH_RUNGS[number];

export const STRENGTH_REFERENCE_RUNGS = ['L1', 'L2', 'L3'] as const;
export type StrengthReferenceRung = typeof STRENGTH_REFERENCE_RUNGS[number];

export const COVERAGE_BUCKETS = ['L0', 'L1', 'L2', 'L3'] as const;
export type CoverageBucket = typeof COVERAGE_BUCKETS[number];

export const COVERAGE_COEFFICIENTS: Record<CoverageBucket, number> = {
  L0: 0,
  L1: 0.4,
  L2: 0.7,
  L3: 1.0,
};

// The catalogue carries no per-edge strength grade, so one number stands in for every edge and the
// rung declines it: a rung is one more layer of the same control doing its job, so the miss rate
// compounds. `RUNG_LAYERS` is that layer count, not a second thing to calibrate.
// The rate is swept by OpenCRQ's attack run calibration at a visit quota of 16: it is the rate the
// calibration criteria hold at together, and the engine's detection scale and post-objective rate are
// fitted at it. It also sets the strength the finding score and the controls screen read for a rung.
export const LAYER_BLOCK_RATE = 0.47;

const RUNG_LAYERS: Record<StrengthReferenceRung, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
};

const strengthAtRung = (rung: StrengthReferenceRung): number => 1 - (1 - LAYER_BLOCK_RATE) ** RUNG_LAYERS[rung];

/** Derived, so an edit belongs on `LAYER_BLOCK_RATE`. */
export const STRENGTH_BY_RUNG: Record<StrengthReferenceRung, number> = {
  L1: strengthAtRung('L1'),
  L2: strengthAtRung('L2'),
  L3: strengthAtRung('L3'),
};

export const SUSCEPTIBILITY_GAMMA = 0.7;

export const CAPABILITY_FUNCTIONS = ['prevent', 'detect'] as const;
export type CapabilityFunction = typeof CAPABILITY_FUNCTIONS[number];

export const ENGINE_SCORING_FUNCTIONS = ['prevent'] as const;

/** The defense catalogue's domains, in the order the controls list groups them. */
export const CONTROL_DOMAINS = [
  'endpoints_and_servers',
  'network',
  'identities',
  'email_and_saas',
  'applications',
  'cloud',
  'data',
  'detection_and_response',
  'people_and_third_parties',
  'ai',
] as const;
export type ControlDomain = typeof CONTROL_DOMAINS[number];

export const CAPABILITY_FAMILIES = [
  'application',
  'awareness',
  'cloud',
  'data',
  'detection',
  'endpoint',
  'identity',
  'messaging',
  'network',
] as const;
export type CapabilityFamily = typeof CAPABILITY_FAMILIES[number];

export const CROSSWALK_FRAMEWORKS = [
  'nist_800_53',
  'csf_2_0',
  'iso_27001',
  'd3fend',
  'attack_mitigations',
] as const;
export type CrosswalkFramework = typeof CROSSWALK_FRAMEWORKS[number];

/**
 * `assessment_cleared` is the derivation removing a value no source feeds any more.
 * `sources_changed` is a write that moved no value: an axis re-attached, or declared by hand, at the
 * value it held, or a source joining or leaving. The provenance line reads its author and date off
 * the latest event, so that write still needs one. A null connector marks a user's declaration.
 */
export const ASSESSMENT_EVENT_TYPES = [
  'assessment_set',
  'strength_change',
  'coverage_change',
  'assessment_change',
  'assessment_cleared',
  'sources_changed',
] as const;
export type AssessmentEventType = typeof ASSESSMENT_EVENT_TYPES[number];

export const ASSESSMENT_MODES = ['auto', 'manual'] as const;
export type AssessmentMode = typeof ASSESSMENT_MODES[number];

export const ASSESSMENT_AXES = ['strength', 'coverage'] as const;
export type AssessmentAxis = typeof ASSESSMENT_AXES[number];

/**
 * Where a coverage comes from, first available: declared by hand, measured by a connector, given by
 * a coverage-typed requirement, or assumed from the maturity level of the capability-typed answers.
 */
export const COVERAGE_BASES = ['declared', 'measured', 'typed', 'assumed'] as const;
export type CoverageBasis = typeof COVERAGE_BASES[number];

/** The writer the event history names for a value the pooled derivation wrote. */
export const DERIVATION_WRITER = 'derivation';

/** The source a Drata reading is listed under; an assessment's is its framework key. */
export const DRATA_SOURCE = 'drata';

// One override row per (control, technique, function): both kinds carry their function, so an
// addition contributes one behaviour and a removal suppresses that one behaviour only.
export const TECHNIQUE_OVERRIDE_KINDS = ['added', 'removed'] as const;
export type TechniqueOverrideKind = typeof TECHNIQUE_OVERRIDE_KINDS[number];

export const EFFECTIVE_EDGE_SOURCES = ['catalogue', 'tenant'] as const;
export type EffectiveEdgeSource = typeof EFFECTIVE_EDGE_SOURCES[number];

export const EFFECTIVE_EDGE_STATES = ['recommended', 'added', 'removed'] as const;
export type EffectiveEdgeState = typeof EFFECTIVE_EDGE_STATES[number];

export const coverageCoefficient = (bucket: CoverageBucket): number => COVERAGE_COEFFICIENTS[bucket];

export const isStrengthRung = (value: string): value is StrengthRung =>
  (STRENGTH_RUNGS as ReadonlyArray<string>).includes(value);

export const isCoverageBucket = (value: string): value is CoverageBucket =>
  (COVERAGE_BUCKETS as ReadonlyArray<string>).includes(value);

export const isCapabilityFunction = (value: string): value is CapabilityFunction =>
  (CAPABILITY_FUNCTIONS as ReadonlyArray<string>).includes(value);
