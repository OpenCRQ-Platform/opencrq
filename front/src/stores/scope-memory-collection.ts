import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

/** Keyed by `<userId>:<tenantId>`. Browser-only: losing it on another device costs one click. */
const scopeMemorySchema = z.object({
  id: z.string(),
  lastScopeId: z.string().nullable(),
  unpinnedScopeId: z.string().nullable(),
});

export const scopeMemoryCollection = createCollection(
  localStorageCollectionOptions({
    id: 'scope-memory',
    storageKey: 'app:scope-memory',
    getKey: (item) => item.id,
    schema: scopeMemorySchema,
  }),
);
