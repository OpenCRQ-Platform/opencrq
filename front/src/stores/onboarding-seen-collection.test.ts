import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasSeenGetStarted, markGetStartedSeen, onboardingSeenCollection } from './onboarding-seen-collection';

describe('Get started seen marker', () => {
  afterEach(() => {
    const keys = Array.from(onboardingSeenCollection.keys());
    if (keys.length > 0) {
      onboardingSeenCollection.delete(keys);
    }
  });

  it('is unset until Get started is opened', () => {
    expect(hasSeenGetStarted('user-1', 'tenant-1')).toBe(false);
  });

  it('is kept in the browser storage, per user and tenant', () => {
    markGetStartedSeen('user-1', 'tenant-1');

    expect(hasSeenGetStarted('user-1', 'tenant-1')).toBe(true);
    expect(hasSeenGetStarted('user-1', 'tenant-2')).toBe(false);
    expect(hasSeenGetStarted('user-2', 'tenant-1')).toBe(false);
    expect(localStorage.getItem('app:onboarding-seen')).toContain('user-1:tenant-1');
  });

  it('is not duplicated when marked twice', () => {
    markGetStartedSeen('user-1', 'tenant-1');
    markGetStartedSeen('user-1', 'tenant-1');

    expect(onboardingSeenCollection.size).toBe(1);
  });

  it('is read back after a full page load, once the collection is preloaded', async () => {
    markGetStartedSeen('user-1', 'tenant-1');

    // A full page load: a fresh module over the same storage.
    vi.resetModules();
    const reloaded = await import('./onboarding-seen-collection');
    expect(reloaded.hasSeenGetStarted('user-1', 'tenant-1')).toBe(false);

    await reloaded.onboardingSeenCollection.preload();
    expect(reloaded.hasSeenGetStarted('user-1', 'tenant-1')).toBe(true);
  });

  it('stays set past the collection garbage-collection delay, with nothing subscribed', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const fresh = await import('./onboarding-seen-collection');
      await fresh.onboardingSeenCollection.preload();
      fresh.markGetStartedSeen('user-3', 'tenant-3');

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      expect(fresh.onboardingSeenCollection.status).not.toBe('cleaned-up');
      expect(fresh.onboardingSeenCollection.has('user-3:tenant-3')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the marker for the page when storage refuses it', async () => {
    vi.resetModules();
    const fresh = await import('./onboarding-seen-collection');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      expect(() => fresh.markGetStartedSeen('user-4', 'tenant-4')).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(fresh.onboardingSeenCollection.has('user-4:tenant-4')).toBe(false);

      expect(fresh.hasSeenGetStarted('user-4', 'tenant-4')).toBe(true);
    } finally {
      setItem.mockRestore();
    }
  });

  it('reads as unseen and does not throw when the storage cannot be read', () => {
    const has = vi.spyOn(onboardingSeenCollection, 'has').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(hasSeenGetStarted('user-5', 'tenant-5')).toBe(false);
    } finally {
      has.mockRestore();
    }
  });
});
