/**
 * The pure decisions behind asset groups (#3152, section 2), kept apart from the database so they
 * are unit-tested on their own: which stored group a pushed group designates, and which membership
 * rows of one author a replace keeps, deletes and inserts.
 */

/** A group as stored, reduced to what a push is matched against. */
export type StoredAssetGroup = {
  id: string,
  name: string,
  externalReference: string | null,
  /** Set for a group a connector reported: a push may link assets to it, never rename it. */
  connectorId: string | null,
};

/** A group as a push names it: by its name, and optionally by the id the customer's system gave it. */
export type PushedAssetGroup = { name: string, externalReference?: string | null };

export type AssetGroupMatch =
  /** No stored group is designated: create one with the pushed name and reference. */
  | { action: 'create', name: string, externalReference: string | null }
  /** A stored group is designated; `update` carries what the push changes on it, absent when nothing. */
  | { action: 'use', groupId: string, update?: { name?: string, externalReference?: string } };

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

/** The pushed groups trimmed, blanks dropped, and collapsed on their reference, else on their name. */
export const normalizePushedGroups = (groups: ReadonlyArray<PushedAssetGroup>): Array<{ name: string, externalReference: string | null }> => {
  const byKey = new Map<string, { name: string, externalReference: string | null }>();
  for (const group of groups) {
    const name = clean(group.name);
    if (name === null) {
      continue;
    }
    const externalReference = clean(group.externalReference);
    const key = externalReference !== null ? `ref:${externalReference}` : `name:${name}`;
    if (!byKey.has(key)) {
      byKey.set(key, { name, externalReference });
    }
  }
  return [...byKey.values()];
};

/**
 * The stored group a pushed one designates: the group carrying its external reference first, then
 * the group carrying its exact name (a group of no connector preferred over a connector's, then the
 * first in the order given). A matched group a person or XTM One owns follows the push: renamed when
 * matched on its reference, given the reference when matched on its name and holding none. A
 * connector's group is never changed by a push, which only links assets to it.
 */
export const matchPushedGroup = (
  pushed: { name: string, externalReference: string | null },
  stored: ReadonlyArray<StoredAssetGroup>,
): AssetGroupMatch => {
  if (pushed.externalReference !== null) {
    const byReference = stored.find((group) => group.externalReference === pushed.externalReference);
    if (byReference) {
      const rename = byReference.connectorId === null && byReference.name !== pushed.name;
      return rename
        ? { action: 'use', groupId: byReference.id, update: { name: pushed.name } }
        : { action: 'use', groupId: byReference.id };
    }
  }
  const byName = stored.filter((group) => group.name === pushed.name);
  const chosen = byName.find((group) => group.connectorId === null) ?? byName.at(0);
  if (!chosen) {
    return { action: 'create', name: pushed.name, externalReference: pushed.externalReference };
  }
  const giveReference = pushed.externalReference !== null && chosen.connectorId === null && chosen.externalReference === null;
  return giveReference
    ? { action: 'use', groupId: chosen.id, update: { externalReference: pushed.externalReference ?? undefined } }
    : { action: 'use', groupId: chosen.id };
};

/**
 * The write that makes one author's membership rows equal to `wanted`, a set of `${groupId}::${assetId}`
 * keys: a row the new set keeps is not touched (it keeps its id and writes nothing), a second row for a
 * kept key is swept with the stale ones, and only the missing keys are inserted.
 */
export const diffMemberships = (
  held: ReadonlyArray<{ id: string, assetGroupId: string, supportingAssetId: string }>,
  wanted: ReadonlyArray<{ assetGroupId: string, supportingAssetId: string }>,
): { staleIds: Array<string>, missing: Array<{ assetGroupId: string, supportingAssetId: string }> } => {
  const keyOf = (row: { assetGroupId: string, supportingAssetId: string }) => `${row.assetGroupId}::${row.supportingAssetId}`;
  const wantedByKey = new Map(wanted.map((row) => [keyOf(row), row]));
  const kept = new Set<string>();
  const staleIds: Array<string> = [];
  for (const row of held) {
    const key = keyOf(row);
    if (wantedByKey.has(key) && !kept.has(key)) {
      kept.add(key);
    } else {
      staleIds.push(row.id);
    }
  }
  const missing = [...wantedByKey].filter(([key]) => !kept.has(key)).map(([, row]) => row);
  return { staleIds, missing };
};
