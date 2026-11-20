import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  SUPPORTING_ASSET_FINDINGS_LIST_SEARCH_DEFAULTS,
  supportingAssetFindingsListSearchSchema,
} from './supporting-asset-findings-list-search';

// Mirrors the middleware wiring of routes/.../assets/$supportingAssetId/findings/index.tsx, without
// mounting the full app route tree.
const rootRoute = createRootRoute();
const findingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/findings',
  validateSearch: supportingAssetFindingsListSearchSchema,
  search: { middlewares: [stripSearchParams(SUPPORTING_ASSET_FINDINGS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([findingsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('supportingAssetFindingsListSearchSchema', () => {
  it('should show the applicable findings from a bare address', async () => {
    const router = await at('/findings');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'applicable' });
  });

  it('should keep default values out of the address', async () => {
    const router = await at('/findings?search=log4j&state=all');

    await router.navigate({ to: '.', search: () => SUPPORTING_ASSET_FINDINGS_LIST_SEARCH_DEFAULTS, replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should fall back to the applicable findings for a state that names none', async () => {
    const router = await at('/findings?state=resolved');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'applicable' });
  });

  it('should drop a technique the server would refuse', async () => {
    const empty = await at('/findings?technique=');
    const tooLong = await at(`/findings?technique=${'T'.repeat(33)}`);

    expect([empty, tooLong].map((router) => router.state.matches.at(-1)?.search)).toEqual([
      { search: '', state: 'applicable' },
      { search: '', state: 'applicable' },
    ]);
  });

  it('should cut a search to the length the server takes', async () => {
    const router = await at(`/findings?search=${'a'.repeat(250)}`);

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'a'.repeat(200), state: 'applicable' });
  });

  it('should read a numeric search term as text', async () => {
    const router = await at('/findings?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', state: 'applicable' });
  });
});
