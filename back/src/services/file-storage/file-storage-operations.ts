import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import type { DrizzleDB } from '@app/module';
import { createServices, fileStorageService } from '@app/module';
import { fromError, StructuredError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { createLogger } from '../../utils/logger';
import { fileStorageClient } from '../../clients/file-storage';

const { logTrace, logFromError } = createLogger({ feature: 'file-storage' });

export interface WriteFileInput {
  stream: Readable,
  /**
   * Size of the stream content in bytes. Omit when the size isn't known ahead of time
   * (e.g. a streaming multipart upload) — writeFile() will count bytes as they flow
   * through via a `Transform`, and switch to a bounded-memory multipart upload.
   */
  sizeBytes?: number,
  originalName: string,
  mimeType: string,
}

export interface StoredFileResult {
  id: string,
  tenantId: string,
  storageKey: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
}

/** A file's content stream plus the metadata a caller needs to serve it (e.g. HTTP headers). */
export interface ReadFileResult {
  stream: Readable,
  originalName: string,
  mimeType: string,
}

/**
 * An EventOrigin variant that carries a verified, non-null tenantId.
 * Passed to writeFile/readFile so the security layer enforces tenant-scoped
 * DB queries rather than relying on manual string comparisons.
 */
export type TenantOrigin =
  | { readonly type: 'client', readonly userId: string, readonly tenantId: string }
  | { readonly type: 'connector', readonly serviceAccountId: string, readonly tenantId: string };

/**
 * Thrown by `readFile` when the DB record doesn't exist (or belongs to another tenant). A
 * dedicated class lets callers identify this specific, non-retryable case via `instanceof`
 * instead of string-matching `messageKey` (which is still set, for structured logging).
 */
export class FileNotFoundError extends StructuredError<{ fileId: string }> {
  override readonly name: string = 'FileNotFoundError';

  constructor(fileId: string) {
    super('File not found', { data: { fileId } });
  }
}

/**
 * `fileStorageClient.putObject/getObject` already throw a `StructuredError` ('File storage is
 * disabled') when unconfigured — that one propagates as-is. Any other unexpected error (storage
 * backend outage, DB failure, ...) is wrapped for consistent, structured logging/handling
 * upstream.
 */
const wrapUnexpected = (err: unknown, tenantId: string): never => {
  if (err instanceof StructuredError) {
    throw err;
  }
  throw fromError(err, 'File storage is unavailable', { tenantId });
};

const writeFile = async (db: DrizzleDB, origin: TenantOrigin, input: WriteFileInput): Promise<StoredFileResult> => {
  const { tenantId } = origin;
  const storageKey = uuidv7();

  const services = createServices([fileStorageService], db).withOrigin(origin);

  logTrace('Writing file', { tenantId, originalName: input.originalName, mimeType: input.mimeType, storageKey });

  const objectKey = `${tenantId}/${storageKey}`;
  logTrace('Uploading to object storage', { objectKey });

  let sizeBytes = input.sizeBytes;
  try {
    if (sizeBytes === undefined) {
      let countedBytes = 0;
      // `chunk` is guaranteed to be a Buffer here even though `input.stream` could in principle be
      // an object-mode source emitting strings (e.g. `Readable.from(['...'])` in tests): this
      // Transform is not `objectMode`, and a non-object-mode Writable defaults to
      // `decodeStrings: true`, so Node converts any string chunk to a Buffer before `transform()`
      // runs. `chunk.length` is therefore already an accurate byte count (verified against
      // `Buffer.byteLength()` with multi-byte UTF-8 content) — no need to special-case strings.
      const byteCounter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          countedBytes += chunk.length;
          callback(null, chunk);
        },
      });
      await fileStorageClient.putObject(objectKey, input.stream.pipe(byteCounter), input.mimeType);
      sizeBytes = countedBytes;
    } else {
      await fileStorageClient.putObject(objectKey, input.stream, input.mimeType, sizeBytes);
    }
  } catch (err) {
    return wrapUnexpected(err, tenantId);
  }

  try {
    const result = await services.fileStorage.registerFile(tenantId, {
      storageKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes,
    });
    logTrace('File stored', { fileId: result.id, tenantId, storageKey });
    return result;
  } catch (err) {
    // The object storage upload already succeeded at this point, so the object would otherwise
    // leak forever. Best-effort cleanup: never let a delete failure mask the original DB error,
    // and never throw from here — just log it so an orphaned object can be tracked down manually.
    await fileStorageClient.deleteObject(objectKey).catch((deleteErr: unknown) => {
      logFromError(deleteErr, 'Failed to clean up orphaned object after a registerFile() failure', { tenantId, objectKey });
    });
    return wrapUnexpected(err, tenantId);
  }
};

const readFile = async (db: DrizzleDB, origin: TenantOrigin, fileId: string): Promise<ReadFileResult> => {
  const { tenantId } = origin;
  const services = createServices([fileStorageService], db).withOrigin(origin);

  logTrace('Reading file', { fileId, tenantId });

  const file = await services.fileStorage.getFile(fileId);
  if (!file) {
    // The security layer already filters by tenantId; undefined means either
    // the file does not exist or it belongs to a different tenant.
    throw new FileNotFoundError(fileId);
  }

  const objectKey = `${tenantId}/${file.storageKey}`;
  try {
    const stream = await fileStorageClient.getObject(objectKey);
    return { stream, originalName: file.originalName, mimeType: file.mimeType };
  } catch (err) {
    return wrapUnexpected(err, tenantId);
  }
};

export const fileStorageOperations = { writeFile, readFile };
