---
name: local-storage
description: Persist a user choice across sessions with the two-layer tRPC and local-storage architecture. Use when adding a theme, a language or any UI preference that must survive a reload.
---

# Client-side persistent state

When a user choice must be persisted across sessions (theme, language, UI preferences…), use the following two-layer architecture:

1. **tRPC** as the authoritative store — the value is saved in the database and fetched via a tRPC query.
2. **A `@tanstack/react-db` collection** as the local reactive cache — the collection is backed by `localStorage` and is the only source of truth that components read from.

Never access `localStorage` directly (`localStorage.getItem`, `localStorage.setItem`, `localStorage.removeItem` are all forbidden). Never store user choices in plain React state that is not persisted.

## Architecture

```
User action (component)
  └─ tRPC mutation → saves to DB
       └─ the SSE doorbell marks the tRPC query stale
            └─ provider re-fetches via useQuery
                 └─ useEffect syncs DB value → collection
                      └─ useLiveQuery in components reads the updated value
```

The collection acts as a reactive bridge: it hydrates from `localStorage` on first load (so the value is available immediately before the first network call) and is kept in sync with the DB by the provider once the query resolves.

## Defining a collection

Create a file under `src/stores/` with `createCollection` + `localStorageCollectionOptions` and a Zod schema:

```ts
import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

export const myPreferenceCollection = createCollection(
  localStorageCollectionOptions({
    id: 'my-preference',
    storageKey: 'app:my-preference', // always prefix with `app:`
    getKey: (item) => item.id,
    schema: z.object({ id: z.string(), value: z.string() }),
  }),
);
```

## Provider responsibility

The provider fetches from the DB and syncs to the collection:

```ts
const trpc = useTRPC();
const query = useQuery(trpc.someQuery.queryOptions());
const dbValue = query.data;

useEffect(() => {
  if (dbValue !== undefined) {
    if (myPreferenceCollection.has('my-preference')) {
      myPreferenceCollection.update('my-preference', (draft) => { draft.value = dbValue; });
    } else {
      myPreferenceCollection.insert({ id: 'my-preference', value: dbValue });
    }
  }
}, [dbValue]);
```

Value resolution order: DB value (from query) → collection value (from localStorage) → hardcoded default.

## Component responsibility

**Reading** — consume context exposed by the provider, or `useLiveQuery` directly:

```ts
const { data } = useLiveQuery((q) =>
  q.from({ el: myPreferenceCollection })
    .where(({ el }) => eq(el.id, 'my-preference'))
    .findOne(),
);
```

**Writing** — call the tRPC mutation and nothing else; never write to the collection directly, and
never invalidate the query by hand: the SSE doorbell refreshes it after the write, and
`no-restricted-syntax` rejects a manual `invalidateQueries`.

```ts
const mutation = useMutation(trpc.someUpdate.mutationOptions({
  meta: { skipSuccessToast: true },
}));
```

## Mutation pattern: let the provider handle side effects

When a preference change has a side effect (language reload, theme switch…), **do not trigger that side effect in the component's mutation handler**. The provider already reacts when the doorbell refreshes the query — it is the single place responsible for applying the change.

The language is the one exception, because a Lingui catalog only switches on a reload: the profile
caches the new resolved locale, which the bootstrap reads before the first render, then reloads
(`routes/_auth/$tenantId/{-$organizationId}/profile.tsx`).

```ts
// ✅ Correct — the mutation saves to DB, the resolved locale is cached for the bootstrap, and the
// reload loads its catalog
const updateLocaleMutation = useMutation(trpc.users.updateUser.mutationOptions({
  meta: { skipSuccessToast: true },
  onSuccess: (_, { locale }) => {
    rememberLocale(resolveLocale({
      userLocale: locale ?? null,
      tenantLocale: tenant?.defaultLocale ?? null,
      browserLanguages: navigator.languages,
    }));
    window.location.reload();
  },
}));

// handler
void updateLocaleMutation.mutateAsync({ locale });
```

```ts
// ❌ Wrong — invalidates by hand what the doorbell already refreshes, and loads a catalog the
// bootstrap loads after the reload
const mutation = useMutation(trpc.users.updateUser.mutationOptions({
  onSuccess: () => { void queryClient.invalidateQueries(trpc.users.getUserLocale.queryFilter()); },
}));

void mutation.mutateAsync({ locale })
  .then(() => loadCatalog(locale))
  .then(() => window.location.reload());
```

**Reading a preference in a component** — read the query directly (same source the provider uses), not the collection:

```ts
// ✅ Correct — reads from the same query the provider syncs from
const localeQuery = useQuery(trpc.users.getUserLocale.queryOptions());
const currentLocale = localeQuery.data ?? 'en';

// ❌ Wrong — reads a stale snapshot from the collection bypassing the reactive chain
const { data: pref } = useLiveQuery(...);
const currentLocale = pref?.locale ?? 'en';
```

## Anti-patterns

```ts
// ❌ Direct localStorage access
localStorage.setItem('my-pref', value);
const pref = localStorage.getItem('my-pref');

// ❌ Non-reactive helper over localStorage
export const getStoredValue = () => localStorage.getItem('app:my-pref') ?? 'default';

// ❌ Writing to the collection from a component instead of going through tRPC
myPreferenceCollection.update('my-preference', (draft) => { draft.value = newValue; });
```
