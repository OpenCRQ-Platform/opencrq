import { useSyncExternalStore } from 'react';

const canMatch = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * Whether the media query matches now, kept in step with the viewport. Read it in render instead of a
 * responsive class when FDS ships the plain class unlayered (`.hidden`, `.grid`, `.flex`), which beats
 * any variant on the same element. False where `matchMedia` does not exist (server, jsdom).
 */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = (onChange: () => void) => {
    if (!canMatch()) {
      return () => undefined;
    }
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
  const getSnapshot = () => canMatch() && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
};
