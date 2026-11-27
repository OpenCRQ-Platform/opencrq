import { applicationNameFor, assertNotFenced, claimDatabase, DB_INITIALIZATION_LOCK, readRecordedRelease, ReleaseFencedError } from '@app/back/src/utils/release-fence';
import type { ImageRelease } from '@app/back/src/utils/platform-version';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';

const older: ImageRelease = { version: '0.261126.0-dev.aaaaaaa', committedAt: 1_764_150_000 };
const newer: ImageRelease = { version: '0.261127.0-dev.bbbbbbb', committedAt: 1_764_250_000 };
// The release tag of the commit `newer` was built from.
const newerTagged: ImageRelease = { version: '0.261127.0', committedAt: newer.committedAt };

describe('fencing an older release out of the database', () => {
  const clients: Array<pg.Client> = [];

  const connect = async (applicationName: string, options?: string): Promise<pg.Client> => {
    const client = new pg.Client({ ...pgConfig, database: getWorkerDbName(), application_name: applicationName, options });
    // A terminated connection emits 'error'; the test reads it from the next query instead.
    client.on('error', () => undefined);
    await client.connect();
    clients.push(client);
    return client;
  };

  const forgetRelease = () => pool.query('DELETE FROM platform_metadata WHERE key = \'release_fence\'');

  beforeEach(forgetRelease);

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.end().catch(() => undefined)));
    await pool.query('DELETE FROM platform_metadata WHERE key = \'release_fence_probe\'');
    await forgetRelease();
  });

  it('records the release on a database no release has claimed', async () => {
    await expect(claimDatabase(pool, newer)).resolves.toEqual({ terminated: 0 });
    await expect(readRecordedRelease(pool)).resolves.toEqual(newer);
  });

  it('refuses the claim of an older release once a newer one is recorded', async () => {
    await claimDatabase(pool, newer);
    await expect(claimDatabase(pool, older)).rejects.toBeInstanceOf(ReleaseFencedError);
    await expect(readRecordedRelease(pool)).resolves.toEqual(newer);
  });

  it('terminates an older release\'s connection and rolls back its transaction in flight', async () => {
    await claimDatabase(pool, older);
    const stale = await connect(applicationNameFor(older));
    await stale.query('BEGIN');
    await stale.query('INSERT INTO platform_metadata (key, value) VALUES (\'release_fence_probe\', \'written by the older release\')');

    await expect(claimDatabase(pool, newer)).resolves.toEqual({ terminated: 1 });

    await expect(stale.query('COMMIT')).rejects.toThrow();
    const { rows } = await pool.query('SELECT 1 FROM platform_metadata WHERE key = \'release_fence_probe\'');
    expect(rows).toHaveLength(0);
  });

  it('leaves the connections of the same commit, of no release and of other applications alone', async () => {
    const sameRelease = await connect(applicationNameFor(newer));
    const sameCommit = await connect(applicationNameFor(newerTagged));
    const noRelease = await connect(applicationNameFor(undefined));
    const otherApplication = await connect('psql');

    await expect(claimDatabase(pool, newer)).resolves.toEqual({ terminated: 0 });

    for (const client of [sameRelease, sameCommit, noRelease, otherApplication]) {
      await expect(client.query('SELECT 1')).resolves.toBeDefined();
    }
  });

  it('refuses a new connection of an older release, and only of an older one', async () => {
    await claimDatabase(pool, newer);

    const stale = await connect(applicationNameFor(older));
    await expect(assertNotFenced(stale, older)).rejects.toBeInstanceOf(ReleaseFencedError);

    const sameCommit = await connect(applicationNameFor(newerTagged));
    await expect(assertNotFenced(sameCommit, newerTagged)).resolves.toBeUndefined();
  });

  it('refuses a new connection of an older release while a newer one initializes the database, with nothing recorded', async () => {
    const initializing = await connect(applicationNameFor(newer));
    await initializing.query('SELECT pg_advisory_lock(hashtext($1))', [DB_INITIALIZATION_LOCK]);

    const stale = await connect(applicationNameFor(older));
    await expect(assertNotFenced(stale, older)).rejects.toBeInstanceOf(ReleaseFencedError);

    const sameCommit = await connect(applicationNameFor(newerTagged));
    await expect(assertNotFenced(sameCommit, newerTagged)).resolves.toBeUndefined();
  });

  it('lets a newer release connect while an older one initializes the database', async () => {
    const initializing = await connect(applicationNameFor(older));
    await initializing.query('SELECT pg_advisory_lock(hashtext($1))', [DB_INITIALIZATION_LOCK]);

    const client = await connect(applicationNameFor(newer));
    await expect(assertNotFenced(client, newer)).resolves.toBeUndefined();
  });

  it('lets any release connect while none is recorded', async () => {
    const client = await connect(applicationNameFor(older));
    await expect(assertNotFenced(client, older)).resolves.toBeUndefined();
  });

  it('neither claims nor refuses on a database no release has migrated', async () => {
    const empty = await connect(applicationNameFor(older), '-c search_path=release_fence_no_such_schema');
    await expect(readRecordedRelease(empty)).resolves.toBeUndefined();
    await expect(assertNotFenced(empty, older)).resolves.toBeUndefined();
  });
});
