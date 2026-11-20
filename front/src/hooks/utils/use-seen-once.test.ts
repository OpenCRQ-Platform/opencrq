/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeenOnce } from './use-seen-once';

interface FakeObserver {
  callback: (entries: Array<{ isIntersecting: boolean }>) => void,
  options: IntersectionObserverInit | undefined,
  observe: ReturnType<typeof vi.fn>,
  disconnect: ReturnType<typeof vi.fn>,
}

const observers: Array<FakeObserver> = [];

const intersect = (observer: FakeObserver, isIntersecting: boolean) => {
  act(() => {
    observer.callback([{ isIntersecting }]);
  });
};

describe('useSeenOnce', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', function FakeIntersectionObserver(callback: FakeObserver['callback'], options?: IntersectionObserverInit) {
      const observer: FakeObserver = { callback, options, observe: vi.fn(), disconnect: vi.fn() };
      observers.push(observer);
      return observer;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderSeen = (margin?: number) => {
    const hook = renderHook(() => useSeenOnce(margin));
    act(() => {
      hook.result.current.ref(document.createElement('div'));
    });
    return hook;
  };

  it('should stay unseen until the element comes into view', () => {
    const { result } = renderSeen();

    intersect(observers[0], false);

    expect(result.current.seen).toBe(false);
  });

  it('should turn seen when the element intersects, and stop observing', () => {
    const { result } = renderSeen();

    intersect(observers[0], true);

    expect(result.current.seen).toBe(true);
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(observers).toHaveLength(1);
  });

  it('should keep seen once the element leaves the view', () => {
    const { result } = renderSeen();

    intersect(observers[0], true);
    intersect(observers[0], false);

    expect(result.current.seen).toBe(true);
  });

  it('should observe the element a margin of pixels ahead of the viewport', () => {
    renderSeen(600);

    expect(observers[0].options).toEqual({ root: null, rootMargin: '600px' });
  });

  it('should observe against the nearest scroll container, not a clipping ancestor', () => {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    const clipper = document.createElement('div');
    clipper.style.overflowY = 'hidden';
    const element = document.createElement('div');
    clipper.append(element);
    scroller.append(clipper);
    document.body.append(scroller);
    const { result } = renderHook(() => useSeenOnce(600));

    act(() => {
      result.current.ref(element);
    });

    expect(observers[0].options).toEqual({ root: scroller, rootMargin: '600px' });
    scroller.remove();
  });

  it('should not observe before an element is given', () => {
    renderHook(() => useSeenOnce());

    expect(observers).toHaveLength(0);
  });

  it('should start seen without IntersectionObserver, so nothing is deferred', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    const { result } = renderHook(() => useSeenOnce());

    expect(result.current.seen).toBe(true);
  });
});
