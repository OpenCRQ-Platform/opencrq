import type { ThreatEntityType } from './entity-types';
import { DEFAULT_RELATION_CONFIDENCE } from './constants';

export interface ActivityAttributionEdge {
  /** The attributed threat, the child whose activity climbs. */
  sourceId: string,
  sourceEntityType: ThreatEntityType,
  targetStixId: string,
  /** The target resolved among the tenant's threats, null when it is not ingested. */
  targetId: string | null,
  confidence: number | null,
}

const MAX_ACTIVITY_ATTRIBUTION_HOPS = 3;
const MAX_CAMPAIGN_ATTRIBUTED_ACTORS = 3;

export interface ActivityLineage {
  /** Every threat whose observed activity dates the key, the key itself excluded. */
  descendants: ReadonlyMap<string, ReadonlySet<string>>,
  /** Every threat the key's observed activity dates, the key itself excluded. */
  ancestors: ReadonlyMap<string, ReadonlySet<string>>,
}

const addTo = (map: Map<string, Set<string>>, key: string, value: string): void => {
  const set = map.get(key);
  if (set === undefined) {
    map.set(key, new Set([value]));
  } else {
    set.add(value);
  }
};

/**
 * Takes stated `attributed-to` links only, never inferred ones, so the lineage is the same whether
 * or not the source platform inferred the transitive links.
 */
export const buildActivityLineage = (
  edges: ReadonlyArray<ActivityAttributionEdge>,
  gate: number,
): ActivityLineage => {
  // A campaign shared by many actors says nothing about which of them it dates. Every stated target
  // counts, not ingested or under the gate alike: raising the gate must never let a trend campaign
  // date the few links left above it.
  const targetsOfCampaign = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.sourceEntityType === 'campaign') {
      addTo(targetsOfCampaign, edge.sourceId, edge.targetStixId);
    }
  }

  const parents = new Map<string, Set<string>>();
  for (const edge of edges.filter((candidate) => (candidate.confidence ?? DEFAULT_RELATION_CONFIDENCE) >= gate)) {
    const targets = targetsOfCampaign.get(edge.sourceId);
    if (targets !== undefined && targets.size > MAX_CAMPAIGN_ATTRIBUTED_ACTORS) {
      continue;
    }
    if (edge.targetId !== null) {
      addTo(parents, edge.sourceId, edge.targetId);
    }
  }

  const ancestors = new Map<string, Set<string>>();
  const descendants = new Map<string, Set<string>>();
  for (const sourceId of parents.keys()) {
    const seen = new Set<string>([sourceId]);
    let frontier = [sourceId];
    for (let hop = 0; hop < MAX_ACTIVITY_ATTRIBUTION_HOPS && frontier.length > 0; hop += 1) {
      const next: Array<string> = [];
      for (const id of frontier) {
        for (const parentId of parents.get(id) ?? []) {
          if (!seen.has(parentId)) {
            seen.add(parentId);
            next.push(parentId);
            addTo(ancestors, sourceId, parentId);
            addTo(descendants, parentId, sourceId);
          }
        }
      }
      frontier = next;
    }
  }
  return { descendants, ancestors };
};
