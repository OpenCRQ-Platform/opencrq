import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

const menuStatusSchema = z.object({
  id: z.string(),
  open: z.boolean(),
});

export const menuStatusCollection = createCollection(
  localStorageCollectionOptions({
    id: 'menu-open',
    storageKey: 'app:menu-open',
    getKey: (item) => item.id,
    schema: menuStatusSchema,
  }),
);
