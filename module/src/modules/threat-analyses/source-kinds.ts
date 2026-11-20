/**
 * Where a contribution to a threat came from. Every ingested object and
 * relationship carries the source that produced it, so a later ingestion can replace its own
 * contribution without touching anyone else's.
 */
export const THREAT_SOURCE_KINDS = ['stix-import', 'connector', 'default-threats'] as const;

export type ThreatSourceKind = typeof THREAT_SOURCE_KINDS[number];
