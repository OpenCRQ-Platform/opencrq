import type { Readable } from 'node:stream';
import { newError } from '@app/utils';
import type { FileStorageProvider } from './file-storage-provider';
import { createLogger } from '../../utils/logger';
import { getFileStorageSettings } from './file-storage-config';
import { createObjectStorageProvider } from './object-storage-provider';

const { logFromError, logFromFatalError } = createLogger({ feature: 'file-storage' });

// Lazily built, memoized singleton — `undefined` means "not resolved yet", `null` means
// "resolved: file storage is not configured". Kept module-level (no lifecycle/registerEngine)
// since this is a client, not an engine.
let cachedProvider: FileStorageProvider | null | undefined;

const getProvider = (): FileStorageProvider | null => {
  if (cachedProvider === undefined) {
    const settings = getFileStorageSettings();
    cachedProvider = settings
      ? createObjectStorageProvider({
        endpoint: settings.endpoint,
        accessKey: settings.accessKey,
        secretKey: settings.secretKey,
        bucket: settings.bucket,
        region: settings.region,
      })
      : null;
  }
  return cachedProvider;
};

// Second memoization layer around `provider.initialize()` (HeadBucket, +CreateBucket if
// `inDev`) — runs once, shared between the fire-and-forget startup check and the first real
// writeFile/readFile call. On failure the cached promise is reset so the *next* call retries
// naturally instead of remembering a transient failure forever (no setInterval/polling).
let initializePromise: Promise<void> | undefined;

const ensureInitialized = (provider: FileStorageProvider): Promise<void> => {
  if (!initializePromise) {
    initializePromise = provider.initialize().catch((err: unknown) => {
      initializePromise = undefined;
      throw err;
    });
  }
  return initializePromise;
};

type FileStorageErrorKind = 'config' | 'connectivity';

const CONNECTIVITY_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']);
const CONNECTIVITY_ERROR_NAMES = new Set(['TimeoutError', 'NetworkingError']);

/**
 * Classifies an `initialize()` failure so `checkStartupConfig()` can decide whether to hard-fail
 * (misconfigured deployment) or just log and keep running (transient outage — self-heals lazily
 * on the first real use). Defaults to `'config'`; only a recognized low-level network error is
 * treated as `'connectivity'`.
 *
 * `ENOTFOUND` (DNS resolution failure) is deliberately classified as `'config'`: a typo'd
 * endpoint hostname is more likely at boot time than a genuine DNS outage. This is an accepted
 * false-positive risk (a real DNS blip at boot would incorrectly hard-fail the process).
 */
const classifyFileStorageError = (err: NodeJS.ErrnoException): FileStorageErrorKind => {
  if ((err.code && CONNECTIVITY_ERROR_CODES.has(err.code)) || CONNECTIVITY_ERROR_NAMES.has(err.name)) {
    return 'connectivity';
  }
  return 'config';
};

/**
 * Fire-and-forget check, called once from `features/file-storage`'s `activate()` when file
 * storage is configured. A misconfigured deployment (wrong credentials/bucket) crashes the
 * process now — loud and fast — rather than let every upload silently fail later. A transient
 * network blip only logs and keeps the process running; `ensureInitialized` retries naturally
 * on the next real `writeFile`/`readFile` call.
 */
const checkStartupConfig = (): void => {
  const provider = getProvider();
  if (!provider) {
    return;
  }
  ensureInitialized(provider).catch((err: unknown) => {
    if (err instanceof Error && classifyFileStorageError(err) === 'connectivity') {
      logFromError(err, 'File storage is temporarily unreachable at startup; will retry on first real use');
      return;
    }
    logFromFatalError(err, 'File storage is misconfigured — fix FILE_STORAGE__* before restarting');
  });
};

const putObject = async (key: string, body: Readable | Buffer, contentType: string, contentLength?: number): Promise<void> => {
  const provider = getProvider();
  if (!provider) {
    throw newError('File storage is disabled', {});
  }
  await ensureInitialized(provider);
  await provider.putObject(key, body, contentType, contentLength);
};

const getObject = async (key: string): Promise<Readable> => {
  const provider = getProvider();
  if (!provider) {
    throw newError('File storage is disabled', {});
  }
  await ensureInitialized(provider);
  return provider.getObject(key);
};

const deleteObject = async (key: string): Promise<void> => {
  const provider = getProvider();
  if (!provider) {
    return;
  }
  await provider.deleteObject(key);
};

export const fileStorageClient = { putObject, getObject, deleteObject, checkStartupConfig };
