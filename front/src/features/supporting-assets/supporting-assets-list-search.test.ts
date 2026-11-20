import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS, supportingAssetsListSearchSchema } from './supporting-assets-list-search';

// Mirrors the middleware wiring of routes/_auth/$tenantId/{-$organizationId}/assets/index.tsx,
// without mounting the full app route tree.
const rootRoute = createRootRoute();
const assetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assets',
  validateSearch: supportingAssetsListSearchSchema,
  search: { middlewares: [stripSearchParams(SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([assetsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('supportingAssetsListSearchSchema', () => {
  it('should keep a default search value out of the address', async () => {
    const router = await at('/assets?search=vpn&source=drata');

    await router.navigate({ to: '.', search: () => SUPPORTING_ASSETS_LIST_SEARCH_DEFAULTS, replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should carry a source the tenant may no longer have, for resolveOptionFilter to drop at render', async () => {
    const router = await at('/assets?source=drata');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'drata', category: 'all', categoryMode: 'only', group: 'all' });
  });

  it('should fall back to no source filter for a value that names no source at all', async () => {
    const router = await at('/assets?source=a-source-that-never-existed');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all', category: 'all', categoryMode: 'only', group: 'all' });
  });

  it('should read a search term from the address', async () => {
    const router = await at('/assets?search=vpn');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'vpn', source: 'all', category: 'all', categoryMode: 'only', group: 'all' });
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    // The router's default search parser JSON-parses a value made only of digits, so a purely
    // numeric search term arrives as a number rather than a string.
    const router = await at('/assets?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', source: 'all', category: 'all', categoryMode: 'only', group: 'all' });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it', async () => {
    const router = await at('/assets?search=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'true', source: 'all', category: 'all', categoryMode: 'only', group: 'all' });
  });

  it('should fall back to no source filter for a numeric source value', async () => {
    const router = await at('/assets?source=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all', category: 'all', categoryMode: 'only', group: 'all' });
  });

  it('should read a category filter and its direction from the address', async () => {
    const router = await at('/assets?category=identity&categoryMode=except');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all', category: 'identity', categoryMode: 'except', group: 'all' });
  });

  it('should fall back to no category filter for a value that names no category at all', async () => {
    const router = await at('/assets?category=a-category-that-never-existed');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all', category: 'all', categoryMode: 'only', group: 'all' });
  });

  it('should fall back to the including direction for a mode it does not know', async () => {
    const router = await at('/assets?category=identity&categoryMode=sideways');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all', category: 'identity', categoryMode: 'only', group: 'all' });
  });

  it('should read a group filter from the address', async () => {
    const groupId = '0190f2b4-6c1e-7a3b-8d4f-2e5a6b7c8d9e';
    const router = await at(`/assets?group=${groupId}`);

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all', category: 'all', categoryMode: 'only', group: groupId });
  });

  it('should fall back to no group filter for a value that is no group id', async () => {
    const router = await at('/assets?group=not-a-group');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all', category: 'all', categoryMode: 'only', group: 'all' });
  });
});
