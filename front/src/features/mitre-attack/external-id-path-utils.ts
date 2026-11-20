interface LocationParts {
  pathname: string,
  searchStr: string,
  hash: string,
}

/**
 * ATT&CK identifiers are uppercase (T1003.001, TA0006) and looked up exactly, so an address typed
 * in lowercase is sent to its uppercase spelling, keeping the tab, the search and the hash. Null
 * when the identifier is already canonical.
 */
export const canonicalExternalIdHref = (location: LocationParts, externalId: string): string | null => {
  const canonical = externalId.toUpperCase();
  if (canonical === externalId) {
    return null;
  }
  const segments = location.pathname.split('/');
  const index = segments.lastIndexOf(externalId);
  if (index === -1) {
    return null;
  }
  segments[index] = canonical;
  return `${segments.join('/')}${location.searchStr}${location.hash === '' ? '' : `#${location.hash}`}`;
};
