export const MAPPING_LANE_VALUES = ['supplied', 'curated', 'structural'] as const;
export type MappingLane = (typeof MAPPING_LANE_VALUES)[number];

/**
 * Where a technique a finding reaches comes from: a stored lane, or the topology rule, which reads
 * the asset and is therefore computed per finding on read and never stored.
 */
export type TechniqueClaimLane = MappingLane | 'topology';

export const MAPPING_CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
export type MappingConfidence = (typeof MAPPING_CONFIDENCE_VALUES)[number];

/**
 * How far a claim of each lane is believed, which is fixed per lane and never blended.
 *
 * A supplied or curated claim names this exact vulnerability, while a structural one follows from
 * its weakness class and a topology one from where the flaw is reached.
 */
export const MAPPING_LANE_CONFIDENCE = {
  supplied: 'high',
  curated: 'high',
  structural: 'medium',
  topology: 'medium',
} as const satisfies Record<TechniqueClaimLane, MappingConfidence>;

/** The strongest of two claims about the same technique, which is what the technique is worth. */
export const strongerConfidence = (a: MappingConfidence, b: MappingConfidence): MappingConfidence =>
  (MAPPING_CONFIDENCE_VALUES.indexOf(a) <= MAPPING_CONFIDENCE_VALUES.indexOf(b) ? a : b);

export const TECHNIQUE_RESOLUTION_STATE_VALUES = ['resolved', 'unresolved'] as const;
export type TechniqueResolutionState = (typeof TECHNIQUE_RESOLUTION_STATE_VALUES)[number];

export const TECHNIQUE_GRAIN_VALUES = ['sub_technique', 'parent'] as const;
export type TechniqueGrain = (typeof TECHNIQUE_GRAIN_VALUES)[number];

/**
 * The groups of the attack a finding opens, in the order it runs. The weakness group carries no
 * role: what a weakness class makes possible says nothing of where in the attack it comes.
 */
export const ATTACK_GROUP_VALUES = ['exploitation', 'primary_impact', 'secondary_impact', 'weakness'] as const;
export type AttackGroup = (typeof ATTACK_GROUP_VALUES)[number];
