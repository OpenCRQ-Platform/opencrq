import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { USERS_LIST_SEARCH_DEFAULTS, usersListSearchSchema } from './users-list-search';

// Mirrors the middleware wiring of routes/.../settings/security/users/index.tsx, without mounting
// the full app route tree.
const rootRoute = createRootRoute();
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  validateSearch: usersListSearchSchema,
  search: { middlewares: [stripSearchParams(USERS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([usersRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('usersListSearchSchema', () => {
  it('should keep a default search value out of the address', async () => {
    const router = await at('/users?search=alex');

    await router.navigate({ to: '.', search: () => ({ search: '' }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read a search term from the address', async () => {
    const router = await at('/users?search=alex');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'alex' });
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    // The router's default search parser JSON-parses a value made only of digits, so a purely
    // numeric search term arrives as a number rather than a string.
    const router = await at('/users?search=123');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '123' });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it', async () => {
    const router = await at('/users?search=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'true' });
  });
});
