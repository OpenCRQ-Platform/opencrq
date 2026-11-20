import type { AnyRouter } from '@tanstack/react-router';

// Without a restoration id, the router keys the page's offset by its position in the document,
// which a portal mounted at the start of <body> (an open select) shifts: a filter picked from one
// then restores a stale offset.
export const PAGE_SCROLL_RESTORATION_ID = 'page';

/**
 * The page scrolls inside its own container, not the window, and the router carries the offset of
 * every container it does not reset into the next page. This one is reset on a pathname change
 * only: a search-only navigation (a list filter, a drawer tab) keeps the page where the reader left it.
 */
export const createPageScrollReset = () => {
  let pathChanged = false;
  return {
    scrollToTopSelectors: [
      () => (pathChanged ? document.querySelector(`[data-scroll-restoration-id="${PAGE_SCROLL_RESTORATION_ID}"]`) : null),
    ],
    trackNavigations: (router: AnyRouter) => router.subscribe('onBeforeNavigate', (event) => {
      pathChanged = event.pathChanged;
    }),
  };
};
