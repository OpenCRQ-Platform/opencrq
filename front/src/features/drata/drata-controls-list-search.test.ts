import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { DRATA_CONTROLS_LIST_SEARCH_DEFAULTS, drataControlsListSearchSchema } from './drata-controls-list-search';

// Mirrors the middleware wiring of routes/.../compliance/$frameworkId/controls.tsx,
// without mounting the full app route tree.
const rootRoute = createRootRoute();
const controlsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/controls',
  validateSearch: drataControlsListSearchSchema,
  search: { middlewares: [stripSearchParams(DRATA_CONTROLS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([controlsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('drataControlsListSearchSchema', () => {
  it('should keep a default search value out of the address', async () => {
    const router = await at('/controls?search=mfa');

    await router.navigate({ to: '.', search: () => ({ search: '' }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read a search term from the address', async () => {
    const router = await at('/controls?search=mfa');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'mfa', notReadyOnly: true });
  });

  it('should list every control when the address turns the toggle off', async () => {
    const router = await at('/controls?notReadyOnly=false');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', notReadyOnly: false });
  });

  it('should keep the toggle out of the address when it is back on its default', async () => {
    const router = await at('/controls?notReadyOnly=false');

    await router.navigate({ to: '.', search: () => ({ notReadyOnly: true }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    const router = await at('/controls?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', notReadyOnly: true });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it', async () => {
    const router = await at('/controls?search=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'true', notReadyOnly: true });
  });
});
