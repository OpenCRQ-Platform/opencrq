import { config } from '../../config';

/** Resolved, ready-to-use file storage (S3-compatible) connection settings. */
export interface FileStorageSettings {
  endpoint: string,
  accessKey: string,
  secretKey: string,
  bucket: string,
  region: string,
}

/**
 * Single source of truth for "is file storage configured". Returns `null` when the
 * `file_storage` config block is entirely absent (feature disabled). When present,
 * `endpoint`/`access_key`/`secret_key` are enforced as mandatory by the Zod schema itself
 * (`configSchema` parse throws at boot on an incomplete block), so no further validation is
 * needed here. Read fresh via `config()` on every call — cheap, no caching needed.
 */
export const getFileStorageSettings = (): FileStorageSettings | null => {
  const raw = config().file_storage;
  if (!raw) {
    return null;
  }
  return {
    endpoint: raw.endpoint,
    accessKey: raw.access_key,
    secretKey: raw.secret_key,
    bucket: raw.bucket,
    region: raw.region,
  };
};
