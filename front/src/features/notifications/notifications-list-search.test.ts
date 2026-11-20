import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { NOTIFICATIONS_LIST_SEARCH_DEFAULTS, notificationsListSearchSchema } from './notifications-list-search';

// Mirrors the middleware wiring of routes/.../notifications/index.tsx, without mounting the full
// app route tree.
const rootRoute = createRootRoute();
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  validateSearch: notificationsListSearchSchema,
  search: { middlewares: [stripSearchParams(NOTIFICATIONS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([notificationsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('notificationsListSearchSchema', () => {
  it('should keep a default status value out of the address', async () => {
    const router = await at('/notifications?status=unread');

    await router.navigate({ to: '.', search: () => ({ status: 'all' as const }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should fall back to the default status for a value the schema rejects, without throwing', async () => {
    const router = await at('/notifications?status=bogus');

    expect(router.state.matches.at(-1)?.search).toEqual({ status: 'all' });
  });

  it('should read a status from the address', async () => {
    const router = await at('/notifications?status=unread');

    expect(router.state.matches.at(-1)?.search).toEqual({ status: 'unread' });
  });

  it('should fall back to the default status for a numeric value, without throwing', async () => {
    const router = await at('/notifications?status=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ status: 'all' });
  });

  it('should fall back to the default status for a boolean-shaped value, without throwing', async () => {
    const router = await at('/notifications?status=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ status: 'all' });
  });
});
