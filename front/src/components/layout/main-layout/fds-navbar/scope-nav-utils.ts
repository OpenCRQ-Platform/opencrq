/** The first and last words' initials, or a lone word's first two letters. */
export const scopeInitials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return '';
  }
  if (words.length === 1) {
    return [...words[0]].slice(0, 2).join('').toUpperCase();
  }
  return `${[...words[0]][0]}${[...words[words.length - 1]][0]}`.toUpperCase();
};

export const barScopes = <T extends { id: string, name: string }>(
  scopes: Array<T>,
  unpinnedIds: ReadonlySet<string>,
  rememberedScopeId: string | null,
): Array<T> => {
  const pinned = scopes
    .filter((scope) => !unpinnedIds.has(scope.id))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const remembered = rememberedScopeId !== null && unpinnedIds.has(rememberedScopeId)
    ? scopes.find((scope) => scope.id === rememberedScopeId)
    : undefined;
  return remembered ? [...pinned, remembered] : pinned;
};
