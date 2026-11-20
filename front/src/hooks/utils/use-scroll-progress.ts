import { useEffect, useState } from 'react';

/** How far, from 0 to 1, an element at `top` has scrolled past the line `offset` below the scroller's top, over `distance` pixels. */
export const scrollProgress = (top: number, scrollerTop: number, offset: number, distance: number): number =>
  Math.min(Math.max((scrollerTop + offset - top) / distance, 0), 1);

/**
 * Whether the scroller, which can still scroll `remaining` pixels, has room for that progress to reach 1.
 * The pixel of slack absorbs the scroll offset and the scroll height being rounded apart.
 */
export const scrollProgressReachable = (top: number, scrollerTop: number, offset: number, distance: number, remaining: number): boolean =>
  top - scrollerTop - offset + distance <= remaining + 1;

const scrollerOf = (element: HTMLElement): HTMLElement | null => {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent;
    }
  }
  return null;
};

interface ScrollProgress {
  ref: (element: HTMLElement | null) => void,
  progress: number,
  /** Whether the page is long enough for `progress` to reach 1, re-measured as its content resizes. */
  reachable: boolean,
  /** The scroller's top padding, which a sticky `top` counts from: `offset - inset` sticks on the line. */
  inset: number,
}

/** Tracks the element given to `ref` against its nearest scrolling ancestor. Without one, `progress` stays 0 and `reachable` false. */
export const useScrollProgress = (offset: number, distance: number): ScrollProgress => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [reachable, setReachable] = useState(false);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const scroller = element === null ? null : scrollerOf(element);
    if (element === null || scroller === null) {
      return undefined;
    }
    const measure = () => {
      const scrollerTop = scroller.getBoundingClientRect().top;
      const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const { top } = element.getBoundingClientRect();
      setInset(parseFloat(getComputedStyle(scroller).paddingTop));
      setProgress(scrollProgress(top, scrollerTop, offset, distance));
      setReachable(scrollProgressReachable(top, scrollerTop, offset, distance, remaining));
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const contentResize = new ResizeObserver(measure);
    for (const content of Array.from(scroller.children)) {
      contentResize.observe(content);
    }
    return () => {
      scroller.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      contentResize.disconnect();
    };
  }, [element, offset, distance]);

  return { ref: setElement, progress, reachable, inset };
};
