import type { AssetCategory } from '../supporting-assets/constants';

export interface ApplicablePair {
  readonly categoryId: AssetCategory,
  readonly mitreTechniqueId: string,
}

export interface ApplicablePairRow extends ApplicablePair {
  readonly parentTechniqueId: string | null,
}

/**
 * The applicable pairs, expressed on the techniques that were asked about rather than on the ones
 * the table carries. A row answers every requested technique of its own branch, itself and its
 * parent alike, which is the rule no table row expresses: a control edge sitting on a top-level
 * technique reaches a family when any technique of that branch reaches it. It answers both because
 * a caller may ask about a parent and one of its sub-cases at once, and charging the row to the
 * sub-case alone would make the parent's answer depend on the rest of the request.
 *
 * `requestedIds` is the exact set the caller asked about; anything else in `rows` is dropped.
 */
export const foldPairsOntoRequestedTechniques = (
  rows: ReadonlyArray<ApplicablePairRow>,
  requestedIds: ReadonlyArray<string>,
): Array<ApplicablePair> => {
  const requested = new Set(requestedIds);
  const seen = new Set<string>();
  const pairs: Array<ApplicablePair> = [];
  for (const row of rows) {
    const branchIds = [row.mitreTechniqueId, row.parentTechniqueId]
      .filter((id): id is string => id !== null && requested.has(id));
    for (const mitreTechniqueId of branchIds) {
      const key = `${mitreTechniqueId}:${row.categoryId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pairs.push({ mitreTechniqueId, categoryId: row.categoryId });
    }
  }
  return pairs;
};

/**
 * The unclassified bucket concerns every technique, which is a rule rather than a few thousand rows
 * per tenant. Callers opt in explicitly: turning it on for the readers that feed the figures
 * customers read today would move every scenario at once, with nothing on screen to explain it.
 */
export const withUnclassifiedBucket = (
  pairs: ReadonlyArray<ApplicablePair>,
  requestedIds: ReadonlyArray<string>,
  unclassifiedCategoryId: AssetCategory,
): Array<ApplicablePair> => [
  ...pairs,
  ...requestedIds.map((mitreTechniqueId) => ({ mitreTechniqueId, categoryId: unclassifiedCategoryId })),
];
