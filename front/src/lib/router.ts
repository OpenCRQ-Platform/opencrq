import { createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { RouteErrorComponent } from '../components/layout/route-error';
import { RouteNotFoundComponent } from '../components/layout/route-not-found';
import { createPageScrollReset } from './page-scroll-reset';
import { registerRouter } from './tenant-accessor';

const pageScrollReset = createPageScrollReset();

export const router = createRouter({
  routeTree,
  // Injected by the `Router` component of app.tsx.
  context: {
    auth: undefined!,
    queryClient: undefined!,
    trpc: undefined!,
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
  scrollToTopSelectors: pageScrollReset.scrollToTopSelectors,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: RouteErrorComponent,
  defaultNotFoundComponent: RouteNotFoundComponent,
});

pageScrollReset.trackNavigations(router);

registerRouter(router);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router,
  }
  interface StaticDataRouteOption {
    isVirtual?: boolean,
  }
}
