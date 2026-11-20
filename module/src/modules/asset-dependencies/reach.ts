import { diffRows } from '../../db/row-diff';

/** Provider levels below a primary asset's direct links that its reach counts. */
export const MAX_REACH_DEPTH = 5;

/** Shortest depth of every asset reached from `direct` (depth 0), up to `MAX_REACH_DEPTH` provider levels. */
export const walkReach = async (
  direct: ReadonlyArray<string>,
  providersOf: (dependentIds: ReadonlyArray<string>) => Promise<ReadonlyArray<{ dependentAssetId: string, providerAssetId: string }>>,
): Promise<Map<string, number>> => {
  const depthOf = new Map<string, number>(direct.map((id) => [id, 0]));
  let frontier = [...depthOf.keys()];
  for (let depth = 1; depth <= MAX_REACH_DEPTH && frontier.length > 0; depth += 1) {
    const next: Array<string> = [];
    for (const { providerAssetId } of await providersOf(frontier)) {
      if (!depthOf.has(providerAssetId)) {
        depthOf.set(providerAssetId, depth);
        next.push(providerAssetId);
      }
    }
    frontier = next;
  }
  return depthOf;
};

export interface ReachRow {
  organizationId: string,
  primaryAssetId: string,
  supportingAssetId: string,
  depth: number,
}

const pairKey = (row: Pick<ReachRow, 'primaryAssetId' | 'supportingAssetId'>) => `${row.primaryAssetId}\u0000${row.supportingAssetId}`;

/** Rows to write (missing, or held with another depth or organization) and keys to delete. */
export const diffReach = (
  held: ReadonlyArray<ReachRow>,
  wanted: ReadonlyArray<ReachRow>,
): { upserts: Array<ReachRow>, stale: Array<Pick<ReachRow, 'primaryAssetId' | 'supportingAssetId'>> } => {
  const { stale, missing } = diffRows(held, wanted, pairKey, pairKey);
  const heldByPair = new Map(held.map((row) => [pairKey(row), row]));
  const changed = wanted.filter((row) => {
    const heldRow = heldByPair.get(pairKey(row));
    return heldRow !== undefined && (heldRow.depth !== row.depth || heldRow.organizationId !== row.organizationId);
  });
  return {
    upserts: [...missing, ...changed],
    stale: stale.map(({ primaryAssetId, supportingAssetId }) => ({ primaryAssetId, supportingAssetId })),
  };
};
