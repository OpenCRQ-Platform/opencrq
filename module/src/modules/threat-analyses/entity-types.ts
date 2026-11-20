/** The STIX types a threat is read from, stored verbatim so the value is the object's own type. */
export const THREAT_ENTITY_TYPES = ['intrusion-set', 'threat-actor', 'campaign'] as const;

export type ThreatEntityType = typeof THREAT_ENTITY_TYPES[number];

export const isThreatEntityType = (value: unknown): value is ThreatEntityType =>
  typeof value === 'string' && (THREAT_ENTITY_TYPES as ReadonlyArray<string>).includes(value);
