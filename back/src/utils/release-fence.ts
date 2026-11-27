import type { ClientBase, Pool } from 'pg';
import type { ImageRelease } from './platform-version';

/*
 * Two releases writing to one database can corrupt it even without a schema change, since a release
 * can change how a column is filled. A newer release therefore records itself in the database before
 * it migrates and ends every connection of an older one; an older one refuses every connection it
 * opens afterwards, so it stops writing even when nothing stops its pod.
 */

const APPLICATION_NAME = 'opencrq';
const RELEASE_KEY = 'release_fence';
// PostgreSQL error code for "undefined_table": a database no release has migrated yet.
const UNDEFINED_TABLE = '42P01';

/** Names every connection of a release with the date of its commit, which the newer release terminates by. */
export const applicationNameFor = (release: ImageRelease | undefined): string => (
  release === undefined ? APPLICATION_NAME : `${APPLICATION_NAME}:${release.committedAt}:${release.version}`
);

export class ReleaseFencedError extends Error {
  constructor(readonly release: ImageRelease, readonly recorded: ImageRelease) {
    super(`The database belongs to release ${recorded.version}, newer than this process's ${release.version}`);
    this.name = 'ReleaseFencedError';
  }
}

const parseRecorded = (value: string): ImageRelease | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && 'committedAt' in parsed
      && typeof parsed.version === 'string' && typeof parsed.committedAt === 'number') {
      return { version: parsed.version, committedAt: parsed.committedAt };
    }
  } catch {
    // An unreadable record fences nobody; the next claim overwrites it.
  }
  return null;
};

/** The release recorded in the database: null when none is, undefined when no release has migrated it yet. */
export const readRecordedRelease = async (client: Pick<ClientBase, 'query'>): Promise<ImageRelease | null | undefined> => {
  try {
    const { rows } = await client.query<{ value: string }>('SELECT value FROM platform_metadata WHERE key = $1', [RELEASE_KEY]);
    return rows[0] ? parseRecorded(rows[0].value) : null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === UNDEFINED_TABLE) {
      return undefined;
    }
    throw error;
  }
};

/** Refuses a connection of a release older than the one recorded: what keeps a fenced process from writing again. */
export const assertNotFenced = async (client: Pick<ClientBase, 'query'>, release: ImageRelease): Promise<void> => {
  const recorded = await readRecordedRelease(client);
  if (recorded && recorded.committedAt > release.committedAt) {
    throw new ReleaseFencedError(release, recorded);
  }
};

/**
 * Records `release` as the database's and terminates the connections of every older release, rolling
 * back their transactions in flight. Throws `ReleaseFencedError` when a newer release is recorded.
 * Returns null on a database no release has migrated yet, where nothing can be recorded nor fenced.
 */
export const claimDatabase = async (pool: Pool, release: ImageRelease): Promise<{ terminated: number } | null> => {
  const recorded = await readRecordedRelease(pool);
  if (recorded === undefined) {
    return null;
  }
  if (recorded && recorded.committedAt > release.committedAt) {
    throw new ReleaseFencedError(release, recorded);
  }
  const value = JSON.stringify({ version: release.version, committedAt: release.committedAt });
  if (recorded?.version !== release.version) {
    await pool.query(
      `INSERT INTO platform_metadata (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RELEASE_KEY, value],
    );
  }
  // The CASE keeps the cast off other applications' names, since AND sets no evaluation order. Only the
  // roles this one belongs to: terminating another role's connection is an error, not a no-op.
  const { rows } = await pool.query<{ terminated: number }>(
    `SELECT count(*) FILTER (WHERE pg_terminate_backend(pid))::int AS terminated
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
       AND CASE WHEN application_name ~ $1 THEN split_part(application_name, ':', 2)::bigint < $2 ELSE false END
       AND pg_has_role(usesysid, 'MEMBER')`,
    [`^${APPLICATION_NAME}:[0-9]{1,15}:`, release.committedAt],
  );
  return { terminated: rows[0]?.terminated ?? 0 };
};
