/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollProgress, scrollProgressReachable, useScrollProgress } from './use-scroll-progress';

describe('scrollProgress', () => {
  it('is 0 while the element sits below the line', () => {
    expect(scrollProgress(300, 100, 14, 260)).toBe(0);
  });

  it('grows with the distance scrolled past the line', () => {
    expect(scrollProgress(-16, 100, 14, 260)).toBe(0.5);
  });

  it('stops at 1 once the whole distance is scrolled', () => {
    expect(scrollProgress(-900, 100, 14, 260)).toBe(1);
  });
});

describe('scrollProgressReachable', () => {
  it('holds when the scroller can still scroll past the end of the distance', () => {
    expect(scrollProgressReachable(300, 100, 14, 260, 446)).toBe(true);
  });

  it('holds when the scroller stops one pixel short, the rounding slack', () => {
    expect(scrollProgressReachable(300, 100, 14, 260, 445)).toBe(true);
  });

  it('fails when the scroller stops two pixels short', () => {
    expect(scrollProgressReachable(300, 100, 14, 260, 444)).toBe(false);
  });

  it('fails when the scroller stops short of the end of the distance', () => {
    expect(scrollProgressReachable(300, 100, 14, 260, 320)).toBe(false);
  });

  it('holds once the whole distance is scrolled, at the bottom of the page', () => {
    expect(scrollProgressReachable(-900, 100, 14, 260, 0)).toBe(true);
  });
});

describe('useScrollProgress', () => {
  // The element sits 186 px below the line, so the fold needs 446 px of scroll: 200 px of room falls short, 500 px is enough.
  const SHORT = 800;
  const LONG = 1100;

  let scrollHeight: number;
  let observed: Set<Element>;
  let notifyResize: () => void;
  let scroller: HTMLDivElement;
  let content: HTMLDivElement;
  let element: HTMLDivElement;

  beforeEach(() => {
    observed = new Set();
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this);
      }

      observe(target: Element) {
        observed.add(target);
      }

      unobserve(target: Element) {
        observed.delete(target);
      }

      disconnect() {
        observed.clear();
      }
    });

    scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    content = document.createElement('div');
    element = document.createElement('div');
    content.appendChild(element);
    scroller.appendChild(content);
    document.body.appendChild(scroller);

    Object.defineProperty(scroller, 'scrollHeight', { get: () => scrollHeight });
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    Object.defineProperty(scroller, 'scrollTop', { value: 0 });
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 100 }));
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 300 }));
  });

  afterEach(() => {
    cleanup();
    scroller.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const track = (height: number) => {
    scrollHeight = height;
    const hook = renderHook(() => useScrollProgress(14, 260));
    act(() => {
      hook.result.current.ref(element);
    });
    return hook;
  };

  const resizeContent = (height: number) => {
    scrollHeight = height;
    act(() => {
      if (observed.has(content)) {
        notifyResize();
      }
    });
  };

  it('becomes reachable when the content grows, without a scroll', () => {
    const { result } = track(SHORT);
    expect(result.current.reachable).toBe(false);

    resizeContent(LONG);

    expect(result.current.reachable).toBe(true);
  });

  it('stops being reachable when the content shrinks, without a scroll', () => {
    const { result } = track(LONG);
    expect(result.current.reachable).toBe(true);

    resizeContent(SHORT);

    expect(result.current.reachable).toBe(false);
  });
});
