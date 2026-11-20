import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  THREAT_TECHNIQUES_LIST_SEARCH_DEFAULTS,
  threatTechniquesListSearchSchema,
} from './threat-techniques-list-search';

// Mirrors the middleware wiring of the threat's TTP route, without mounting the full app route tree.
const rootRoute = createRootRoute();
const ttpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ttp',
  validateSearch: threatTechniquesListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_TECHNIQUES_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([ttpRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

const currentParams = (router: Awaited<ReturnType<typeof at>>) => new URLSearchParams(router.history.location.href.split('?')[1] ?? '');

const TACTIC_ID = '0f3f9b8a-6f36-4c88-8e1f-6a1f9d6a1111';

describe('threatTechniquesListSearchSchema', () => {
  it('should open on every technique with nothing in the address', async () => {
    const router = await at('/ttp');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', tactic: '', function: 'prevent', result: 'all' });
  });

  it('should read the search and the tactic from the address', async () => {
    const router = await at(`/ttp?search=T1562&tactic=${TACTIC_ID}`);

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'T1562', tactic: TACTIC_ID, function: 'prevent', result: 'all' });
  });

  it('should read a tactic that is not text as every tactic', async () => {
    const router = await at('/ttp?tactic=42');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', tactic: '', function: 'prevent', result: 'all' });
  });

  it('should read the function and the result from the address, an unknown one as the default', async () => {
    expect((await at('/ttp?function=detect&result=lowered')).state.matches.at(-1)?.search)
      .toEqual({ search: '', tactic: '', function: 'detect', result: 'lowered' });
    expect((await at('/ttp?function=respond&result=bogus')).state.matches.at(-1)?.search)
      .toEqual({ search: '', tactic: '', function: 'prevent', result: 'all' });
  });

  it('should keep the defaults out of the address and the other field in it', async () => {
    const router = await at(`/ttp?search=phish&tactic=${TACTIC_ID}`);

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, search: '' }), replace: true });
    expect(currentParams(router).has('search')).toBe(false);
    expect(currentParams(router).get('tactic')).toBe(TACTIC_ID);

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, tactic: '' }), replace: true });
    expect(currentParams(router).toString()).toBe('');
  });
});
