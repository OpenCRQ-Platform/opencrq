/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RouteTab } from './route-tabs';
import { RouteTabs } from './route-tabs';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const TABS: Array<RouteTab> = [
  { key: 'overview', label: 'Overview', linkOption: { to: '/login' } },
  { key: 'ttp', label: 'TTP', linkOption: { to: '/platform' }, count: 12 },
];

const renderTabs = async (): Promise<void> => {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tab',
    component: (): ReactNode => <RouteTabs tabs={TABS} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText('Overview');
};

describe('RouteTabs', () => {
  it('draws a count badge, named for assistive technology, on a tab that carries a count', async () => {
    await renderTabs();

    const badge = screen.getByLabelText('12 items');
    expect(badge.textContent).toBe('12');
    expect(badge.classList.contains('shrink-0')).toBe(true);
    expect(screen.getByText('TTP').closest('a')?.contains(badge)).toBe(true);
  });

  it('draws no badge on a tab without a count', async () => {
    await renderTabs();

    const overview = screen.getByText('Overview').closest('a');
    expect(overview?.textContent).toBe('Overview');
    expect(screen.getAllByLabelText(/items$/)).toHaveLength(1);
  });
});
