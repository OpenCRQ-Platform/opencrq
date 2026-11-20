import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS,
  threatLocationsSectorsListSearchSchema,
} from './threat-locations-sectors-list-search';

const rootRoute = createRootRoute();
const tabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/locations-sectors',
  validateSearch: threatLocationsSectorsListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([tabRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

const currentParams = (router: Awaited<ReturnType<typeof at>>) => new URLSearchParams(router.history.location.href.split('?')[1] ?? '');

const COUNTRY_ID = '0f3f9b8a-6f36-4c88-8e1f-6a1f9d6a1111';

describe('threatLocationsSectorsListSearchSchema', () => {
  it('should read the country picked on the map from the address', async () => {
    const router = await at(`/locations-sectors?country=${COUNTRY_ID}`);

    expect(router.state.matches.at(-1)?.search).toEqual({ ...THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS, country: COUNTRY_ID });
  });

  it('should open on every country when the address names no country id', async () => {
    const router = await at('/locations-sectors?country=france');

    expect(router.state.matches.at(-1)?.search).toEqual(THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS);
  });

  it('should keep the country out of the address once its filter is removed', async () => {
    const router = await at(`/locations-sectors?country=${COUNTRY_ID}&locationSearch=par`);

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, country: '' }), replace: true });

    const params = currentParams(router);
    expect(params.has('country')).toBe(false);
    expect(params.get('locationSearch')).toBe('par');
  });

  it('should read both searches and both filters on what concerns the tenant', async () => {
    const router = await at('/locations-sectors?locationSearch=3389&locationsConcerningYou=true&sectorSearch=fin&sectorsConcerningYou=true');

    expect(router.state.matches.at(-1)?.search).toEqual({
      locationSearch: '3389',
      locationsConcerningYou: true,
      country: '',
      sectorSearch: 'fin',
      sectorsConcerningYou: true,
    });
  });

  it('should keep every default out of the address', async () => {
    const router = await at('/locations-sectors?locationsConcerningYou=true&sectorSearch=fin');

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, locationsConcerningYou: false, sectorSearch: '' }), replace: true });

    expect(currentParams(router).toString()).toBe('');
  });
});
