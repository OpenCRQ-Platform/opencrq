import { uuidv7 } from 'uuidv7';
import { originServiceAccountId, originUserId } from '../../security';
import { defineService } from '../../registry';
import { fileStorageRepository } from './repository';

export interface RegisterFileInput {
  storageKey: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
}

export const fileStorageService = defineService(
  'fileStorage',
  fileStorageRepository,
).implement({
  registerFile: async ({ repo, eventOrigin }, tenantId: string, input: RegisterFileInput) => {
    const id = uuidv7();
    const createdBy = originUserId(eventOrigin) ?? null;
    const createdByServiceAccountId = originServiceAccountId(eventOrigin) ?? null;
    await repo.insertStoredFile({
      id,
      tenantId,
      storageKey: input.storageKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      createdBy,
      createdByServiceAccountId,
    });
    return { id, tenantId, ...input };
  },

  getFile: async ({ repo }, id: string) =>
    repo.findStoredFileById(id),

  getNamesByIds: async ({ repo }, ids: Array<string>) =>
    await repo.findStoredFileNamesByIds(ids),

  list: async ({ repo }) =>
    repo.findAllStoredFiles(),

  getFileAuthors: async ({ repo }) => repo.findStoredFileAuthors(),
});
