import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_VALIDATION_EVIDENCE_LIST_SEARCH_DEFAULTS,
  capabilityValidationEvidenceListSearchSchema,
} from './capability-validation-evidence-list-search';

// Mirrors the middleware wiring of routes/.../controls/$controlId/validation.tsx, without mounting
// the full app route tree.
const rootRoute = createRootRoute();
const validationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/validation',
  validateSearch: capabilityValidationEvidenceListSearchSchema,
  search: { middlewares: [stripSearchParams(CAPABILITY_VALIDATION_EVIDENCE_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([validationRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

const searchOf = (router: Awaited<ReturnType<typeof at>>) => router.state.matches.at(-1)?.search;

describe('capabilityValidationEvidenceListSearchSchema', () => {
  it('should read every filter from the address', async () => {
    const router = await at('/validation?technique=T1055.012&function=detect&result=contradicted&family=EDR');

    expect(searchOf(router)).toEqual({ technique: 'T1055.012', function: 'detect', result: 'contradicted', family: 'EDR' });
  });

  it('should fall back to no filter for values the schema rejects, without throwing', async () => {
    const router = await at('/validation?technique=0195a3b2-0000-7000-8000-000000000000&function=bogus&result=bogus&family=');

    expect(searchOf(router)).toEqual({ technique: undefined, function: 'all', result: 'all', family: undefined });
  });

  it('should keep default values out of the address', async () => {
    const router = await at('/validation?technique=T1055&function=detect');

    await router.navigate({ to: '.', search: () => ({ function: 'all' as const, result: 'all' as const }), replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });
});
