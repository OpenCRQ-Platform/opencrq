import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { DRATA_REQUIREMENTS_LIST_SEARCH_DEFAULTS, drataRequirementsListSearchSchema } from './drata-requirements-list-search';

// Mirrors the middleware wiring of routes/.../compliance/$frameworkId/requirements.tsx,
// without mounting the full app route tree.
const rootRoute = createRootRoute();
const requirementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/requirements',
  validateSearch: drataRequirementsListSearchSchema,
  search: { middlewares: [stripSearchParams(DRATA_REQUIREMENTS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([requirementsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('drataRequirementsListSearchSchema', () => {
  it('should keep a default search value out of the address', async () => {
    const router = await at('/requirements?search=mfa');

    await router.navigate({ to: '.', search: () => ({ search: '' }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read a search term from the address', async () => {
    const router = await at('/requirements?search=mfa');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'mfa', inScopeOnly: false, notReadyOnly: false });
  });

  it('should read both toggles from the address', async () => {
    const router = await at('/requirements?inScopeOnly=true&notReadyOnly=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', inScopeOnly: true, notReadyOnly: true });
  });

  it('should keep a toggle out of the address when it is back on its default', async () => {
    const router = await at('/requirements?inScopeOnly=true');

    await router.navigate({ to: '.', search: () => ({ inScopeOnly: false }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    const router = await at('/requirements?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', inScopeOnly: false, notReadyOnly: false });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it', async () => {
    const router = await at('/requirements?search=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'true', inScopeOnly: false, notReadyOnly: false });
  });
});
