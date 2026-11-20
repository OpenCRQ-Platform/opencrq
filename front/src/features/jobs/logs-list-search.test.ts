import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import type { LogFilter } from './logs-utils';
import {
  LOGS_LIST_SEARCH_DEFAULTS,
  logsListSearchSchema,
  toLogFilter,
  toLogUrlFilters,
} from './logs-list-search';

describe('toLogFilter / toLogUrlFilters', () => {
  it('should round-trip an empty selection', () => {
    expect(toLogFilter(LOGS_LIST_SEARCH_DEFAULTS)).toEqual({ search: '', levels: [] });
    expect(toLogUrlFilters({ search: '', levels: [] })).toEqual(LOGS_LIST_SEARCH_DEFAULTS);
  });

  it('should round-trip a single level', () => {
    const urlFilters = { search: '', level: 'error' };
    const filter: LogFilter = { search: '', levels: ['error'] };

    expect(toLogFilter(urlFilters)).toEqual(filter);
    expect(toLogUrlFilters(filter)).toEqual(urlFilters);
  });

  it('should round-trip both levels cumulated alongside a search term', () => {
    const urlFilters = { search: 'timeout', level: 'error,trace' };
    const filter: LogFilter = { search: 'timeout', levels: ['error', 'trace'] };

    expect(toLogFilter(urlFilters)).toEqual(filter);
    expect(toLogUrlFilters(filter)).toEqual(urlFilters);
  });

  it('should ignore a level the app no longer defines rather than keeping a dead selection', () => {
    const urlFilters = { search: '', level: 'error,bogus' };

    expect(toLogFilter(urlFilters)).toEqual({ search: '', levels: ['error'] });
  });
});

// Mirrors the middleware wiring of routes/.../integrations/connectors/$connectorSlug/logs.tsx,
// without mounting the full app route tree.
const rootRoute = createRootRoute();
const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  validateSearch: logsListSearchSchema,
  search: { middlewares: [stripSearchParams(LOGS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([logsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('logsListSearchSchema', () => {
  it('should keep default values out of the address', async () => {
    const router = await at('/logs?search=timeout&level=error');

    await router.navigate({ to: '.', search: () => LOGS_LIST_SEARCH_DEFAULTS, replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read comma-joined levels from the address', async () => {
    const router = await at('/logs?level=error,trace');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', level: 'error,trace' });
  });

  it('should read a search term from the address', async () => {
    const router = await at('/logs?search=timeout');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'timeout', level: '' });
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    const router = await at('/logs?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', level: '' });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it', async () => {
    const router = await at('/logs?search=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'true', level: '' });
  });
});
