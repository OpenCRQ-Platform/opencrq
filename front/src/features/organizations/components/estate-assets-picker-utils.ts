/** What one drawer session toggled, which is what a save carries: the stored mapping stays on the server. */
export interface EstateMappingDelta {
  added: Array<string>,
  removed: Array<string>,
}

export const EMPTY_ESTATE_MAPPING_DELTA: EstateMappingDelta = { added: [], removed: [] };

export const isAssetSelected = (delta: EstateMappingDelta, id: string, storedAsMapped: boolean): boolean =>
  (storedAsMapped ? !delta.removed.includes(id) : delta.added.includes(id));

/**
 * Ticking then unticking a row returns the delta to the one it started from, so a session that
 * changed its mind leaves the form clean.
 */
export const toggleAssetSelection = (delta: EstateMappingDelta, id: string, storedAsMapped: boolean): EstateMappingDelta => {
  const selected = isAssetSelected(delta, id, storedAsMapped);
  if (storedAsMapped) {
    return {
      added: delta.added,
      removed: selected ? [...delta.removed, id] : delta.removed.filter((removed) => removed !== id),
    };
  }
  return {
    added: selected ? delta.added.filter((added) => added !== id) : [...delta.added, id],
    removed: delta.removed,
  };
};

/** The whole mapping's size after the save, which the browser never holds row by row. */
export const selectedAssetCount = (mappedCount: number, delta: EstateMappingDelta): number =>
  mappedCount + delta.added.length - delta.removed.length;

/** Sorting is stable, so the server's own order survives inside each group. */
export const orderSelectedFirst = <T extends { id: string, mapped: boolean }>(
  rows: ReadonlyArray<T>,
  delta: EstateMappingDelta,
): Array<T> => [...rows].sort((a, b) =>
  Number(isAssetSelected(delta, b.id, b.mapped)) - Number(isAssetSelected(delta, a.id, a.mapped)));
