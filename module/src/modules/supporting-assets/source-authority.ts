import type { AssetSourceOrigin } from './constants';

/**
 * Which connector outranks which when resolving `category_id`. A static table for now (the spec
 * leaves per-tenant configurability open); the call site (`attribute-resolution.ts`) is
 * indifferent to where the ranking comes from. Lower rank wins. Anything not listed ranks last.
 *
 * A manual observation ranks ahead of every connector regardless of this table — see
 * `sourceAuthorityRank` below — but that only governs which source's *property block*
 * (`resolveObservationProperties`) speaks for the asset. The five scalar attributes never read a
 * manual observation's rank: `resolveAssetAttributes` filters it out before resolving them.
 */
const SOURCE_AUTHORITY_RANK: Record<string, number> = {
  microsoft_graph: 0,
  openaev: 1,
};

const UNRANKED = 100;

/** Ahead of every listed connector: a block a person just typed must never be silently outranked by automation. */
const MANUAL_RANK = -1;

export const sourceAuthorityRank = (source: string | null | undefined, origin?: AssetSourceOrigin): number => {
  if (origin === 'user') {
    return MANUAL_RANK;
  }
  return source ? SOURCE_AUTHORITY_RANK[source] ?? UNRANKED : UNRANKED;
};
