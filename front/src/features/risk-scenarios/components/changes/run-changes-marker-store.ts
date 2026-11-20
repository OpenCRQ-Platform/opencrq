import type { LabelledMarker } from './run-changes-curve';

/**
 * The moment a chronology row marks on the curve, held outside the page's state so that a hover
 * re-renders the curve alone, not the page and every row of its chronology.
 */
export interface MarkerStore {
  current: () => LabelledMarker | null,
  set: (marker: LabelledMarker | null) => void,
  subscribe: (listener: () => void) => () => void,
}

export const createMarkerStore = (): MarkerStore => {
  let marker: LabelledMarker | null = null;
  const listeners = new Set<() => void>();
  return {
    current: () => marker,
    set: (next) => {
      if (next === marker) {
        return;
      }
      marker = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
