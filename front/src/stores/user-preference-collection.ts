import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

const userPreferenceSchema = z.object({
  id: z.string(),
  theme: z.enum(['light', 'dark', 'system']),
  locale: z.string(),
});

export const userPreferenceCollection = createCollection(
  localStorageCollectionOptions({
    id: 'user-preference',
    storageKey: 'app:user-preference',
    getKey: (item) => item.id,
    schema: userPreferenceSchema,
  }),
);
