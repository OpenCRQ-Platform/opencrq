import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { FINDINGS_LIST_SEARCH_DEFAULTS, findingsListSearchSchema } from './findings-list-search';

// Mirrors the middleware wiring of routes/.../findings/index.tsx, without mounting the full app
// route tree.
const rootRoute = createRootRoute();
const findingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/findings',
  validateSearch: findingsListSearchSchema,
  search: { middlewares: [stripSearchParams(FINDINGS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([findingsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('findingsListSearchSchema', () => {
  it('should show the applicable findings from the bare address the menu entry carries', async () => {
    const router = await at('/findings');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'applicable', source: 'all' });
  });

  it('should keep default values out of the address', async () => {
    const router = await at('/findings?state=dismissed&source=drata');

    await router.navigate({ to: '.', search: () => FINDINGS_LIST_SEARCH_DEFAULTS, replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read a state and a source from the address', async () => {
    const router = await at('/findings?state=all&source=drata');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'all', source: 'drata' });
  });

  it('should read a numeric search back as the text that was typed', async () => {
    const router = await at('/findings?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', state: 'applicable', source: 'all' });
  });

  it('should fall back to the default state for a value the schema rejects, without throwing', async () => {
    const router = await at('/findings?state=bogus');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'applicable', source: 'all' });
  });

  it('should carry a source the tenant may no longer have, for resolveOptionFilter to drop at render', async () => {
    const router = await at('/findings?source=cisa');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'applicable', source: 'cisa' });
  });

  it('should fall back to no source filter for a value that names no source at all', async () => {
    const router = await at('/findings?source=retired_connector');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'applicable', source: 'all' });
  });

  it.each(['CVE-2023-4966', 'T1059.001:detection', 'T1003:prevention'])('should read the vulnerability %j from the address', async (token) => {
    const router = await at(`/findings?state=all&vulnerability=${encodeURIComponent(token)}`);

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'all', source: 'all', vulnerability: token });
  });

  it.each(['CVE-1', 'T1003', 'T1059:response', '1234', 'x'])('should drop the vulnerability %j, which names none', async (token) => {
    const router = await at(`/findings?vulnerability=${encodeURIComponent(token)}`);

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', state: 'applicable', source: 'all' });
  });
});
