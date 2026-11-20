import type { ActorClass } from './actor-classes';
import type { ThreatEntityType } from './entity-types';
import { DEFAULT_ACTOR_CLASS } from './actor-classes';

export interface StatedActorAttributes {
  stixId: string,
  entityType: ThreatEntityType,
  name: string,
  description: string | null,
  mitreGroupId: string | null,
  confidence: number | null,
  stixCreated: Date | null,
  firstSeen: Date | null,
  lastSeen: Date | null,
  primaryMotivation: string | null,
  resourceLevel: string | null,
  sophistication: string | null,
  objective: string | null,
  /** The class the upstream object's STIX labels and resource level imply, null when they carry no signal. */
  actorClass: ActorClass | null,
}

export type CanonicalAnalysis = Omit<StatedActorAttributes, 'actorClass'> & {
  actorClass: ActorClass,
};

// A blank string is an absent value, not a value: STIX producers are free to emit one, and the
// actor row is joined and filtered on (a `mitre_group_id` of `'G1045 '` matches nothing).
const present = (value: string | null): string | null => {
  const trimmed = value === null ? '' : value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Normalises what the upstream object states into the actor row, rewritten on each ingestion so the
 * row never keeps a claim the feed has since stopped stating.
 */
export const deriveCanonicalAnalysis = (stated: StatedActorAttributes): CanonicalAnalysis => ({
  stixId: stated.stixId,
  entityType: stated.entityType,
  name: stated.name,
  mitreGroupId: present(stated.mitreGroupId),
  description: present(stated.description),
  primaryMotivation: present(stated.primaryMotivation),
  resourceLevel: present(stated.resourceLevel),
  sophistication: present(stated.sophistication),
  objective: present(stated.objective),
  actorClass: stated.actorClass ?? DEFAULT_ACTOR_CLASS,
  confidence: stated.confidence,
  stixCreated: stated.stixCreated,
  firstSeen: stated.firstSeen,
  lastSeen: stated.lastSeen,
});
