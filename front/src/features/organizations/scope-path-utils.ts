interface LocationParts {
  pathname: string,
  searchStr: string,
  hash: string,
}

/**
 * The same address opened in `organizationId`: the risk scope segment that follows the tenant is
 * replaced, or inserted on a tenant address, keeping the tab, the search and the hash.
 */
export const riskScopeHref = (
  location: LocationParts,
  tenantId: string,
  currentOrganizationId: string | undefined,
  organizationId: string,
): string => {
  const segments = location.pathname.split('/');
  const scopeIndex = segments.indexOf(tenantId) + 1;
  segments.splice(scopeIndex, currentOrganizationId === undefined ? 0 : 1, organizationId);
  return `${segments.join('/')}${location.searchStr}${location.hash === '' ? '' : `#${location.hash}`}`;
};
