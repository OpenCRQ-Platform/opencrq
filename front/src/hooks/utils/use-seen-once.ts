import { useEffect, useState } from 'react';

interface SeenOnce {
  ref: (element: Element | null) => void,
  seen: boolean,
}

/** Only a scroll container is a root: any other `overflow` ancestor clips the element without scrolling it. */
const scrollParentOf = (element: Element): Element | null => {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) {
      return parent;
    }
  }
  return null;
};

/**
 * Turns `seen` true the first time the element given to `ref` comes within `margin` pixels of its
 * scroll container's edge (the viewport when none scrolls), and keeps it true. The margin has to be
 * set on that container: an ancestor that scrolls clips the element before a viewport root's margin
 * reaches it. Without `IntersectionObserver` it starts true: nothing is deferred.
 */
export const useSeenOnce = (margin = 0): SeenOnce => {
  const [element, setElement] = useState<Element | null>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (element === null || seen) {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
      }
    }, { root: scrollParentOf(element), rootMargin: `${margin}px` });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, seen, margin]);

  return { ref: setElement, seen };
};
