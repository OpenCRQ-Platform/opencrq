export interface MatchWithRouteId {
  routeId: string,
  params: Record<string, unknown>,
  // `unknown`, not a shaped object: real route context types are concrete per-route interfaces
  // with no index signature, so a narrower type here would reject them at every call site.
  context?: unknown,
}

// The tenant-less platform surface carries no tenant at all and sets no `securityScope` context
// of its own (its own route guard already keeps it platform-only).
const PLATFORM_ROUTE_IDS = ['/_auth/platform'];

const hasSecurityScope = (context: unknown): context is { securityScope: unknown } =>
  typeof context === 'object' && context !== null && 'securityScope' in context;

/**
 * Whether a leaf route sits on the platform scope: the tenant-less surface, or the merged
 * Security section resolved to `securityScope: 'platform'` in its route context. Route ids are
 * hierarchical, so the leaf alone already reflects every ancestor a `PLATFORM_ROUTE_IDS` prefix
 * check would otherwise walk the chain for.
 */
export const isPlatformScope = (routeId: string | undefined, context?: unknown): boolean =>
  routeId !== undefined && (
    PLATFORM_ROUTE_IDS.some((id) => routeId === id || routeId.startsWith(`${id}/`))
    || (hasSecurityScope(context) && context.securityScope === 'platform')
  );

export interface TenantFromMatchesOptions {
  /**
   * A pending match's `context` is not reliably "not yet resolved": when only the search string
   * changes on an already-matched route (switching the Security section between `?scope=platform`
   * and no scope), `matchRoutes`'s synchronous preview has been observed to carry over that route's
   * *previously committed* context instead of leaving it unset. Trusting it during the window can
   * therefore read the scope being left, not the one being entered — e.g. leaving `?scope=platform`
   * strips the tenant header the destination's own tenant-scoped capability probe needs, which
   * fails outright since it never tolerates a missing header the way an over-included one is
   * harmless. Ignoring context here and falling back to the route id check alone reproduces the
   * pre-fix guarantee that a call made mid-navigation always carries a tenant. Defaults to false;
   * the pending-match caller in `tenant-accessor.ts` passes true.
   */
  ignoreContext?: boolean,
}

export const getTenantIdFromMatches = (
  matches: ReadonlyArray<MatchWithRouteId>,
  { ignoreContext = false }: TenantFromMatchesOptions = {},
): string | null => {
  const leafMatch = matches.at(-1);
  if (isPlatformScope(leafMatch?.routeId, ignoreContext ? undefined : leafMatch?.context)) {
    return null;
  }

  const tenantId = leafMatch?.params.tenantId;
  return typeof tenantId === 'string' ? tenantId : null;
};
