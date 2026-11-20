import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

const xtmSessionSchema = z.object({
  id: z.string(),
});

/**
 * Set while this browser holds a session, so the login page can tell a session that ended (it goes
 * straight back through XTM One) from a first visit or a sign-out (it shows the button). Per browser,
 * not a user preference, so it has no tRPC side. Preloaded before the first render (`main.tsx`): an
 * idle collection answers `has()` with `false` whatever its storage holds.
 */
export const xtmSessionCollection = createCollection(
  localStorageCollectionOptions({
    id: 'xtm-session',
    storageKey: 'app:xtm-session',
    getKey: (item) => item.id,
    schema: xtmSessionSchema,
  }),
);

const HAD_SESSION = 'had-session';

/** A session is open in this browser. */
export const rememberSession = (): void => {
  try {
    if (!xtmSessionCollection.has(HAD_SESSION)) {
      xtmSessionCollection.insert({ id: HAD_SESSION });
    }
  } catch {
    // Storage blocked: the login page shows the button instead.
  }
};

/** A sign-out, or the one redirect a session that ended earns. */
export const forgetSession = (): void => {
  try {
    if (xtmSessionCollection.has(HAD_SESSION)) {
      xtmSessionCollection.delete(HAD_SESSION);
    }
  } catch {
    // Nothing to forget.
  }
};

export const hadSession = (): boolean => {
  try {
    return xtmSessionCollection.has(HAD_SESSION);
  } catch {
    return false;
  }
};
