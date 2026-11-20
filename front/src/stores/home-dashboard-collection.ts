import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';
import { z } from 'zod';

/** Keyed by `<userId>:<tenantId>`: the user's choice belongs to one user, the default to one tenant. */
const homeDashboardSchema = z.object({
  id: z.string(),
  userDashboardId: z.string().nullable(),
  tenantDashboardId: z.string().nullable(),
});

export const homeDashboardCollection = createCollection(
  localStorageCollectionOptions({
    id: 'home-dashboard',
    storageKey: 'app:home-dashboard',
    getKey: (item) => item.id,
    schema: homeDashboardSchema,
  }),
);
