import type { AssetCriticality } from './constants';
import { ASSET_CRITICALITY_SEVERITY } from './constants';

/**
 * One band below the identity's, as Microsoft rates a "Domain Admin Device" one level below the
 * account. An identity at `medium` or below lifts nothing: a device is not made notable by belonging
 * to an unremarkable account.
 */
const LIFTED_BAND: Partial<Record<AssetCriticality, 'high' | 'medium'>> = { very_high: 'high', high: 'medium' };

export interface CriticalityLift {
  supportingAssetId: string,
  criticality: AssetCriticality,
  fromAssetId: string | null,
}

/**
 * The lift each device takes from the identities assigned to it: the highest of them, a tie going
 * to the lowest identity id so that two runs over the same estate write the same row.
 */
export const computeCriticalityLifts = (
  assignments: ReadonlyArray<{ deviceId: string, identityId: string, identityCriticality: AssetCriticality }>,
): Array<CriticalityLift> => {
  const best = new Map<string, { criticality: 'high' | 'medium', fromAssetId: string }>();
  for (const { deviceId, identityId, identityCriticality } of assignments) {
    const criticality = LIFTED_BAND[identityCriticality];
    if (criticality === undefined) {
      continue;
    }
    const current = best.get(deviceId);
    const outranks = current === undefined
      || ASSET_CRITICALITY_SEVERITY[criticality] > ASSET_CRITICALITY_SEVERITY[current.criticality]
      || (criticality === current.criticality && identityId < current.fromAssetId);
    if (outranks) {
      best.set(deviceId, { criticality, fromAssetId: identityId });
    }
  }
  return [...best].map(([supportingAssetId, lift]) => ({ supportingAssetId, ...lift }));
};

/**
 * Whether the lift is what gives the device the band it has. A lift is stored whatever the device's
 * own readings say, so it gives nothing when a band set by hand outranks it, or when a connector
 * already reads the device at or above it.
 */
export const liftGivesBand = (params: {
  lift: AssetCriticality,
  bandInEffect: AssetCriticality,
  connectorReadings: ReadonlyArray<AssetCriticality>,
  isSetByHand: boolean,
}): boolean => !params.isSetByHand
  && params.bandInEffect === params.lift
  && params.connectorReadings.every((reading) => ASSET_CRITICALITY_SEVERITY[reading] < ASSET_CRITICALITY_SEVERITY[params.lift]);

/**
 * Splits the devices a run reprojects into batches of at most `size`, in id order across the whole
 * run. Each reprojection statement binds one parameter per id, and PostgreSQL takes at most 65,535 in
 * a statement; the id order keeps the row locks taken in the order two reprojections agree on.
 */
export const toReprojectionBatches = (assetIds: ReadonlyArray<string>, size: number): Array<Array<string>> => {
  // Code-unit order, which is the database's order for lowercase uuids.
  const sorted = [...assetIds].sort();
  const batches: Array<Array<string>> = [];
  for (let i = 0; i < sorted.length; i += size) {
    batches.push(sorted.slice(i, i + size));
  }
  return batches;
};

/** What a run writes to bring the stored lifts to the computed ones, and the devices whose band that may move. */
export const diffCriticalityLifts = (
  stored: ReadonlyArray<CriticalityLift>,
  computed: ReadonlyArray<CriticalityLift>,
): { upserts: Array<CriticalityLift>, deletedAssetIds: Array<string>, changedAssetIds: Array<string> } => {
  const storedById = new Map(stored.map((lift) => [lift.supportingAssetId, lift]));
  const computedIds = new Set(computed.map((lift) => lift.supportingAssetId));
  const upserts = computed.filter((lift) => {
    const current = storedById.get(lift.supportingAssetId);
    return current === undefined || current.criticality !== lift.criticality || current.fromAssetId !== lift.fromAssetId;
  });
  const deletedAssetIds = stored.map((lift) => lift.supportingAssetId).filter((id) => !computedIds.has(id));
  return { upserts, deletedAssetIds, changedAssetIds: [...upserts.map((lift) => lift.supportingAssetId), ...deletedAssetIds] };
};
