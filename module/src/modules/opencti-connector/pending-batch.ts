import { isThreatEntityType } from '../threat-analyses/entity-types';

/**
 * What the scan reads of a marked mirror row. `watermark` is the row's `updated_at` as Postgres
 * prints it, which is what the clear is guarded on: a `timestamptz` keeps microseconds and a
 * JavaScript date only milliseconds, so a value that went through one would never match again.
 */
export interface PendingStreamObject {
  stixId: string,
  stixType: string,
  sourceRef: string | null,
  deletedAt: Date | null,
  watermark: string,
}

export interface PendingMark {
  stixId: string,
  watermark: string,
}

export interface PendingBatchPlan {
  /** Threats the batch names without a lookup: a threat's own row, and a relationship's source. */
  directGroupStixIds: Array<string>,
  /** Catalog objects whose holders are only reachable through the relationships targeting them. */
  targetedStixIds: Array<string>,
  /** Identities whose contribution is named through `created_by_ref`, which is never a `target_ref`. */
  producerStixIds: Array<string>,
  /** Threats the batch says are gone, whose connector contribution has to be retracted. */
  tombstonedGroupStixIds: Array<string>,
  marks: Array<PendingMark>,
}

/** Sorted, deduplicated, and free of the empty string a STIX object with no id would contribute. */
export const distinct = (ids: Array<string | null>): Array<string> =>
  [...new Set(ids.filter((id): id is string => id !== null && id !== ''))].sort();

/**
 * Reduces a batch of marked mirror rows to what has to be looked up and rebuilt. Rebuilding one
 * record costs about thirty round trips whatever triggered it, and one threat arrives with
 * dozens of relationships in a burst, so the unit of work is the actor, never the object.
 *
 * A tombstoned row still names its holders: its own `sourceRef` for a relationship, and for a
 * catalog object the live relationships still pointing at it.
 */
export const planPendingBatch = (rows: ReadonlyArray<PendingStreamObject>): PendingBatchPlan => {
  const directGroupStixIds: Array<string | null> = [];
  const targetedStixIds: Array<string | null> = [];
  const producerStixIds: Array<string | null> = [];
  const tombstonedGroupStixIds: Array<string | null> = [];

  for (const row of rows) {
    if (isThreatEntityType(row.stixType)) {
      directGroupStixIds.push(row.stixId);
      if (row.deletedAt !== null) {
        tombstonedGroupStixIds.push(row.stixId);
      }
      continue;
    }
    if (row.stixType === 'relationship') {
      directGroupStixIds.push(row.sourceRef);
      continue;
    }
    targetedStixIds.push(row.stixId);
    if (row.stixType === 'identity') {
      producerStixIds.push(row.stixId);
    }
  }

  return {
    directGroupStixIds: distinct(directGroupStixIds),
    targetedStixIds: distinct(targetedStixIds),
    producerStixIds: distinct(producerStixIds),
    tombstonedGroupStixIds: distinct(tombstonedGroupStixIds),
    marks: rows.map((row) => ({ stixId: row.stixId, watermark: row.watermark })),
  };
};
