import { ATTACK_PATH_STALE_AFTER_DAYS } from '../supporting-assets/constants';

/** Attack-path hops a finding's reach follows from the asset it sits on. */
export const MAX_ATTACK_PATH_DEPTH = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The oldest report a `reachable_from` hop may carry and still count: older ones are stale, kept, not followed. */
export const attackPathFreshSince = (now: Date): Date => new Date(now.getTime() - ATTACK_PATH_STALE_AFTER_DAYS * DAY_MS);

export const isAttackPathHopStale = (lastReportedAt: Date, now: Date): boolean =>
  lastReportedAt.getTime() < attackPathFreshSince(now).getTime();

/**
 * Shortest number of hops to every asset an attack path reaches from `origin` (depth 0), up to
 * `MAX_ATTACK_PATH_DEPTH`. `reachedFrom` answers the hops leaving a set of assets, each as the asset
 * reached (`fromAssetId` of the `reachable_from` relation) and the asset it is reached from
 * (`toAssetId`); the caller keeps only the hops that are not stale.
 */
export const walkAttackPath = async (
  origin: string,
  reachedFrom: (assetIds: ReadonlyArray<string>) => Promise<ReadonlyArray<{ fromAssetId: string, toAssetId: string }>>,
): Promise<Map<string, number>> => {
  const depthOf = new Map<string, number>([[origin, 0]]);
  let frontier = [origin];
  for (let depth = 1; depth <= MAX_ATTACK_PATH_DEPTH && frontier.length > 0; depth += 1) {
    const next: Array<string> = [];
    for (const { fromAssetId } of await reachedFrom(frontier)) {
      if (!depthOf.has(fromAssetId)) {
        depthOf.set(fromAssetId, depth);
        next.push(fromAssetId);
      }
    }
    frontier = next;
  }
  return depthOf;
};

/** One hop as a `reachable_from` relation stores it, with what showed it. */
export interface AttackPathHopRow {
  /** The asset reached. */
  fromAssetId: string,
  /** The asset it is reached from. */
  toAssetId: string,
  source: string,
  evidenceRef: string | null,
  lastReportedAt: Date,
}

export interface AttackPathHop {
  fromAssetId: string,
  toAssetId: string,
  /** `proven`: an OpenAEV execution got through; `inferred`: the conditions are met, nothing proved it yet. */
  nature: 'proven' | 'inferred',
  /** The OpenAEV simulation that showed it at its last report, when the source names one. */
  evidenceRef: string | null,
  lastReportedAt: Date,
}

const natureOf = (source: string): AttackPathHop['nature'] => (source === 'openaev_attack_path_proven' ? 'proven' : 'inferred');

/**
 * The hops of the reach, between assets `depthOf` holds and kept within `visible` (an asset the
 * caller cannot read is never named, nor its hops): one hop per pair, a proven hop winning over an
 * inferred one, then the latest report; ordered by the depth of the asset reached, then by ids.
 */
export const attackPathHops = (
  depthOf: ReadonlyMap<string, number>,
  rows: ReadonlyArray<AttackPathHopRow>,
  visible: ReadonlySet<string>,
): Array<AttackPathHop> => {
  const byPair = new Map<string, AttackPathHop>();
  for (const row of rows) {
    const reached = depthOf.get(row.fromAssetId);
    const from = depthOf.get(row.toAssetId);
    if (reached === undefined || from === undefined || reached <= from || !visible.has(row.fromAssetId) || !visible.has(row.toAssetId)) {
      continue;
    }
    const hop: AttackPathHop = {
      fromAssetId: row.fromAssetId,
      toAssetId: row.toAssetId,
      nature: natureOf(row.source),
      evidenceRef: row.evidenceRef,
      lastReportedAt: row.lastReportedAt,
    };
    const key = `${row.toAssetId}>${row.fromAssetId}`;
    const held = byPair.get(key);
    const better = held === undefined
      || (hop.nature === 'proven' && held.nature === 'inferred')
      || (hop.nature === held.nature && hop.lastReportedAt.getTime() > held.lastReportedAt.getTime());
    if (better) {
      byPair.set(key, hop);
    }
  }
  return [...byPair.values()].sort((a, b) => (depthOf.get(a.fromAssetId) ?? 0) - (depthOf.get(b.fromAssetId) ?? 0)
    || a.toAssetId.localeCompare(b.toAssetId) || a.fromAssetId.localeCompare(b.fromAssetId));
};

export interface AttackPathReachedPrimaryAsset {
  primaryAssetId: string,
  primaryAssetName: string,
  /** The reached supporting assets the primary asset depends on, nearest first. */
  throughAssetIds: Array<string>,
}

/**
 * The primary assets behind the reached assets: a primary asset counts when any reached asset is
 * in its reach (`primary_asset_reach`, its supporting assets at any dependency depth). Ordered by
 * the nearest hop that leads to it, then by name.
 */
export const primaryAssetsBehind = (
  depthOf: ReadonlyMap<string, number>,
  reach: ReadonlyArray<{ primaryAssetId: string, primaryAssetName: string, supportingAssetId: string }>,
): Array<AttackPathReachedPrimaryAsset> => {
  const byPrimary = new Map<string, AttackPathReachedPrimaryAsset & { nearest: number }>();
  for (const row of reach) {
    const depth = depthOf.get(row.supportingAssetId);
    if (depth === undefined) {
      continue;
    }
    const held = byPrimary.get(row.primaryAssetId)
      ?? { primaryAssetId: row.primaryAssetId, primaryAssetName: row.primaryAssetName, throughAssetIds: [], nearest: depth };
    if (!held.throughAssetIds.includes(row.supportingAssetId)) {
      held.throughAssetIds.push(row.supportingAssetId);
    }
    held.nearest = Math.min(held.nearest, depth);
    byPrimary.set(row.primaryAssetId, held);
  }
  return [...byPrimary.values()]
    .map((entry) => ({
      ...entry,
      throughAssetIds: [...entry.throughAssetIds].sort((a, b) => (depthOf.get(a) ?? 0) - (depthOf.get(b) ?? 0) || a.localeCompare(b)),
    }))
    .sort((a, b) => a.nearest - b.nearest || a.primaryAssetName.localeCompare(b.primaryAssetName))
    .map((entry) => ({ primaryAssetId: entry.primaryAssetId, primaryAssetName: entry.primaryAssetName, throughAssetIds: entry.throughAssetIds }));
};
