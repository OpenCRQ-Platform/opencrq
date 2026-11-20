import { describe, expect, it, vi } from 'vitest';
import type { LabelledMarker } from './run-changes-curve';
import { createMarkerStore } from './run-changes-marker-store';

const moment: LabelledMarker = { kind: 'moment', at: new Date(Date.UTC(2026, 9, 3, 10)), label: 'Oct 3, 2026 10:00' };

describe('createMarkerStore', () => {
  it('starts with no marker', () => {
    expect(createMarkerStore().current()).toBeNull();
  });

  it('holds the marker it was given and notifies its subscribers', () => {
    const store = createMarkerStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(moment);
    expect(store.current()).toBe(moment);
    store.set(null);
    expect(store.current()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies nobody when the marker does not change', () => {
    const store = createMarkerStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(null);
    store.set(moment);
    store.set(moment);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying a listener once unsubscribed', () => {
    const store = createMarkerStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(moment);
    expect(listener).not.toHaveBeenCalled();
  });
});
