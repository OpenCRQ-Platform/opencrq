export const JOB_CATALOGUE_KINDS = [
  'noop',
  'cve-epss-sync',
  'cve-kev-sync',
  'cve-cvss-sync',
  'microsoft-graph-sync',
  'openaev-findings-sync',
  'drata-sync',
  'default-threats-sync',
  'capability-derivation',
  'crq-simulation',
  'crq-price-recompute',
  'crq-levers-booking',
  'tef-recompute',
  'threat-bundle-analysis',
  'threat-bundle-outcome-rescore',
  'threat-outcome-counter-recompute',
  'threat-activity-recompute',
  'threat-list-projection-recompute',
  'finding-score-recompute',
  'proven-posture-record',
  'opencti-mirror-rebuild',
  'financial-estimates-recompute',
  'asset-criticality-lift-recompute',
  'dependency-rules-apply',
  'primary-asset-reach-recompute',
  'attack-outcome-mixture-recompute',
  'jobs-retention',
] as const;

export type JobCatalogueKind = (typeof JOB_CATALOGUE_KINDS)[number];

export interface JobCatalogueEntry {
  kind: JobCatalogueKind,
  observed: boolean,
  daily: boolean,
  /** Never two runs in flight for one tenant. Independent of `observed`: a kind serializes when
   * either is true, since an observed kind serializes for its own reason (see `HandlerRegistry`). */
  serialized: boolean,
  serializedWith?: JobCatalogueKind,
}

/**
 * Declared rather than read from the job runtime engine's registry: the tRPC router lives in the
 * http process, which registers no job handler, so that registry is empty there by construction.
 */
export const JOB_CATALOGUE: Readonly<Record<JobCatalogueKind, JobCatalogueEntry>> = {
  'noop': { kind: 'noop', observed: false, daily: false, serialized: false },
  // The connector kinds: a scheduled run and a manual one would share the connector's watermark.
  'cve-epss-sync': { kind: 'cve-epss-sync', observed: false, daily: false, serialized: true },
  'cve-kev-sync': { kind: 'cve-kev-sync', observed: false, daily: false, serialized: true },
  'cve-cvss-sync': { kind: 'cve-cvss-sync', observed: false, daily: false, serialized: true },
  'microsoft-graph-sync': { kind: 'microsoft-graph-sync', observed: false, daily: false, serialized: true },
  'openaev-findings-sync': { kind: 'openaev-findings-sync', observed: false, daily: false, serialized: true },
  'drata-sync': { kind: 'drata-sync', observed: false, daily: false, serialized: true },
  'default-threats-sync': { kind: 'default-threats-sync', observed: false, daily: false, serialized: true },
  'capability-derivation': { kind: 'capability-derivation', observed: true, daily: true, serialized: false },
  'crq-simulation': { kind: 'crq-simulation', observed: false, daily: false, serialized: true },
  // Pricing a scenario is one tenant-wide queue whatever profile asks for it.
  'crq-price-recompute': { kind: 'crq-price-recompute', observed: true, daily: true, serialized: false, serializedWith: 'crq-simulation' },
  'crq-levers-booking': { kind: 'crq-levers-booking', observed: false, daily: false, serialized: false },
  'tef-recompute': { kind: 'tef-recompute', observed: false, daily: false, serialized: false },
  'threat-bundle-analysis': { kind: 'threat-bundle-analysis', observed: false, daily: false, serialized: false },
  'threat-bundle-outcome-rescore': { kind: 'threat-bundle-outcome-rescore', observed: false, daily: false, serialized: false },
  'threat-outcome-counter-recompute': { kind: 'threat-outcome-counter-recompute', observed: true, daily: true, serialized: false },
  'threat-activity-recompute': { kind: 'threat-activity-recompute', observed: true, daily: true, serialized: false },
  'threat-list-projection-recompute': { kind: 'threat-list-projection-recompute', observed: true, daily: false, serialized: false },
  'finding-score-recompute': { kind: 'finding-score-recompute', observed: true, daily: true, serialized: false },
  'proven-posture-record': { kind: 'proven-posture-record', observed: true, daily: true, serialized: false },
  'opencti-mirror-rebuild': { kind: 'opencti-mirror-rebuild', observed: true, daily: false, serialized: false },
  'financial-estimates-recompute': { kind: 'financial-estimates-recompute', observed: true, daily: false, serialized: false },
  'asset-criticality-lift-recompute': { kind: 'asset-criticality-lift-recompute', observed: true, daily: false, serialized: false },
  // Woken by the inventory a sync writes and by the rules themselves: what it links, the reach reads.
  'dependency-rules-apply': { kind: 'dependency-rules-apply', observed: true, daily: false, serialized: false },
  'primary-asset-reach-recompute': { kind: 'primary-asset-reach-recompute', observed: true, daily: false, serialized: false },
  'attack-outcome-mixture-recompute': { kind: 'attack-outcome-mixture-recompute', observed: true, daily: true, serialized: false },
  // Works on the clock alone: nothing it reads should wake it, so it is not observed, and what it
  // deletes no reader reads, so the dispatcher routes none of its writes (`UNROUTED_ORIGINS`).
  'jobs-retention': { kind: 'jobs-retention', observed: false, daily: true, serialized: false },
};

export const JOB_CATALOGUE_ENTRIES: ReadonlyArray<JobCatalogueEntry> = JOB_CATALOGUE_KINDS
  .map((kind) => JOB_CATALOGUE[kind]);

/** The groups of two kinds or more that `serializedWith` links into one per-tenant slot, transitively. */
export const sharedSlotGroups = (
  declarations: Iterable<{ kind: string, serializedWith?: string }>,
): Array<Array<string>> => {
  const groups: Array<Set<string>> = [];
  for (const { kind, serializedWith } of declarations) {
    if (serializedWith === undefined) {
      continue;
    }
    const joined = groups.filter((group) => group.has(kind) || group.has(serializedWith));
    const merged = new Set([kind, serializedWith, ...joined.flatMap((group) => [...group])]);
    groups.splice(0, groups.length, ...groups.filter((group) => !joined.includes(group)), merged);
  }
  return groups.map((group) => [...group].sort());
};

/** The kinds the Jobs surface lists and resolves an address to: `noop` exists for the runtime's own tests. */
export const isDisplayedJobKind = (kind: string): kind is JobCatalogueKind =>
  kind !== 'noop' && JOB_CATALOGUE_KINDS.some((candidate) => candidate === kind);
