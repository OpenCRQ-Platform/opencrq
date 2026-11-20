/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, linkOptions, Outlet, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RouteTab } from '../components/shared/route-tabs';
import { Page } from '../components/layout/main-layout/page';
import { RouteTabs } from '../components/shared/route-tabs';
import { createPageScrollReset } from './page-scroll-reset';

// jsdom has no layout: it stores scrollTop but implements no Element.scrollTo, which the router
// calls to reset a container.
const originalScrollTo = Element.prototype.scrollTo;
const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
  Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
    if (typeof options === 'object') {
      this.scrollTop = options.top ?? this.scrollTop;
    }
  };
});

afterAll(() => {
  Element.prototype.scrollTo = originalScrollTo;
  windowScrollTo.mockRestore();
});

afterEach(() => {
  cleanup();
});

// RouteTabs links are typed against the app's route tree, hence the app's own control tab paths.
const CONTROL_TABS: Array<RouteTab> = [
  { key: 'overview', label: 'Overview', linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'overview' }) },
  { key: 'prevention', label: 'Prevention', linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'prevention' }) },
];

const rootRoute = createRootRoute({ component: () => <Page><Outlet /></Page> });
const controlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$tenantId/{-$organizationId}/controls/$controlId',
  component: () => <><RouteTabs tabs={CONTROL_TABS} /><Outlet /></>,
});
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/dashboard' }),
  createRoute({ getParentRoute: () => rootRoute, path: '/controls' }),
  controlRoute.addChildren([
    createRoute({ getParentRoute: () => controlRoute, path: '/overview' }),
    createRoute({ getParentRoute: () => controlRoute, path: '/prevention' }),
  ]),
]);

const renderApp = async (initialEntry: string) => {
  const pageScrollReset = createPageScrollReset();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    scrollRestoration: true,
    scrollToTopSelectors: pageScrollReset.scrollToTopSelectors,
  });
  pageScrollReset.trackNavigations(router);
  const { container } = render(<RouterProvider router={router} />);
  await act(() => router.load());

  const page = () => {
    const element = container.querySelector('main');
    if (element === null) {
      throw new Error('The page container is not rendered.');
    }
    return element;
  };
  const scrollTo = (top: number) => {
    page().scrollTop = top;
    page().dispatchEvent(new Event('scroll'));
  };
  const settle = async (navigation: () => unknown) => {
    const rendered = new Promise<void>((resolve) => {
      const unsubscribe = router.subscribe('onRendered', () => {
        unsubscribe();
        resolve();
      });
    });
    await act(async () => {
      await navigation();
      await rendered;
    });
  };

  return { router, page, scrollTo, settle };
};

describe('page scroll position on navigation', () => {
  it('should open a page reached by a new navigation at the top', async () => {
    const { router, page, scrollTo, settle } = await renderApp('/dashboard');
    scrollTo(3000);

    await settle(() => router.navigate({ href: '/controls' }));

    expect(page().scrollTop).toBe(0);
  });

  it('should keep the offset on a tab switch, so the tab bar stays under the cursor', async () => {
    const { page, scrollTo, settle } = await renderApp('/tenant-1/controls/control-1/overview');
    scrollTo(100);

    await settle(() => fireEvent.click(screen.getByRole('tab', { name: 'Prevention' })));

    expect(page().scrollTop).toBe(100);
  });

  it('should bring back the offset a page was left at on a back navigation', async () => {
    const { router, page, scrollTo, settle } = await renderApp('/dashboard');
    scrollTo(3000);
    await settle(() => router.navigate({ href: '/controls' }));

    await settle(() => router.history.back());

    expect(page().scrollTop).toBe(3000);
  });

  it('should bring back the offset a page was left at on a forward navigation', async () => {
    const { router, page, scrollTo, settle } = await renderApp('/dashboard');
    scrollTo(3000);
    await settle(() => router.navigate({ href: '/controls' }));
    scrollTo(300);
    await settle(() => router.history.back());

    await settle(() => router.history.forward());

    expect(page().scrollTop).toBe(300);
  });

  it('should keep the offset on a navigation that changes the search only', async () => {
    const { router, page, scrollTo, settle } = await renderApp('/controls');
    scrollTo(400);

    await settle(() => router.navigate({ href: '/controls?status=unassessed', replace: true }));

    expect(page().scrollTop).toBe(400);
  });

  it('should keep the current offset when a portal shifted the page in the document during the navigation', async () => {
    const { router, page, scrollTo, settle } = await renderApp('/controls');
    scrollTo(500);
    await settle(() => router.navigate({ href: '/controls?status=unassessed', replace: true }));
    // An open select mounts its portal at the start of <body> and unmounts it once an option is picked.
    const portal = document.body.insertBefore(document.createElement('span'), document.body.firstChild);
    const unsubscribe = router.subscribe('onResolved', () => portal.remove());
    scrollTo(40);

    await settle(() => router.navigate({ href: '/controls', replace: true }));
    unsubscribe();

    expect(page().scrollTop).toBe(40);
  });
});
