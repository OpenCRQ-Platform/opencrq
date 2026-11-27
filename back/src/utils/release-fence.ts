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
const APPLICATION_NAME_PATTERN = new RegExp(`^${APPLICATION_NAME}:([0-9]{1,15}):(.+)$`);

/** The session lock a release holds while it resets and migrates the database. */
export const DB_INITIALIZATION_LOCK = 'db_initialization';
// PostgreSQL error code for "undefined_table": a database no release has migrated yet.
const UNDEFINED_TABLE = '42P01';

/** Names every connection of a release with the date of its commit, which the newer release terminates by. */
export const applicationNameFor = (release: ImageRelease | undefined): string => (
  release === undefined ? APPLICATION_NAME : `${APPLICATION_NAME}:${release.committedAt}:${release.version}`
);

const releaseOf = (applicationName: string): ImageRelease | null => {
  const match = APPLICATION_NAME_PATTERN.exec(applicationName);
  return match ? { committedAt: Number(match[1]), version: match[2] } : null;
};

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

/**
 * Refuses a connection of a release older than the one recorded, or than the one initializing the
 * database: a reset drops the record, and the migrations only bring it back once they are done.
 */
export const assertNotFenced = async (client: Pick<ClientBase, 'query'>, release: ImageRelease): Promise<void> => {
  const { rows } = await client.query<{ application_name: string }>(
    `SELECT a.application_name
     FROM pg_locks l
     JOIN pg_stat_activity a ON a.pid = l.pid
     CROSS JOIN (SELECT hashtext($1)::bigint AS key) k
     WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
       AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND l.classid = ((k.key >> 32) & 4294967295)::oid
       AND l.objid = (k.key & 4294967295)::oid`,
    [DB_INITIALIZATION_LOCK],
  );
  const initializing = rows[0] ? releaseOf(rows[0].application_name) : null;
  if (initializing && initializing.committedAt > release.committedAt) {
    throw new ReleaseFencedError(release, initializing);
  }
  const recorded = await readRecordedRelease(client);
  if (recorded && recorded.committedAt > release.committedAt) {
    throw new ReleaseFencedError(release, recorded);
  }
};

/**
 * Records `release` as the database's and terminates the connections of every older release, rolling
 * back their transactions in flight. Throws `ReleaseFencedError` when a newer release is recorded. On
 * a database no release has migrated yet, there is nothing to record, but still connections to end.
 */
export const claimDatabase = async (pool: Pool, release: ImageRelease): Promise<{ terminated: number }> => {
  const recorded = await readRecordedRelease(pool);
  if (recorded && recorded.committedAt > release.committedAt) {
    throw new ReleaseFencedError(release, recorded);
  }
  const value = JSON.stringify({ version: release.version, committedAt: release.committedAt });
  if (recorded !== undefined && recorded?.version !== release.version) {
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
    [APPLICATION_NAME_PATTERN.source, release.committedAt],
  );
  return { terminated: rows[0]?.terminated ?? 0 };
};
