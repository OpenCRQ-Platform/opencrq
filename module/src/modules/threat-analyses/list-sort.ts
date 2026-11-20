// Pure, so it can be re-exported through `client.ts` for the front end to import instead of
// hand-typing its own copy.
export const THREAT_LIST_SORT_KEYS = [
  'name', 'mitreGroupId', 'outcomeScore', 'cveCount', 'techniqueCount', 'activityScore', 'lastObservedAt', 'stixCreated', 'updatedAt',
] as const;

export type ThreatListSortKey = (typeof THREAT_LIST_SORT_KEYS)[number];
