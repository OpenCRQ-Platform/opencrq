export interface StaleOutcomeAnalysis {
  id: string,
  stixId: string,
}

export interface ReplayableBundleFile {
  id: string,
  uploadedAt: Date,
}

export interface OutcomeCounterRecomputePlan {
  /** Stale threats the mirror holds: marking them lets the mirror rebuild rescore them. */
  mirrorStixIds: Array<string>,
  /** Stale threats the mirror does not hold, which only the stored files can rescore. */
  fileStixIds: Array<string>,
  /** The files to read for them, oldest upload first, so a later upload's snapshot of a threat wins. */
  bundleFileIdsInOrder: Array<string>,
}

/**
 * A stale threat's inputs are in the OpenCTI mirror or in an uploaded bundle, and nothing records
 * which: presence in the mirror decides, since a bundle upload and the connector share one analysis
 * kind. Nothing records either which file holds a threat, so every file is read for the threats the
 * mirror does not hold.
 */
export const planOutcomeCounterRecompute = (params: {
  stale: ReadonlyArray<StaleOutcomeAnalysis>,
  mirrorStixIds: ReadonlySet<string>,
  bundleFiles: ReadonlyArray<ReplayableBundleFile>,
}): OutcomeCounterRecomputePlan => {
  const staleStixIds = [...new Set(params.stale.map((analysis) => analysis.stixId))].sort();
  const mirrorStixIds = staleStixIds.filter((stixId) => params.mirrorStixIds.has(stixId));
  const fileStixIds = staleStixIds.filter((stixId) => !params.mirrorStixIds.has(stixId));
  const bundleFileIdsInOrder = fileStixIds.length > 0
    ? params.bundleFiles
      .toSorted((left, right) => left.uploadedAt.getTime() - right.uploadedAt.getTime() || (left.id < right.id ? -1 : 1))
      .map((file) => file.id)
    : [];
  return { mirrorStixIds, fileStixIds, bundleFileIdsInOrder };
};
