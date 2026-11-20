import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantAccessor } from './tenant-accessor';

const rootRoute = createRootRoute();
const tenantRoute = createRoute({ getParentRoute: () => rootRoute, path: '$tenantId' });
const scopeRoute = createRoute({ getParentRoute: () => tenantRoute, path: '{-$organizationId}' });
const platformRoute = createRoute({ getParentRoute: () => rootRoute, path: 'platform' });

const routeTree = rootRoute.addChildren([
  tenantRoute.addChildren([scopeRoute]),
  platformRoute,
]);

const buildRouter = (initialPath: string) => createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: [initialPath] }),
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});

describe('committed tenant vs. a preload preview', () => {
  let router: ReturnType<typeof buildRouter>;
  let getTenantId: () => string | null;

  beforeEach(async () => {
    router = buildRouter('/tenant-1');
    getTenantId = createTenantAccessor(router).getTenantId;
    await router.load();
  });

  it('reads the tenant of the committed page', () => {
    expect(getTenantId()).toBe('tenant-1');
  });

  it('is untouched by preloading a tenant-less route', async () => {
    await router.preloadRoute({ to: '/platform' });

    expect(getTenantId()).toBe('tenant-1');
  });

  it('is untouched by preloading another tenant\'s route', async () => {
    await router.preloadRoute({ to: '/$tenantId/{-$organizationId}', params: { tenantId: 'tenant-2', organizationId: undefined } });

    expect(getTenantId()).toBe('tenant-1');
  });

  it('follows a real navigation to the newly committed tenant', async () => {
    await router.navigate({ to: '/$tenantId/{-$organizationId}', params: { tenantId: 'tenant-2', organizationId: undefined } });

    expect(getTenantId()).toBe('tenant-2');
  });
});

describe('the resolved tenant', () => {
  it('changes and notifies only once a navigation to another tenant has settled', async () => {
    const router = buildRouter('/tenant-1');
    const accessor = createTenantAccessor(router);
    await router.load();
    const listener = vi.fn();
    accessor.subscribeToResolvedTenant(listener);
    const seenWhileLoading: Array<string | null> = [];
    router.subscribe('onBeforeNavigate', () => seenWhileLoading.push(accessor.getResolvedTenantId()));

    await router.navigate({ to: '/$tenantId/{-$organizationId}', params: { tenantId: 'tenant-2', organizationId: undefined } });

    expect(seenWhileLoading).toEqual(['tenant-1']);
    expect(accessor.getResolvedTenantId()).toBe('tenant-2');
    expect(listener).toHaveBeenCalled();
  });

  it('stops notifying an unsubscribed listener', async () => {
    const router = buildRouter('/tenant-1');
    const accessor = createTenantAccessor(router);
    const listener = vi.fn();
    accessor.subscribeToResolvedTenant(listener)();

    await router.load();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('a tenant-scoped loader observed mid-navigation, before its route commits', () => {
  it('sees the destination tenant, not the tenant of the page still on screen', async () => {
    const seenDuringLoad: Array<string | null> = [];

    const destinationRoot = createRootRoute();
    const destinationTenantRoute = createRoute({ getParentRoute: () => destinationRoot, path: '$tenantId' });
    const destinationScopeRoute = createRoute({
      getParentRoute: () => destinationTenantRoute,
      path: '{-$organizationId}',
      loader: async () => {
        seenDuringLoad.push(getTenantId());
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    const destinationRouteTree = destinationRoot.addChildren([
      destinationTenantRoute.addChildren([destinationScopeRoute]),
    ]);
    const destinationRouter = createRouter({
      routeTree: destinationRouteTree,
      history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
    });
    const getTenantId = createTenantAccessor(destinationRouter).getTenantId;
    await destinationRouter.load();
    seenDuringLoad.length = 0;

    await destinationRouter.navigate({ to: '/$tenantId/{-$organizationId}', params: { tenantId: 'tenant-2', organizationId: undefined } });

    expect(seenDuringLoad).toEqual(['tenant-2']);
  });
});

describe('a navigation from a tenant to a route that names no tenant', () => {
  const observeDuringLoad = async (destination: '/' | '/platform') => {
    const seenDuringLoad: Array<string | null> = [];
    const record = () => {
      seenDuringLoad.push(getTenantId());
    };
    // Route ids as the app's file routes build them (`/_auth/platform` is the platform surface).
    const landingRoot = createRootRoute();
    const authRoute = createRoute({ getParentRoute: () => landingRoot, id: '_auth' });
    const landingTenantRoute = createRoute({ getParentRoute: () => authRoute, path: '$tenantId' });
    const landingScopeRoute = createRoute({ getParentRoute: () => landingTenantRoute, path: '{-$organizationId}' });
    const landingIndexRoute = createRoute({ getParentRoute: () => authRoute, path: '/', loader: record });
    const landingPlatformRoute = createRoute({ getParentRoute: () => authRoute, path: 'platform', loader: record });
    const landingRouter = createRouter({
      routeTree: landingRoot.addChildren([
        authRoute.addChildren([
          landingTenantRoute.addChildren([landingScopeRoute]),
          landingIndexRoute,
          landingPlatformRoute,
        ]),
      ]),
      history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
    });
    const getTenantId = createTenantAccessor(landingRouter).getTenantId;
    await landingRouter.load();

    await landingRouter.navigate({ to: destination });

    return { seenDuringLoad, afterResolve: getTenantId() };
  };

  it('keeps the tenant on screen while the landing route is still loading', async () => {
    const { seenDuringLoad } = await observeDuringLoad('/');

    expect(seenDuringLoad).toEqual(['tenant-1']);
  });

  it('drops the tenant at once for the platform surface', async () => {
    const { seenDuringLoad, afterResolve } = await observeDuringLoad('/platform');

    expect(seenDuringLoad).toEqual([null]);
    expect(afterResolve).toBeNull();
  });
});

describe('a request fired without an in-flight navigation or preload', () => {
  it('falls back to the committed matches', () => {
    const matches = [{ routeId: '/_auth/$tenantId', params: { tenantId: 'tenant-1' } }];
    const idle = {
      state: { matches },
      matchRoutes: vi.fn(),
      subscribe: vi.fn(),
    };

    expect(createTenantAccessor(idle).getTenantId()).toBe('tenant-1');
    expect(idle.matchRoutes).not.toHaveBeenCalled();
  });
});
