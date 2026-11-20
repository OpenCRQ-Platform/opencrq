import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { getFileStorageSettings } from '../../../clients/file-storage';

const StoredFileSchema = z.object({
  id: z.uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.date(),
  createdByEmail: z.string().nullable(),
  createdByServiceAccountId: z.uuid().nullable(),
  createdByServiceAccountName: z.string().nullable(),
});

const NAMES_BY_IDS_CAP = 200;

export const fileStorageRouter = (procedure: TenantProcedure) => router({
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the files users upload
  list: procedure
    .output(z.array(StoredFileSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin).fileStorage.list()),

  // bounded-by: NAMES_BY_IDS_CAP input ids, at most one file per id
  getNamesByIds: procedure
    .input(z.object({ ids: z.array(z.uuid()).max(NAMES_BY_IDS_CAP) }))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(({ input, ctx: { services, origin } }) => (input.ids.length === 0
      ? []
      : services.withOrigin(origin).fileStorage.getNamesByIds(input.ids))),

  getSettings: procedure
    .output(z.object({ enabled: z.boolean() }))
    .query(() => ({ enabled: getFileStorageSettings() !== null })),
});
