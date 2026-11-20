import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { MITRE_ATTACK_LIST_SEARCH_DEFAULTS, mitreAttackListSearchSchema } from './mitre-attack-list-search';

// Mirrors the middleware wiring of routes/.../mitre-attack/techniques/index.tsx, without mounting
// the full app route tree.
const rootRoute = createRootRoute();
const techniquesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/techniques',
  validateSearch: mitreAttackListSearchSchema,
  search: { middlewares: [stripSearchParams(MITRE_ATTACK_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([techniquesRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('mitreAttackListSearchSchema', () => {
  it('should keep a default search value out of the address', async () => {
    const router = await at('/techniques?search=t1059');

    await router.navigate({ to: '.', search: () => ({ search: '' }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read a search term from the address', async () => {
    const router = await at('/techniques?search=powershell');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'powershell' });
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    const router = await at('/techniques?search=1059');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '1059' });
  });
});
