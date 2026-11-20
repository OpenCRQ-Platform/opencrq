import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

const onboardingSeenSchema = z.object({
  id: z.string(),
});

/**
 * Keyed by `<userId>:<tenantId>`: this browser already opened Get started for that user in that tenant, so the tenant
 * home stops redirecting there. Browser-only, losing it on another device costs one redirect. Read synchronously by
 * the home route's `beforeLoad`, so preloaded before the first render (`main.tsx`): an idle collection answers `has()`
 * with `false` whatever its storage holds. Nothing subscribes to it, so it is never garbage-collected: the default
 * `gcTime` would clear it five minutes after the preload.
 */
export const onboardingSeenCollection = createCollection(
  localStorageCollectionOptions({
    id: 'onboarding-seen',
    storageKey: 'app:onboarding-seen',
    getKey: (item) => item.id,
    schema: onboardingSeenSchema,
    gcTime: Infinity,
  }),
);

/** Holds the marker for the page's lifetime when storage refuses it: a failed write rolls back asynchronously, out of the `catch`'s reach. */
const seenThisPage = new Set<string>();

const getKey = (userId: string, tenantId: string): string => `${userId}:${tenantId}`;

export const markGetStartedSeen = (userId: string, tenantId: string): void => {
  const key = getKey(userId, tenantId);
  seenThisPage.add(key);
  try {
    if (!onboardingSeenCollection.has(key)) {
      onboardingSeenCollection.insert({ id: key });
    }
  } catch {
    // Storage blocked: the next page load redirects again, which is harmless.
  }
};

export const hasSeenGetStarted = (userId: string, tenantId: string): boolean => {
  const key = getKey(userId, tenantId);
  if (seenThisPage.has(key)) {
    return true;
  }
  try {
    return onboardingSeenCollection.has(key);
  } catch {
    return false;
  }
};
