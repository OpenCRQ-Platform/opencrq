import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { TENANTS_LIST_SEARCH_DEFAULTS, tenantsListSearchSchema } from './tenants-list-search';

// Two routes sharing the exact same schema and defaults, standing in for the table's two real
// mount points: platform/security/tenants and $tenantId/{-$organizationId}/settings/security/tenants.
const rootRoute = createRootRoute();
const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform-tenants',
  validateSearch: tenantsListSearchSchema,
  search: { middlewares: [stripSearchParams(TENANTS_LIST_SEARCH_DEFAULTS)] },
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings-tenants',
  validateSearch: tenantsListSearchSchema,
  search: { middlewares: [stripSearchParams(TENANTS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([platformRoute, settingsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('tenantsListSearchSchema', () => {
  it('should keep a default search value out of the address, on both routes', async () => {
    const onPlatform = await at('/platform-tenants?search=acme');
    const onSettings = await at('/settings-tenants?search=acme');

    await onPlatform.navigate({ to: '.', search: () => ({ search: '' }), replace: true });
    await onSettings.navigate({ to: '.', search: () => ({ search: '' }), replace: true });

    expect(new URLSearchParams(onPlatform.history.location.href.split('?')[1] ?? '').toString()).toBe('');
    expect(new URLSearchParams(onSettings.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read a search term from the address, on both routes', async () => {
    const onPlatform = await at('/platform-tenants?search=acme');
    const onSettings = await at('/settings-tenants?search=acme');

    expect(onPlatform.state.matches.at(-1)?.search).toEqual({ search: 'acme' });
    expect(onSettings.state.matches.at(-1)?.search).toEqual({ search: 'acme' });
  });

  it('should coerce a numeric search term to a string rather than dropping it, on both routes', async () => {
    // The router's default search parser JSON-parses a value made only of digits, so a purely
    // numeric search term arrives as a number rather than a string.
    const onPlatform = await at('/platform-tenants?search=123');
    const onSettings = await at('/settings-tenants?search=123');

    expect(onPlatform.state.matches.at(-1)?.search).toEqual({ search: '123' });
    expect(onSettings.state.matches.at(-1)?.search).toEqual({ search: '123' });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it, on both routes', async () => {
    const onPlatform = await at('/platform-tenants?search=true');
    const onSettings = await at('/settings-tenants?search=true');

    expect(onPlatform.state.matches.at(-1)?.search).toEqual({ search: 'true' });
    expect(onSettings.state.matches.at(-1)?.search).toEqual({ search: 'true' });
  });
});
