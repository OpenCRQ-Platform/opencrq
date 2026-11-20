import { text as streamToText } from 'node:stream/consumers';
import type { ParsedThreat } from '@app/module';
import { NonRetryableError, parseThreatBundle } from '@app/module';
import { dbEngine } from '../../engines/db';
import { FileNotFoundError, fileStorageOperations } from '../../services/file-storage';

/** A stored STIX file and the author it is analysed under. */
export type ThreatBundlePayload =
  | { storedFileId: string, userId: string }
  | { storedFileId: string, serviceAccountId: string };

export const bundleOrigin = (file: ThreatBundlePayload, tenantId: string) => 'userId' in file
  ? { type: 'client' as const, userId: file.userId, tenantId }
  : { type: 'connector' as const, serviceAccountId: file.serviceAccountId, tenantId };

/**
 * A connector feed and a manual upload are two doors onto the same intelligence, but the kind is
 * what the canonical ranking and the sources panel read to say which feed stated what.
 */
export const bundleSourceKind = (file: ThreatBundlePayload) => 'userId' in file ? 'stix-import' as const : 'connector' as const;

/** Throws a `NonRetryableError` for a file that is gone or is not JSON, which no retry can fix. */
export const readStoredBundle = async (file: ThreatBundlePayload, tenantId: string): Promise<Array<ParsedThreat>> => {
  let stream;
  try {
    ({ stream } = await fileStorageOperations.readFile(dbEngine.db, bundleOrigin(file, tenantId), file.storedFileId));
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      throw new NonRetryableError('STIX bundle file not found in storage', { cause: err });
    }
    throw err;
  }
  const raw = await streamToText(stream);

  let bundle: unknown;
  try {
    bundle = JSON.parse(raw);
  } catch (error) {
    throw new NonRetryableError('Invalid STIX bundle: not valid JSON', { cause: error });
  }
  return parseThreatBundle(bundle);
};
