/** @vitest-environment jsdom */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  stripSearchParams,
  useRouter,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useDebouncedDraft } from './use-debounced-draft';
import { useUrlListFilters } from './use-url-list-filters';

const TEST_DEFAULTS = { search: '', source: 'all' } as const;

const testSchema = z.object({
  search: z.string().catch('').default(''),
  source: z.enum(['all', 'drata', 'vanta']).catch('all').default('all'),
});

/** The component under test: generic over its schema, unaware of which route hosts it. */
const TestFilters = () => {
  const { filters, setFilters } = useUrlListFilters(testSchema);
  return (
    <div>
      <pre data-testid="filters">{JSON.stringify(filters)}</pre>
      <button type="button" data-testid="set-drata" onClick={() => setFilters({ source: 'drata' })}>
        set source to drata
      </button>
      <button type="button" data-testid="reset-source" onClick={() => setFilters({ source: 'all' })}>
        reset source to the default
      </button>
    </div>
  );
};

/** A list whose search is debounced, with a row leading off the list — the shape every data table has. */
const TestSearchableList = () => {
  const { filters, setFilters } = useUrlListFilters(testSchema);
  const { value, setValue, onBlur } = useDebouncedDraft(filters.search, (search) => setFilters({ search }));
  // Pushed through the history rather than a typed <Link>: this file's route tree is local, and
  // <Link>'s `to` is typed against the app's generated one.
  const { history } = useRouter();
  return (
    <div>
      <input
        data-testid="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={onBlur}
      />
      <button type="button" data-testid="row" onClick={() => history.push('/detail')}>row</button>
    </div>
  );
};

const rootRoute = createRootRoute();
// Two routes sharing the exact same schema, standing in for a component mounted from two places
// (e.g. platform/security/users and settings/security/users).
const routeA = createRoute({
  getParentRoute: () => rootRoute,
  path: '/route-a',
  validateSearch: testSchema,
  search: { middlewares: [stripSearchParams(TEST_DEFAULTS)] },
  component: TestFilters,
});
const routeB = createRoute({
  getParentRoute: () => rootRoute,
  path: '/route-b',
  validateSearch: testSchema,
  search: { middlewares: [stripSearchParams(TEST_DEFAULTS)] },
  component: TestFilters,
});
// A route whose own validateSearch carries a param the hook's schema does not declare, standing
// in for outcomeId on the threat-center route: foreign to the component, native to the route.
const routeWithForeignParam = createRoute({
  getParentRoute: () => rootRoute,
  path: '/route-foreign',
  validateSearch: testSchema.extend({ outcomeId: z.string().optional() }),
  search: { middlewares: [stripSearchParams(TEST_DEFAULTS)] },
  component: TestFilters,
});
const searchableListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/route-searchable',
  validateSearch: testSchema,
  search: { middlewares: [stripSearchParams(TEST_DEFAULTS)] },
  component: TestSearchableList,
});
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/detail',
  component: () => <div data-testid="detail">detail</div>,
});
const routeTree = rootRoute.addChildren([routeA, routeB, routeWithForeignParam, searchableListRoute, detailRoute]);

const at = async (pathname: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [pathname] }) });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
};

/** The query string of the address the router currently holds, order-independent to read. */
const currentParams = (router: Awaited<ReturnType<typeof at>>) => new URLSearchParams(router.history.location.href.split('?')[1] ?? '');

afterEach(() => {
  cleanup();
});

describe('useUrlListFilters', () => {
  it('should read the schema defaults from a bare address', async () => {
    await at('/route-a');

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('filters').textContent ?? '')).toEqual({ search: '', source: 'all' });
    });
  });

  it('should fall back to the default for a value the schema rejects, without throwing', async () => {
    await at('/route-a?source=nonsense');

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('filters').textContent ?? '')).toEqual({ search: '', source: 'all' });
    });
  });

  it('should write a non-default value to the address', async () => {
    const router = await at('/route-a');

    await act(() => {
      screen.getByTestId('set-drata').click();
    });

    await waitFor(() => {
      expect(currentParams(router).get('source')).toBe('drata');
    });
  });

  it('should remove a value equal to the default from the address', async () => {
    const router = await at('/route-a?source=drata');

    await act(() => {
      screen.getByTestId('reset-source').click();
    });

    await waitFor(() => {
      expect(currentParams(router).has('source')).toBe(false);
    });
  });

  it('should preserve a foreign search param the schema does not declare', async () => {
    const router = await at('/route-foreign?outcomeId=outcome-1');

    await act(() => {
      screen.getByTestId('set-drata').click();
    });

    await waitFor(() => {
      const params = currentParams(router);
      expect(params.get('source')).toBe('drata');
      expect(params.get('outcomeId')).toBe('outcome-1');
    });
  });

  it('should replace the current history entry rather than push a new one', async () => {
    const router = await at('/route-a');
    const lengthBeforeWrite = router.history.length;
    const actions: Array<string> = [];
    router.history.subscribe(({ action }) => {
      actions.push(action.type);
    });

    await act(() => {
      screen.getByTestId('set-drata').click();
    });
    await waitFor(() => {
      expect(currentParams(router).get('source')).toBe('drata');
    });

    expect(actions).toEqual(['REPLACE']);
    expect(router.history.length).toBe(lengthBeforeWrite);
  });

  it('should let the same component read and write filters from two different routes', async () => {
    const onRouteA = await at('/route-a?source=drata');
    const onRouteB = await at('/route-b?source=vanta');

    await waitFor(() => {
      const [filtersA, filtersB] = screen.getAllByTestId('filters');
      expect(JSON.parse(filtersA.textContent ?? '').source).toBe('drata');
      expect(JSON.parse(filtersB.textContent ?? '').source).toBe('vanta');
    });

    await act(() => {
      screen.getAllByTestId('reset-source')[1].click();
    });

    await waitFor(() => {
      expect(currentParams(onRouteB).has('source')).toBe(false);
    });
    // routeA is untouched by the write made through routeB's mount of the same component.
    expect(currentParams(onRouteA).get('source')).toBe('drata');
  });
});

describe('useDebouncedDraft on a list route', () => {
  it('should carry a search typed just before a row is clicked back to the list', async () => {
    const router = await at('/route-searchable');
    const searchField = screen.getByTestId('search');

    fireEvent.change(searchField, { target: { value: 'mfa' } });
    // A mousedown on a row blurs the field before the click handler navigates, which is the whole
    // reason the commit cannot wait for the debounce deadline or for the unmount cleanup.
    await act(() => {
      fireEvent.blur(searchField);
      screen.getByTestId('row').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('detail')).toBeTruthy();
    });
    // Nothing of the list's own state landed on the detail address.
    expect(currentParams(router).has('search')).toBe(false);

    await act(() => {
      router.history.back();
    });

    await waitFor(() => {
      expect(currentParams(router).get('search')).toBe('mfa');
    });
  });
});
