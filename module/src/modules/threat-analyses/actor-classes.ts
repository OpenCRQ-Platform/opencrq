export const ACTOR_CLASS_VALUES = [
  'opportunistic_crime', 'ransomware_operator', 'state_sponsored', 'hacktivist', 'default',
] as const;
export type ActorClass = (typeof ACTOR_CLASS_VALUES)[number];

export const DEFAULT_ACTOR_CLASS: ActorClass = 'default';

export interface ActorClassPreset {
  /** Success multiplier on every play the actor attempts. */
  readonly capability: number,
  /** The pacing that lets the detection signal decay between moves. */
  readonly patience: number,
  /** Attenuates the noise each action emits. */
  readonly stealth: number,
}

/**
 * The five behavior classes, each fixing every per-actor knob the simulation reads: nothing
 * per-actor is declared beyond the class. Platform reference data under sensitivity analysis, not
 * measurements: review the ordering (state sponsored highest capability and patience, opportunistic
 * lowest), the exact figures are tuning.
 */
export const ACTOR_CLASS_PRESETS: Readonly<Record<ActorClass, ActorClassPreset>> = {
  opportunistic_crime: { capability: 0.3, patience: 0.25, stealth: 0.25 },
  ransomware_operator: { capability: 0.55, patience: 0.5, stealth: 0.5 },
  state_sponsored: { capability: 0.9, patience: 0.9, stealth: 0.85 },
  hacktivist: { capability: 0.3, patience: 0.3, stealth: 0.2 },
  default: { capability: 0.5, patience: 0.35, stealth: 0.3 },
};

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const someLabelContains = (labels: ReadonlyArray<string>, markers: ReadonlyArray<string>): boolean =>
  labels.some((label) => markers.some((marker) => normalize(label).includes(marker)));

/** STIX `resource_level` values (attack-resource-level-ov) that carry a class signal on their own. */
const OPPORTUNISTIC_RESOURCE_LEVELS = new Set(['individual', 'club', 'contest']);

/**
 * The class one source's STIX labels and resource level imply, null when they carry no signal and
 * the canonical fold takes `default`. Label markers win over the resource level, and the strongest
 * capability signal wins among labels: an actor labeled both state-sponsored and ransomware behaves
 * like the state actor.
 */
export const deriveActorClass = (labels: ReadonlyArray<string>, resourceLevel: string | null): ActorClass | null => {
  if (someLabelContains(labels, ['statesponsored', 'nationstate'])) {
    return 'state_sponsored';
  }
  if (someLabelContains(labels, ['ransomware', 'extortion'])) {
    return 'ransomware_operator';
  }
  if (someLabelContains(labels, ['hacktivist', 'hacktivism'])) {
    return 'hacktivist';
  }
  if (someLabelContains(labels, ['crimeware', 'cybercrime', 'opportunistic'])) {
    return 'opportunistic_crime';
  }
  const level = resourceLevel === null ? '' : resourceLevel.trim().toLowerCase();
  if (level === 'government') {
    return 'state_sponsored';
  }
  if (OPPORTUNISTIC_RESOURCE_LEVELS.has(level)) {
    return 'opportunistic_crime';
  }
  return null;
};

/** The class the engine reads: the manual pin when one is set, the derived class otherwise. */
export const resolveEffectiveActorClass = (
  analysis: { actorClass: ActorClass, actorClassOverride: ActorClass | null },
): ActorClass => analysis.actorClassOverride ?? analysis.actorClass;
