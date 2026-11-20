/**
 * The owner a push names, resolved to a member of the tenant (#3152, section 3).
 *
 * XTM One and OpenAEV carry an asset's owner as free text; OpenCRQ's `owner_id` is a platform user.
 * A push that names an owner resolves it here: the email first, then the display name, both exact
 * and case-insensitive. A single member matching sets `owner_id`; none or several leave it as it is
 * and the push reports the name as unresolved. An owner a person set by hand is never replaced.
 */

/** Who set `owner_id`: a person (`manual`) or a push that resolved a name (`resolved`). */
export const ASSET_OWNER_SOURCE_VALUES = ['manual', 'resolved'] as const;
export type AssetOwnerSource = typeof ASSET_OWNER_SOURCE_VALUES[number];

/** A member of the tenant the owner text is matched against. `name` is the name shown in the tenant. */
export type OwnerCandidate = { id: string, email: string, name: string | null };

export type OwnerResolution =
  | { status: 'matched', userId: string }
  | { status: 'unmatched' }
  | { status: 'ambiguous', count: number };

const fold = (value: string): string => value.trim().toLowerCase();

/**
 * Matches `ownerText` against `candidates`: an email match wins over a name match, so a member whose
 * email is the text is chosen even when another member's display name is the same text.
 */
export const resolveOwner = (ownerText: string, candidates: ReadonlyArray<OwnerCandidate>): OwnerResolution => {
  const wanted = fold(ownerText);
  if (!wanted) {
    return { status: 'unmatched' };
  }
  const distinct = (matches: ReadonlyArray<OwnerCandidate>) => [...new Set(matches.map((candidate) => candidate.id))];
  for (const matches of [
    distinct(candidates.filter((candidate) => fold(candidate.email) === wanted)),
    distinct(candidates.filter((candidate) => candidate.name !== null && fold(candidate.name) === wanted)),
  ]) {
    if (matches.length === 1) {
      return { status: 'matched', userId: matches[0] };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', count: matches.length };
    }
  }
  return { status: 'unmatched' };
};

/** What a push does to the owner of one asset, and what it tells the caller. */
export type OwnerDecision = {
  /** Absent: `owner_id` and its source are left as they are. */
  write?: { ownerId: string, ownerSource: AssetOwnerSource },
  report: { name: string, outcome: 'resolved' | 'unresolved' | 'ambiguous' | 'kept_manual' },
};

/**
 * The owner write of a push naming `ownerText`, given the asset's current owner. A hand-set owner
 * stays; a match sets the owner as `resolved`; no match and an ambiguous match change nothing, so a
 * push never clears an owner.
 */
export const decideOwnerWrite = (
  ownerText: string,
  current: { ownerId: string | null, ownerSource: AssetOwnerSource | null } | null,
  resolution: OwnerResolution,
): OwnerDecision => {
  const name = ownerText.trim();
  if (current?.ownerId && current.ownerSource !== 'resolved') {
    return { report: { name, outcome: 'kept_manual' } };
  }
  switch (resolution.status) {
    case 'matched':
      return { write: { ownerId: resolution.userId, ownerSource: 'resolved' }, report: { name, outcome: 'resolved' } };
    case 'ambiguous':
      return { report: { name, outcome: 'ambiguous' } };
    case 'unmatched':
      return { report: { name, outcome: 'unresolved' } };
  }
};
