import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import type { ConnectorFilters } from './connector-list-utils';
import { EMPTY_CONNECTOR_FILTERS } from './connector-list-utils';
import {
  CONNECTORS_LIST_SEARCH_DEFAULTS,
  connectorsListSearchSchema,
  toConnectorFilters,
  toConnectorUrlFilters,
} from './connectors-list-search';

describe('toConnectorFilters / toConnectorUrlFilters', () => {
  it('should round-trip an empty selection', () => {
    expect(toConnectorFilters(CONNECTORS_LIST_SEARCH_DEFAULTS)).toEqual(EMPTY_CONNECTOR_FILTERS);
    expect(toConnectorUrlFilters(EMPTY_CONNECTOR_FILTERS)).toEqual(CONNECTORS_LIST_SEARCH_DEFAULTS);
  });

  it('should round-trip a single facet', () => {
    const urlFilters = { search: '', domains: 'compliance', scopeKinds: '', states: '' };
    const filters: ConnectorFilters = { search: '', domains: ['compliance'], scopeKinds: [], states: [] };

    expect(toConnectorFilters(urlFilters)).toEqual(filters);
    expect(toConnectorUrlFilters(filters)).toEqual(urlFilters);
  });

  it('should round-trip three facets cumulated alongside a search term', () => {
    const urlFilters = {
      search: 'vpn',
      domains: 'compliance,simulation',
      scopeKinds: 'findings',
      states: 'failing,syncing',
    };
    const filters: ConnectorFilters = {
      search: 'vpn',
      domains: ['compliance', 'simulation'],
      scopeKinds: ['findings'],
      states: ['failing', 'syncing'],
    };

    expect(toConnectorFilters(urlFilters)).toEqual(filters);
    expect(toConnectorUrlFilters(filters)).toEqual(urlFilters);
  });

  it('should ignore a facet value the app no longer defines rather than keeping a dead selection', () => {
    const urlFilters = { search: '', domains: 'compliance,bogus', scopeKinds: '', states: '' };

    expect(toConnectorFilters(urlFilters)).toEqual({
      search: '',
      domains: ['compliance'],
      scopeKinds: [],
      states: [],
    });
  });
});

// Mirrors the middleware wiring of routes/.../integrations/available.tsx and deployed.tsx, without
// mounting the full app route tree.
const rootRoute = createRootRoute();
const availableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/available',
  validateSearch: connectorsListSearchSchema,
  search: { middlewares: [stripSearchParams(CONNECTORS_LIST_SEARCH_DEFAULTS)] },
});
const deployedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/deployed',
  validateSearch: connectorsListSearchSchema,
  search: { middlewares: [stripSearchParams(CONNECTORS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([availableRoute, deployedRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('connectorsListSearchSchema', () => {
  it('should keep default values out of the address, on both routes', async () => {
    const onAvailable = await at('/available?search=vpn&domains=compliance&scopeKinds=findings&states=failing');
    const onDeployed = await at('/deployed?search=vpn&domains=compliance&scopeKinds=findings&states=failing');

    await onAvailable.navigate({ to: '.', search: () => CONNECTORS_LIST_SEARCH_DEFAULTS, replace: true });
    await onDeployed.navigate({ to: '.', search: () => CONNECTORS_LIST_SEARCH_DEFAULTS, replace: true });

    expect(new URLSearchParams(onAvailable.history.location.href.split('?')[1] ?? '').toString()).toBe('');
    expect(new URLSearchParams(onDeployed.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read comma-joined facets from the address, on both routes', async () => {
    const onAvailable = await at('/available?domains=compliance,simulation&states=failing,syncing');
    const onDeployed = await at('/deployed?domains=compliance,simulation&states=failing,syncing');

    expect(onAvailable.state.matches.at(-1)?.search).toEqual({
      search: '', domains: 'compliance,simulation', scopeKinds: '', states: 'failing,syncing',
    });
    expect(onDeployed.state.matches.at(-1)?.search).toEqual({
      search: '', domains: 'compliance,simulation', scopeKinds: '', states: 'failing,syncing',
    });
  });

  it('should coerce a numeric search term to a string rather than dropping it, on both routes', async () => {
    const onAvailable = await at('/available?search=3389');
    const onDeployed = await at('/deployed?search=3389');

    expect(onAvailable.state.matches.at(-1)?.search).toEqual({
      search: '3389', domains: '', scopeKinds: '', states: '',
    });
    expect(onDeployed.state.matches.at(-1)?.search).toEqual({
      search: '3389', domains: '', scopeKinds: '', states: '',
    });
  });
});
