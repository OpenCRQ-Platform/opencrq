import { asc, desc, eq, inArray } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { storedFiles } from './schema';

export const fileStorageRepository = defineRepository({
  insertStoredFile: ({ db }, values: typeof storedFiles.$inferInsert) =>
    db.insert(storedFiles).values([values]),

  findStoredFileNamesByIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select({ id: views.storedFiles.id, name: views.storedFiles.originalName })
      .from(views.storedFiles)
      .where(inArray(views.storedFiles.id, ids));
  },

  findStoredFileById: async ({ db, views }, id: string) => {
    const rows = await db
      .select()
      .from(views.storedFiles)
      .where(eq(views.storedFiles.id, id))
      .limit(1);
    return rows.at(0);
  },

  // What a bundle replay needs of a file: who stored it, and when. Oldest first, with the id as the
  // tie-break, so the order is the same on every read.
  findStoredFileAuthors: ({ db, views }) => db
    .select({
      id: views.storedFiles.id,
      createdAt: views.storedFiles.createdAt,
      createdBy: views.storedFiles.createdBy,
      createdByServiceAccountId: views.storedFiles.createdByServiceAccountId,
    })
    .from(views.storedFiles)
    .orderBy(asc(views.storedFiles.createdAt), asc(views.storedFiles.id)),

  // `views.storedFiles` is already tenant-scoped by the security read policy.
  findAllStoredFiles: ({ db, views }) => db
    .select({
      id: views.storedFiles.id,
      originalName: views.storedFiles.originalName,
      mimeType: views.storedFiles.mimeType,
      sizeBytes: views.storedFiles.sizeBytes,
      createdAt: views.storedFiles.createdAt,
      createdByEmail: views.users.email,
      createdByServiceAccountId: views.storedFiles.createdByServiceAccountId,
      createdByServiceAccountName: views.serviceAccounts.name,
    })
    .from(views.storedFiles)
    .leftJoin(views.users, eq(views.users.id, views.storedFiles.createdBy))
    .leftJoin(views.serviceAccounts, eq(views.serviceAccounts.id, views.storedFiles.createdByServiceAccountId))
    .orderBy(desc(views.storedFiles.createdAt)),
});
