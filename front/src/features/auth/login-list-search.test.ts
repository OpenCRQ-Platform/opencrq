import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { loginListSearchSchema } from './login-list-search';

// Mirrors the search wiring of routes/login.tsx, without mounting the full app route tree.
const rootRoute = createRootRoute();
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: loginListSearchSchema,
});
const routeTree = rootRoute.addChildren([loginRoute]);

const at = async (href: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [href] }) });
  await router.load();
  return router;
};

describe('loginListSearchSchema', () => {
  it('should read a reason the backend sends', async () => {
    const router = await at('/login?xtm_sign_in_error=conflict');

    expect(router.state.matches.at(-1)?.search).toMatchObject({ xtm_sign_in_error: 'conflict' });
  });

  it('should read an unknown reason as a failed attempt, never as no attempt', async () => {
    const router = await at('/login?xtm_sign_in_error=renamed-reason');

    expect(router.state.matches.at(-1)?.search).toMatchObject({ xtm_sign_in_error: 'failed' });
  });

  it('should read no reason without one', async () => {
    const router = await at('/login');

    expect(router.state.matches.at(-1)?.search).toEqual({});
  });
});
