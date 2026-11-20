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
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useUrlListFilters } from '../../hooks';
import { DebouncedSearchField } from './debounced-search-field';

/** Stands in for a list: owns the committed search and counts its own renders, rows included. */
const TestList: FunctionComponent<{ onRender: () => void, onCommit: (next: string) => void }> = ({ onRender, onCommit }) => {
  const [search, setSearch] = useState('');
  onRender();
  return (
    <>
      <DebouncedSearchField
        aria-label="search"
        clearLabel="clear"
        value={search}
        onCommit={(next) => {
          onCommit(next);
          setSearch(next);
        }}
      />
      <output data-testid="committed">{search}</output>
      <button type="button" onClick={() => setSearch('firewall')}>navigate back</button>
    </>
  );
};

const field = () => screen.getByRole<HTMLInputElement>('searchbox');

afterEach(() => {
  cleanup();
});

describe('DebouncedSearchField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show each keystroke without re-rendering the list that owns the search', () => {
    const onRender = vi.fn();
    render(<TestList onRender={onRender} onCommit={vi.fn()} />);
    onRender.mockClear();

    fireEvent.change(field(), { target: { value: 'v' } });
    fireEvent.change(field(), { target: { value: 'vp' } });
    fireEvent.change(field(), { target: { value: 'vpn' } });

    expect(field().value).toBe('vpn');
    expect(onRender).not.toHaveBeenCalled();
  });

  it('should commit a burst of keystrokes once, re-rendering the list once', () => {
    const onRender = vi.fn();
    const onCommit = vi.fn();
    render(<TestList onRender={onRender} onCommit={onCommit} />);
    onRender.mockClear();

    fireEvent.change(field(), { target: { value: 'v' } });
    fireEvent.change(field(), { target: { value: 'vpn' } });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('vpn');
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('committed').textContent).toBe('vpn');
  });

  it('should commit the pending draft on blur and still call the caller\'s own onBlur', () => {
    const onCommit = vi.fn();
    const onBlur = vi.fn();
    render(<DebouncedSearchField aria-label="search" clearLabel="clear" value="" onCommit={onCommit} onBlur={onBlur} />);

    fireEvent.change(field(), { target: { value: 'mfa' } });
    fireEvent.blur(field());

    expect(onCommit).toHaveBeenCalledWith('mfa');
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('should empty the field from its clear button', () => {
    render(<DebouncedSearchField aria-label="search" clearLabel="clear" value="vpn" onCommit={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('clear'));

    expect(field().value).toBe('');
  });

  it('should follow a committed value changed from outside, as a back navigation does', () => {
    render(<TestList onRender={vi.fn()} onCommit={vi.fn()} />);

    fireEvent.click(screen.getByText('navigate back'));

    expect(field().value).toBe('firewall');
  });
});

const testSchema = z.object({ search: z.string().catch('').default('') });

/** A list whose search lives in the address, with a row leading off the list — the shape every data table has. */
const TestSearchableList = () => {
  const { filters, setFilters } = useUrlListFilters(testSchema);
  // Pushed through the history rather than a typed <Link>: this file's route tree is local, and
  // <Link>'s `to` is typed against the app's generated one.
  const { history } = useRouter();
  return (
    <div>
      <DebouncedSearchField
        clearLabel="clear"
        value={filters.search}
        onCommit={(search) => setFilters({ search })}
      />
      <button type="button" data-testid="row" onClick={() => history.push('/detail')}>row</button>
    </div>
  );
};

const rootRoute = createRootRoute();
const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/list',
  validateSearch: testSchema,
  search: { middlewares: [stripSearchParams({ search: '' })] },
  component: TestSearchableList,
});
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/detail',
  component: () => <div data-testid="detail">detail</div>,
});
const routeTree = rootRoute.addChildren([listRoute, detailRoute]);

const searchParam = ({ history }: { history: { location: { href: string } } }) =>
  new URLSearchParams(history.location.href.split('?')[1] ?? '').get('search');

describe('DebouncedSearchField on a list route', () => {
  it('should carry a search typed just before a row is clicked back to the list', async () => {
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/list'] }) });
    render(<RouterProvider router={router} />);
    await router.load();

    fireEvent.change(field(), { target: { value: 'mfa' } });
    // A mousedown on a row blurs the field before the click handler navigates, which is the whole
    // reason the commit cannot wait for the debounce deadline or for the unmount cleanup.
    await act(() => {
      fireEvent.blur(field());
      screen.getByTestId('row').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('detail')).toBeTruthy();
    });
    // Nothing of the list's own state landed on the detail address.
    expect(searchParam(router)).toBeNull();

    await act(() => {
      router.history.back();
    });

    await waitFor(() => {
      expect(searchParam(router)).toBe('mfa');
    });
    expect(field().value).toBe('mfa');
  });
});
