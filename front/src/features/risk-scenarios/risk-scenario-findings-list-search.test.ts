import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  RISK_SCENARIO_FINDINGS_LIST_SEARCH_DEFAULTS,
  riskScenarioFindingsListSearchSchema,
} from './risk-scenario-findings-list-search';

// Mirrors the middleware wiring of routes/.../risk-scenarios/$riskScenarioId/findings.tsx, without
// mounting the full app route tree.
const rootRoute = createRootRoute();
const findingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/findings',
  validateSearch: riskScenarioFindingsListSearchSchema,
  search: { middlewares: [stripSearchParams(RISK_SCENARIO_FINDINGS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([findingsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('riskScenarioFindingsListSearchSchema', () => {
  it('should keep default values out of the address', async () => {
    const router = await at('/findings?state=dismissed&severity=critical&view=unique');

    await router.navigate({ to: '.', search: () => RISK_SCENARIO_FINDINGS_LIST_SEARCH_DEFAULTS, replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should show the applicable findings from a bare address, as the tab always has', async () => {
    const router = await at('/findings');

    expect(router.state.matches.at(-1)?.search).toEqual({ state: 'applicable', severity: 'all', view: 'all' });
  });

  it('should fall back to the default state for a value the schema rejects, without throwing', async () => {
    const router = await at('/findings?state=bogus');

    expect(router.state.matches.at(-1)?.search).toEqual({ state: 'applicable', severity: 'all', view: 'all' });
  });

  it('should fall back to the default severity for a value the schema rejects, without throwing', async () => {
    const router = await at('/findings?severity=bogus');

    expect(router.state.matches.at(-1)?.search).toEqual({ state: 'applicable', severity: 'all', view: 'all' });
  });

  it('should read a state and a severity from the address', async () => {
    const router = await at('/findings?state=dismissed&severity=high');

    expect(router.state.matches.at(-1)?.search).toEqual({ state: 'dismissed', severity: 'high', view: 'all' });
  });

  it('should keep an explicit every-state view in the address, since it is not the default', async () => {
    const router = await at('/findings');

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, state: 'all' as const }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').get('state')).toBe('all');
  });

  it('should read the unique-CVE view from the address', async () => {
    const router = await at('/findings?view=unique');

    expect(router.state.matches.at(-1)?.search).toEqual({ state: 'applicable', severity: 'all', view: 'unique' });
  });

  it('should fall back to the every-finding view for a view the schema rejects, without throwing', async () => {
    const router = await at('/findings?view=bogus');

    expect(router.state.matches.at(-1)?.search).toEqual({ state: 'applicable', severity: 'all', view: 'all' });
  });

  it('should strip an explicit view=all from the address, since it is the default', async () => {
    const router = await at('/findings?view=all');

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, severity: 'high' as const }), replace: true });

    const params = new URLSearchParams(router.history.location.href.split('?')[1] ?? '');
    expect(params.get('view')).toBeNull();
    expect(params.get('severity')).toBe('high');
  });

  it('should keep view=unique in the address, since it is not the default', async () => {
    const router = await at('/findings');

    await router.navigate({ to: '.', search: (prev) => ({ ...prev, view: 'unique' as const }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').get('view')).toBe('unique');
  });
});
