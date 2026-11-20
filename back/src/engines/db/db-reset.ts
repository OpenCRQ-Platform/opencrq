import type { Pool } from 'pg';
import type { createLogger } from '../../utils/logger';
import { imageVersion } from '../../utils/platform-version';

type Logger = ReturnType<typeof createLogger>;

const METADATA_TABLE = 'platform_metadata';

// PostgreSQL error code for "undefined_table".
const UNDEFINED_TABLE = '42P01';

// Deployment-level identity that must survive a reset_on_version_change.
// `instance_id` is what XTM One knows this platform by (`platform_id` at
// registration) and what the XTM license sub-licenses: regenerating it would
// present a platform the license does not name, silently downgrading it to
// Community Edition on a redeploy.
// `filigran_license_pem` is the Filigran license an administrator installed
// (features/edition/edition-license.ts), lost to a reset for the same reason.
// `instance_creation` is left out on purpose: a reset restarts a `ci`
// license's 45-minute window, as OpenCTI does when its database is recreated.
// `app_version` is intentionally NOT preserved - the post-reset boot must
// see a version mismatch so migrations and seeding run from scratch.
export const PRESERVED_METADATA_KEYS = ['instance_id', 'filigran_license_pem'];

export type PreservedMetadata = Array<{ key: string, value: string }>;

const readPreservedMetadata = async (pool: Pool): Promise<PreservedMetadata> => {
  try {
    const result = await pool.query<{ key: string, value: string }>(
      `SELECT key, value FROM ${METADATA_TABLE} WHERE key = ANY($1)`,
      [PRESERVED_METADATA_KEYS],
    );
    return result.rows;
  } catch (error) {
    // Fresh DB (migrations never ran): nothing to preserve.
    if (error instanceof Error && 'code' in error && error.code === UNDEFINED_TABLE) {
      return [];
    }
    throw error;
  }
};

/**
 * Re-insert metadata captured before a reset, once migrations have recreated
 * the table. The captured value wins over anything written in the meantime:
 * every preserved key is a deployment identity, and a value minted after the
 * drop is by definition the fresh one this preservation exists to discard.
 */
export const restorePreservedMetadata = async (pool: Pool, preserved: PreservedMetadata, { logTrace, logFromError }: Logger): Promise<void> => {
  for (const { key, value } of preserved) {
    try {
      await pool.query(
        `INSERT INTO ${METADATA_TABLE} (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
      logTrace('Restored preserved metadata entry after database reset.', { key });
    } catch (error) {
      logFromError(error, `Failed to restore preserved metadata entry '${key}' after database reset`);
    }
  }
};

const SEEDED_BOOT_ID_KEY = 'seeded_boot_id';

const readMetadataValue = async (pool: Pool, key: string): Promise<string | null> => {
  try {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM ${METADATA_TABLE} WHERE key = $1`,
      [key],
    );
    return result.rows[0]?.value ?? null;
  } catch (error) {
    // Only the "table missing" case (fresh DB, migrations never ran) means no stored
    // value. Any other error (connection, permission, ...) must NOT be swallowed:
    // treating it as null would let a transient failure trigger a destructive reset.
    if (error instanceof Error && 'code' in error && error.code === UNDEFINED_TABLE) {
      return null;
    }
    throw error;
  }
};

export const getStoredVersion = (pool: Pool): Promise<string | null> => readMetadataValue(pool, 'app_version');

export type SeedSkipReason = 'version' | 'boot';

/**
 * Why this process may skip seeding, or null when it must seed. A BOOT_ID is
 * shared by the processes of one process-manager start, so a matching
 * `seeded_boot_id` means a sibling has already seeded.
 */
export const findSeedSkipReason = async (pool: Pool): Promise<SeedSkipReason | null> => {
  const currentVersion = imageVersion();
  if (currentVersion && await getStoredVersion(pool) === currentVersion) {
    return 'version';
  }

  const bootId = process.env.BOOT_ID;
  if (bootId && await readMetadataValue(pool, SEEDED_BOOT_ID_KEY) === bootId) {
    return 'boot';
  }

  return null;
};

export const storeCurrentVersion = async (pool: Pool, { logTrace, logFromError }: Logger) => {
  const currentVersion = imageVersion();
  if (!currentVersion) {
    return;
  }

  try {
    await pool.query(
      `INSERT INTO ${METADATA_TABLE} (key, value) VALUES ('app_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [currentVersion],
    );
    logTrace('Stored current app version in metadata.', { version: currentVersion });
  } catch (error) {
    logFromError(error, 'Failed to store app version in metadata');
  }
};

export const storeSeededBoot = async (pool: Pool, { logTrace, logFromError }: Logger) => {
  const bootId = process.env.BOOT_ID;
  if (!bootId) {
    return;
  }

  try {
    await pool.query(
      `INSERT INTO ${METADATA_TABLE} (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SEEDED_BOOT_ID_KEY, bootId],
    );
    logTrace('Stored the seeded boot id in metadata.', { bootId });
  } catch (error) {
    logFromError(error, 'Failed to store the seeded boot id in metadata');
  }
};

export interface ResetResult {
  reset: boolean,
  /** Metadata rows captured before the drop, to restore after migrations. */
  preserved: PreservedMetadata,
}

export const resetDatabaseIfVersionChanged = async (pool: Pool, resetEnabled: boolean, { logTrace }: Logger): Promise<ResetResult> => {
  if (!resetEnabled) {
    return { reset: false, preserved: [] };
  }

  const currentVersion = imageVersion();
  if (!currentVersion) {
    logTrace('APP_VERSION not set: skipping reset_on_version_change check.');
    return { reset: false, preserved: [] };
  }

  const storedVersion = await getStoredVersion(pool);
  if (storedVersion === currentVersion) {
    return { reset: false, preserved: [] };
  }

  logTrace('Version change detected, resetting database...', { storedVersion, currentVersion });

  const preserved = await readPreservedMetadata(pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  logTrace('Database reset complete. Schema recreated.', { preservedKeys: preserved.map(({ key }) => key) });
  return { reset: true, preserved };
};
