/**
 * The pure decision behind a tag origin resync: given what an origin
 * (a connector, or a person for a manual tag) already points at and what it reports now, decide
 * whether the canonical tag it targets should be renamed in place, split off, merged into another
 * one, or newly created — without touching the database. The caller resolves the inputs from
 * storage and carries out the resulting action.
 */

export interface TagOriginState {
  /** The canonical tag this origin currently points at. */
  tagId: string,
  /** What this origin reported the last time it was resolved. */
  reportedName: string,
  /** The name the tag carries now, which a user may have changed. */
  tagName: string,
  tagIsMerged: boolean,
}

export interface TagResolutionContext {
  reportedName: string,
  /** `null` when this is the first time this origin is being resolved (a new connector tag, or a new manual tag). */
  existingOrigin: TagOriginState | null,
  /** Whether `existingOrigin` is the only origin of its tag — irrelevant when `existingOrigin` is `null`. */
  isSoleOriginOfCurrentTag: boolean,
  /** The id of the tenant's canonical tag already named `reportedName`, if one exists. */
  existingTagIdForReportedName: string | null,
}

export type TagResolution =
  /** The origin stays on its tag, which is already correct or which a user renamed or merged; only its stored `reportedName`/`reportedColor` need refreshing. */
  | { action: 'noop' }
  /** The origin is its tag's only one: rename that tag row in place. */
  | { action: 'renameInPlace' }
  /** The origin has siblings still reporting the old name: create a new tag and move this origin onto it. */
  | { action: 'split' }
  /** The new name is already another tag's: move this origin there. `deleteOldTag` when that leaves the old tag with no origin left. */
  | { action: 'merge', targetTagId: string, deleteOldTag: boolean }
  /** An unknown origin whose reported name matches an existing tag: attach it there rather than duplicating. */
  | { action: 'attachExisting', targetTagId: string }
  /** An unknown origin with no matching tag: create both. */
  | { action: 'createNew' };

export const resolveTagOrigin = (ctx: TagResolutionContext): TagResolution => {
  const { reportedName, existingOrigin, isSoleOriginOfCurrentTag, existingTagIdForReportedName } = ctx;

  if (existingOrigin === null) {
    return existingTagIdForReportedName !== null
      ? { action: 'attachExisting', targetTagId: existingTagIdForReportedName }
      : { action: 'createNew' };
  }

  if (existingOrigin.reportedName === reportedName) {
    return { action: 'noop' };
  }

  // A tag a user renamed or merged is theirs: the connector's rename must not undo it.
  if (existingOrigin.tagName !== existingOrigin.reportedName || existingOrigin.tagIsMerged) {
    return { action: 'noop' };
  }

  if (existingTagIdForReportedName === null) {
    return isSoleOriginOfCurrentTag ? { action: 'renameInPlace' } : { action: 'split' };
  }

  if (existingTagIdForReportedName === existingOrigin.tagId) {
    // The canonical tag already carries the new name — only this origin's own record was stale.
    return { action: 'noop' };
  }

  return { action: 'merge', targetTagId: existingTagIdForReportedName, deleteOldTag: isSoleOriginOfCurrentTag };
};

/**
 * The manual tag names a person typed, ready for `resolveTagOrigin`: trimmed, blanks dropped,
 * duplicates collapsed. Case is kept as typed rather than folded — the tenant's vocabulary itself
 * is case-sensitive (`tags_tenant_name_uq`), and a connector's own tag names are never folded on
 * case either, so a manual entry follows the same rule rather than inventing a second one.
 */
export const normalizeManualTagNames = (names: ReadonlyArray<string>): Array<string> =>
  [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))];
