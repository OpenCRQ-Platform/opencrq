/**
 * What the navigation bar remembers of a user's way through a tenant's scopes: the last scope an
 * address carried, and the unpinned scope the bar keeps after the pinned ones.
 */
export interface ScopeMemory {
  lastScopeId: string | null,
  unpinnedScopeId: string | null,
}

export const EMPTY_SCOPE_MEMORY: ScopeMemory = { lastScopeId: null, unpinnedScopeId: null };

export const afterScopeOpened = (memory: ScopeMemory, scopeId: string, unpinnedIds: ReadonlySet<string>): ScopeMemory => ({
  lastScopeId: scopeId,
  unpinnedScopeId: unpinnedIds.has(scopeId) ? scopeId : memory.unpinnedScopeId,
});

/** Unpinning the scope the user is in keeps it in the bar rather than removing it from under them. */
export const afterPinChanged = (memory: ScopeMemory, scopeId: string, pinned: boolean): ScopeMemory => {
  if (pinned) {
    return memory.unpinnedScopeId === scopeId ? { ...memory, unpinnedScopeId: null } : memory;
  }
  return memory.lastScopeId === scopeId ? { ...memory, unpinnedScopeId: scopeId } : memory;
};

/** Undoes a pin change the server refused, unless another scope became the bar entry since. */
export const afterPinFailed = (memory: ScopeMemory, before: ScopeMemory, after: ScopeMemory): ScopeMemory => (
  memory.unpinnedScopeId === after.unpinnedScopeId ? { ...memory, unpinnedScopeId: before.unpinnedScopeId } : memory
);

export const withPinned = (unpinnedIds: ReadonlyArray<string>, scopeId: string, pinned: boolean): Array<string> => (
  pinned ? unpinnedIds.filter((id) => id !== scopeId) : [...new Set([...unpinnedIds, scopeId])]
);

export const sameScopeMemory = (left: ScopeMemory, right: ScopeMemory): boolean =>
  left.lastScopeId === right.lastScopeId && left.unpinnedScopeId === right.unpinnedScopeId;
