import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { beforeAll, describe, expect, it } from 'vitest';

const rootRoute = createRootRoute();
const tenantRoute = createRoute({ getParentRoute: () => rootRoute, path: '$tenantId' });
const scopeRoute = createRoute({ getParentRoute: () => tenantRoute, path: '{-$organizationId}' });
const findingRoute = createRoute({ getParentRoute: () => scopeRoute, path: 'findings/$evidenceId' });
const assetRoute = createRoute({ getParentRoute: () => scopeRoute, path: 'assets/$supportingAssetId' });
const riskScopesRoute = createRoute({ getParentRoute: () => scopeRoute, path: 'risk-scopes' });
const platformRoute = createRoute({ getParentRoute: () => tenantRoute, path: 'platform/tenants' });

const routeTree = rootRoute.addChildren([
  tenantRoute.addChildren([
    scopeRoute.addChildren([findingRoute, assetRoute, riskScopesRoute]),
    platformRoute,
  ]),
]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

let scoped: Awaited<ReturnType<typeof at>>;
let unscoped: Awaited<ReturnType<typeof at>>;

beforeAll(async () => {
  scoped = await at('/tenant-1/org-1/findings/finding-1');
  unscoped = await at('/tenant-1/findings/finding-1');
});

describe('an absolute scoped destination', () => {
  it('keeps the active organization when the params name only the target entity', () => {
    const built = scoped.buildLocation({
      to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId',
      params: { tenantId: 'tenant-1', supportingAssetId: 'asset-1' },
    });

    expect(built.pathname).toBe('/tenant-1/org-1/assets/asset-1');
  });

  it('keeps it through a params updater that returns a fresh object', () => {
    const built = scoped.buildLocation({
      to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId',
      params: (prev: Record<string, string>) => ({ tenantId: prev.tenantId, supportingAssetId: 'asset-1' }),
    });

    expect(built.pathname).toBe('/tenant-1/org-1/assets/asset-1');
  });

  it('adds no segment when no organization is active', () => {
    const built = unscoped.buildLocation({
      to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId',
      params: { tenantId: 'tenant-1', supportingAssetId: 'asset-1' },
    });

    expect(built.pathname).toBe('/tenant-1/assets/asset-1');
  });

  it('takes the organization the caller names over the active one', () => {
    const built = scoped.buildLocation({
      to: '/$tenantId/{-$organizationId}/assets/$supportingAssetId',
      params: { tenantId: 'tenant-1', organizationId: 'org-2', supportingAssetId: 'asset-1' },
    });

    expect(built.pathname).toBe('/tenant-1/org-2/assets/asset-1');
  });

  it('leaves the scope behind for a destination that sits outside the segment', () => {
    const built = scoped.buildLocation({ to: '/platform/security/tenants' });

    expect(built.pathname).toBe('/platform/security/tenants');
  });

  it('keeps the active organization on the organization list, which sits inside the segment', () => {
    const built = scoped.buildLocation({ to: '/$tenantId/{-$organizationId}/risk-scopes', params: { tenantId: 'tenant-1' } });

    expect(built.pathname).toBe('/tenant-1/org-1/risk-scopes');
  });
});

describe('the organization list, now a child of the optional segment', () => {
  it('reads a bare address as the list itself, not as an organization named after it', async () => {
    const router = await at('/tenant-1/risk-scopes');

    expect(router.state.matches.at(-1)?.routeId).toBe('/$tenantId/{-$organizationId}/risk-scopes');
    expect(router.state.matches.at(-1)?.params).toEqual({ tenantId: 'tenant-1' });
  });

  it('reads a scoped address as the list inside that organization', async () => {
    const router = await at('/tenant-1/org-1/risk-scopes');

    expect(router.state.matches.at(-1)?.routeId).toBe('/$tenantId/{-$organizationId}/risk-scopes');
    expect(router.state.matches.at(-1)?.params).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' });
  });
});
