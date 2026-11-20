import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  THREAT_ANALYSES_LIST_SEARCH_DEFAULTS,
  threatAnalysesListSearchSchema,
} from './threat-analyses-list-search';

// Mirrors the middleware wiring of routes/.../threat-center/index.tsx, without mounting the full
// app route tree.
const rootRoute = createRootRoute();
const threatCenterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/threat-center',
  validateSearch: threatAnalysesListSearchSchema,
  search: { middlewares: [stripSearchParams(THREAT_ANALYSES_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([threatCenterRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

const currentParams = (router: Awaited<ReturnType<typeof at>>) => new URLSearchParams(router.history.location.href.split('?')[1] ?? '');

const OUTCOME_ID = '0f3f9b8a-6f36-4c88-8e1f-6a1f9d6a1111';

describe('threatAnalysesListSearchSchema', () => {
  it('should keep a default search value out of the address', async () => {
    const router = await at('/threat-center?search=vpn');

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, search: '' }), replace: true });

    expect(currentParams(router).toString()).toBe('');
  });

  it('should read a search term from the address', async () => {
    const router = await at('/threat-center?search=vpn');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'vpn', outcomeId: 'all', entityType: 'all', kind: 'all' });
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    const router = await at('/threat-center?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', outcomeId: 'all', entityType: 'all', kind: 'all' });
  });

  it('should coerce a boolean-shaped search term to a string rather than dropping it', async () => {
    const router = await at('/threat-center?search=true');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'true', outcomeId: 'all', entityType: 'all', kind: 'all' });
  });

  it('should read an outcome from the address', async () => {
    const router = await at(`/threat-center?outcomeId=${OUTCOME_ID}`);

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', outcomeId: OUTCOME_ID, entityType: 'all', kind: 'all' });
  });

  it('should open on a value that names no outcome at all, without reaching the query', async () => {
    const router = await at('/threat-center?outcomeId=nope');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', outcomeId: 'all', entityType: 'all', kind: 'all' });
  });

  it('should keep the outcome out of the address when it is every outcome', async () => {
    const router = await at(`/threat-center?outcomeId=${OUTCOME_ID}`);

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, outcomeId: 'all' }), replace: true });

    expect(currentParams(router).has('outcomeId')).toBe(false);
  });

  it('should keep both fields in the address when one of them is written', async () => {
    const router = await at(`/threat-center?outcomeId=${OUTCOME_ID}`);

    // Mirrors exactly what useUrlListFilters#setFilters does: `{ ...prev, ...patch }`, replace: true.
    await router.navigate({ to: '.', search: (prev) => ({ ...prev, search: 'vpn' }), replace: true });

    const params = currentParams(router);
    expect(params.get('outcomeId')).toBe(OUTCOME_ID);
    expect(params.get('search')).toBe('vpn');
  });

  it('should read a threat type from the address', async () => {
    const router = await at('/threat-center?entityType=campaign');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', outcomeId: 'all', entityType: 'campaign', kind: 'all' });
  });

  it('should open on every type when the address names no threat type', async () => {
    const router = await at('/threat-center?entityType=malware');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', outcomeId: 'all', entityType: 'all', kind: 'all' });
  });

  it('should keep the type out of the address when it is every type', async () => {
    const router = await at('/threat-center?entityType=campaign');

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, entityType: 'all', kind: 'all' }), replace: true });

    expect(currentParams(router).has('entityType')).toBe(false);
  });

  it('should read a source from the address', async () => {
    const router = await at('/threat-center?kind=stix-import');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', outcomeId: 'all', entityType: 'all', kind: 'stix-import' });
  });

  it('should open on every source when the address names no source', async () => {
    const router = await at('/threat-center?kind=manual');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', outcomeId: 'all', entityType: 'all', kind: 'all' });
  });

  it('should keep the source out of the address when it is every source', async () => {
    const router = await at('/threat-center?kind=connector');

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, kind: 'all' }), replace: true });

    expect(currentParams(router).has('kind')).toBe(false);
  });
});
