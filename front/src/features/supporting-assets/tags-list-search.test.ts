import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { TAGS_LIST_SEARCH_DEFAULTS, tagsListSearchSchema } from './tags-list-search';

// Mirrors the middleware wiring of routes/.../settings/taxonomies/tags/index.tsx, without mounting
// the full app route tree.
const rootRoute = createRootRoute();
const tagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tags',
  validateSearch: tagsListSearchSchema,
  search: { middlewares: [stripSearchParams(TAGS_LIST_SEARCH_DEFAULTS)] },
});
const routeTree = rootRoute.addChildren([tagsRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return router;
};

describe('tagsListSearchSchema', () => {
  it('should default to no search and no source filter', async () => {
    const router = await at('/tags');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all' });
  });

  it('should keep default values out of the address', async () => {
    const router = await at('/tags?search=pci&source=manual');

    await router.navigate({ to: '.', search: () => TAGS_LIST_SEARCH_DEFAULTS, replace: true });

    expect(new URLSearchParams(router.history.location.href.split('?')[1] ?? '').toString()).toBe('');
  });

  it('should read a search term and a source from the address', async () => {
    const router = await at('/tags?search=pci&source=openaev');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: 'pci', source: 'openaev' });
  });

  it('should read the XTM One origin from the address', async () => {
    const router = await at('/tags?source=xtm_one');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'xtm_one' });
  });

  it('should carry a source the tenant may no longer have, for resolveOptionFilter to drop at render', async () => {
    const router = await at('/tags?source=drata');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'drata' });
  });

  it('should fall back to no source filter for a numeric source value', async () => {
    const router = await at('/tags?source=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all' });
  });

  it('should fall back to no source filter for a value that names no source', async () => {
    const router = await at('/tags?source=nope');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '', source: 'all' });
  });

  it('should coerce a numeric search term to a string rather than dropping it', async () => {
    const router = await at('/tags?search=3389');

    expect(router.state.matches.at(-1)?.search).toEqual({ search: '3389', source: 'all' });
  });
});
