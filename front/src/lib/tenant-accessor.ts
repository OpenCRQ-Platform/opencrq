import type { MatchWithRouteId } from './committed-tenant-utils';
import { getTenantIdFromMatches, isPlatformScope } from './committed-tenant-utils';

interface TenantAwareRouter {
  state: { matches: ReadonlyArray<MatchWithRouteId> },
  matchRoutes: (pathname: string, search?: Record<string, unknown>) => ReadonlyArray<MatchWithRouteId>,
  subscribe: {
    (eventType: 'onBeforeNavigate', fn: (event: { toLocation: { pathname: string, search: Record<string, unknown> } }) => void): unknown,
    (eventType: 'onResolved', fn: () => void): unknown,
  },
}

// A preload lane (hover, `defaultPreload: 'intent'`) runs `beforeLoad`/`loader` for previewed
// routes without ever emitting `onBeforeNavigate` or touching `router.state.matches` — those only
// change for a real navigation. A real navigation's own `beforeLoad`/`loader` chain runs before
// its matches commit though, so tracking only `state.matches` would send a tenant-scoped call
// made from *inside* that chain (e.g. a destination's own `beforeLoad`) with the previous tenant.
// `onBeforeNavigate` fires synchronously as soon as a real navigation starts (before any
// `beforeLoad` runs) and only for a real navigation, so it gives the destination's matches early
// without ever being reachable from a preview.
interface TenantAccessor {
  getTenantId: () => string | null,
  /** The tenant of the page on screen, which a navigation still loading has not changed yet. */
  getResolvedTenantId: () => string | null,
  subscribeToResolvedTenant: (listener: () => void) => () => void,
}

export const createTenantAccessor = (router: TenantAwareRouter): TenantAccessor => {
  let pendingMatches: ReadonlyArray<MatchWithRouteId> | null = null;
  let resolvedTenantId = getTenantIdFromMatches(router.state.matches);
  const listeners = new Set<() => void>();
  router.subscribe('onBeforeNavigate', ({ toLocation }) => {
    pendingMatches = router.matchRoutes(toLocation.pathname, toLocation.search);
  });
  // `onLoad` commits the new matches before the destination page actually renders, so a component
  // still unmounting for the page being left could fire one more query in that gap and have it
  // stripped of a tenant header it still needs. `onResolved` fires only once the transition settles,
  // closing that gap, and unlike `onRendered` it isn't gated on a mounted `RouterProvider` re-rendering.
  router.subscribe('onResolved', () => {
    pendingMatches = null;
    resolvedTenantId = getTenantIdFromMatches(router.state.matches);
    listeners.forEach((listener) => listener());
  });

  const committedTenantId = () => getTenantIdFromMatches(router.state.matches);
  // A destination that names no tenant and is not the platform surface (the landing route `/`, which
  // only redirects to a tenant) does not end the tenant on screen: until it resolves, that page stays
  // mounted and any query it renders or refetches still needs its header. Answering null there sent
  // those queries without `x-tenant-id` and the tenant-scoped procedures rejected them. The landing
  // route's own calls are tenant-independent, so a header they carry over is harmless.
  const pendingTenantId = (matches: ReadonlyArray<MatchWithRouteId>) => {
    const tenantId = getTenantIdFromMatches(matches, { ignoreContext: true });
    if (tenantId !== null || isPlatformScope(matches.at(-1)?.routeId)) {
      return tenantId;
    }
    return committedTenantId();
  };

  return {
    getTenantId: () => (pendingMatches ? pendingTenantId(pendingMatches) : committedTenantId()),
    getResolvedTenantId: () => resolvedTenantId,
    subscribeToResolvedTenant: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

// Data-fetching modules (`trpc.ts`, `client-report-queue.ts`) need the committed tenant but must
// never import the router module itself: `router.ts` pulls in `routeTree.gen.ts`, which statically
// imports every route file, several of which import those same data-fetching modules back through
// the `lib` barrel. `router.ts` registers its instance here once, so the rest of the app depends
// only on this leaf module.
let tenantAccessor: TenantAccessor | null = null;

export const registerRouter = (router: TenantAwareRouter): void => {
  tenantAccessor = createTenantAccessor(router);
};

export const getCommittedTenantId = (): string | null => tenantAccessor?.getTenantId() ?? null;

export const getResolvedTenantId = (): string | null => tenantAccessor?.getResolvedTenantId() ?? null;

export const subscribeToResolvedTenant = (listener: () => void): () => void =>
  tenantAccessor?.subscribeToResolvedTenant(listener) ?? (() => undefined);

let boundTenant: { tenantId: string | null } | null = null;

/**
 * Runs `fn` with the requests it starts synchronously bound to `tenantId` rather than to the
 * committed tenant. A request started after `fn` returns, past an `await`, is not bound.
 */
export const runInTenant = <T>(tenantId: string | null, fn: () => T): T => {
  const outer = boundTenant;
  boundTenant = { tenantId };
  try {
    return fn();
  } finally {
    boundTenant = outer;
  }
};

export const getRequestTenantId = (): string | null => (boundTenant ? boundTenant.tenantId : getCommittedTenantId());
