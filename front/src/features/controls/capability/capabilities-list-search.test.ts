import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES_LIST_SEARCH_DEFAULTS, capabilitiesListSearchSchema } from './capabilities-list-search';

// Mirrors the middleware wiring of routes/.../controls/index.tsx, without mounting the full app
// route tree.
const rootRoute = createRootRoute();
const controlsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/controls',
  validateSearch: capabilitiesListSearchSchema,
  search: { middlewares: [stripSearchParams(CAPABILITIES_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([controlsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('capabilitiesListSearchSchema', () => {
  it('should keep default values out of the address', async () => {
    const router = await at('/controls?search=mfa&assessment=unassessed');

    await router.navigate({ to: '.', search: () => ({ search: '', assessment: 'all' as const }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should fall back to the default assessment for a value the schema rejects, without throwing', async () => {
    const router = await at('/controls?assessment=bogus');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', assessment: 'all' });
  });

  it('should read a search term and assessment from the address', async () => {
    const router = await at('/controls?search=mfa&assessment=unassessed');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'mfa', assessment: 'unassessed' });
  });

  it('should read the overridden filter from the address', async () => {
    const router = await at('/controls?assessment=forced');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', assessment: 'forced' });
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    const router = await at('/controls?search=42');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '42', assessment: 'all' });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it', async () => {
    const router = await at('/controls?search=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'true', assessment: 'all' });
  });

  it('should still open an older shared link carrying a family parameter, without throwing', async () => {
    const router = await at('/controls?family=identity&search=mfa');

    expect(router.state.matches.at(-1)?.search).toMatchObject({ search: 'mfa', assessment: 'all' });
  });
});
