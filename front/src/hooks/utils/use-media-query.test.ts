/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './use-media-query';

const QUERY = '(max-height: 800px)';

const stubMatchMedia = (initial: boolean) => {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    set: (next: boolean) => {
      matches = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
};

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should read the query on mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(true);
  });

  it('should follow the viewport when the query flips, and stop listening on unmount', () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('should answer false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);
  });
});
