import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

const LocalStorageTableStateSchema = z.object({
  id: z.string(),
  columnOrder: z.array(z.string()).optional(),
  columnVisibility: z.record(z.string(), z.boolean()).optional(),
  pageSize: z.number().int().positive().optional(),
  view: z.string().optional(),
  sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })).optional(),
});

export type LocalTableState = z.infer<typeof LocalStorageTableStateSchema>;

export const localTableStateCollection = createCollection(
  localStorageCollectionOptions({
    id: 'local-table-state',
    storageKey: 'app:table-state',
    getKey: (item) => item.id,
    schema: LocalStorageTableStateSchema,
  }),
);
