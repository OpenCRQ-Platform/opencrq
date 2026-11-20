import type { Pool, QueryResult } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findSeedSkipReason, PRESERVED_METADATA_KEYS, resetDatabaseIfVersionChanged, restorePreservedMetadata, storeCurrentVersion, storeSeededBoot } from './db-reset';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QueryFn = (text: string, values?: Array<unknown>) => Promise<QueryResult>;

const createMockPool = (queryImpl: QueryFn) => {
  const client = { query: vi.fn(queryImpl), release: vi.fn() };
  const pool = {
    query: vi.fn(queryImpl),
    connect: vi.fn(() => Promise.resolve(client)),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, partial object satisfies Pool interface in practice
  return { pool: pool as unknown as Pool, client };
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, object literal satisfies Logger interface in practice
const stubLogger = () => ({
  logTrace: vi.fn(),
  logFromError: vi.fn(),
}) as unknown as Parameters<typeof resetDatabaseIfVersionChanged>[2];

const restoreEnv = (name: 'APP_VERSION' | 'BOOT_ID', value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

// Shorthand query-result builder
const qr = <T extends Record<string, unknown>>(rows: Array<T>): QueryResult<T> =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- partial QueryResult; rowCount and rows are sufficient for the tested code paths
  ({ rows, rowCount: rows.length }) as QueryResult<T>;

// ---------------------------------------------------------------------------
// resetDatabaseIfVersionChanged
// ---------------------------------------------------------------------------

describe('resetDatabaseIfVersionChanged', () => {
  const originalEnv = process.env.APP_VERSION;

  beforeEach(() => {
    process.env.APP_VERSION = '2.0.0';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = originalEnv;
    }
  });

  it('returns false when resetEnabled is false', async () => {
    const { pool } = createMockPool(() => Promise.resolve(qr([])));
    const result = await resetDatabaseIfVersionChanged(pool, false, stubLogger());

    expect(result).toEqual({ reset: false, preserved: [] });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns false and logs when APP_VERSION is not set', async () => {
    delete process.env.APP_VERSION;
    const { pool } = createMockPool(() => Promise.resolve(qr([])));
    const logger = stubLogger();

    const result = await resetDatabaseIfVersionChanged(pool, true, logger);

    expect(result).toEqual({ reset: false, preserved: [] });
    expect(pool.query).not.toHaveBeenCalled();
    expect(logger.logTrace).toHaveBeenCalledWith(
      'APP_VERSION not set: skipping reset_on_version_change check.',
    );
  });

  it('returns false when stored version matches current version', async () => {
    const { pool } = createMockPool((_text, values) => {
      if (values?.[0] === 'app_version') {
        return Promise.resolve(qr([{ value: '2.0.0' }]));
      }
      return Promise.resolve(qr([]));
    });

    const result = await resetDatabaseIfVersionChanged(pool, true, stubLogger());

    expect(result).toEqual({ reset: false, preserved: [] });
  });

  it('resets when stored version differs from current version', async () => {
    const { pool, client } = createMockPool((_text, values) => {
      if (values?.[0] === 'app_version') {
        return Promise.resolve(qr([{ value: '1.0.0' }]));
      }
      return Promise.resolve(qr([]));
    });
    const logger = stubLogger();

    const result = await resetDatabaseIfVersionChanged(pool, true, logger);

    expect(result.reset).toBe(true);
    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA public CASCADE');
    expect(client.query).toHaveBeenCalledWith('CREATE SCHEMA public');
    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS drizzle CASCADE');
    expect(logger.logTrace).toHaveBeenCalledWith(
      'Version change detected, resetting database...',
      { storedVersion: '1.0.0', currentVersion: '2.0.0' },
    );
  });

  // XTM One resolves the entitlement against the instance id it registered, so
  // regenerating that id presents a platform its contract does not cover.
  // Asserted on the constant itself: the query below is built from it, so
  // comparing the two would agree with any list, this one included when empty.
  it('preserves the instance id the entitlement is resolved against, and the installed Filigran license', () => {
    expect(PRESERVED_METADATA_KEYS).toEqual(['instance_id', 'filigran_license_pem']);
  });

  it('captures the preserved metadata before dropping the schema', async () => {
    const instanceId = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
    const preservedQueries: Array<Array<unknown> | undefined> = [];
    const { pool, client } = createMockPool((text, values) => {
      if (values?.[0] === 'app_version') {
        return Promise.resolve(qr([{ value: '1.0.0' }]));
      }
      if (text.includes('key = ANY($1)')) {
        preservedQueries.push(values);
        return Promise.resolve(qr([{ key: 'instance_id', value: instanceId }]));
      }
      return Promise.resolve(qr([]));
    });

    const result = await resetDatabaseIfVersionChanged(pool, true, stubLogger());

    expect(result.reset).toBe(true);
    // The parameter, not just the returned stub: a capture that asked for
    // fewer keys than the list holds would otherwise still look green.
    expect(preservedQueries).toEqual([[PRESERVED_METADATA_KEYS]]);
    expect(result.preserved).toEqual([{ key: 'instance_id', value: instanceId }]);
    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA public CASCADE');
  });

  it('resets when no version is stored (empty metadata table)', async () => {
    const { pool, client } = createMockPool(() => Promise.resolve(qr([])));
    const logger = stubLogger();

    const result = await resetDatabaseIfVersionChanged(pool, true, logger);

    expect(result.reset).toBe(true);
    expect(result.preserved).toEqual([]);
    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA public CASCADE');
    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS drizzle CASCADE');
    expect(logger.logTrace).toHaveBeenCalledWith(
      'Version change detected, resetting database...',
      { storedVersion: null, currentVersion: '2.0.0' },
    );
  });

  it('resets when the metadata table does not exist (undefined_table error)', async () => {
    const { pool, client } = createMockPool((text, values) => {
      if (values?.[0] === 'app_version' || text.includes('key = ANY($1)')) {
        const error = Object.assign(new Error('relation "platform_metadata" does not exist'), { code: '42P01' });
        return Promise.reject(error);
      }
      return Promise.resolve(qr([]));
    });
    const logger = stubLogger();

    const result = await resetDatabaseIfVersionChanged(pool, true, logger);

    expect(result.reset).toBe(true);
    expect(result.preserved).toEqual([]);
    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA public CASCADE');
    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS drizzle CASCADE');
    expect(logger.logTrace).toHaveBeenCalledWith(
      'Version change detected, resetting database...',
      { storedVersion: null, currentVersion: '2.0.0' },
    );
  });

  it('rethrows non "table missing" errors instead of resetting', async () => {
    const error = Object.assign(new Error('connection terminated unexpectedly'), { code: '08006' });
    const { pool, client } = createMockPool((_text, values) => {
      if (values?.[0] === 'app_version') {
        return Promise.reject(error);
      }
      return Promise.resolve(qr([]));
    });

    await expect(resetDatabaseIfVersionChanged(pool, true, stubLogger())).rejects.toThrow(error);
    expect(client.query).not.toHaveBeenCalledWith('DROP SCHEMA public CASCADE');
  });
});

// ---------------------------------------------------------------------------
// restorePreservedMetadata
// ---------------------------------------------------------------------------

describe('restorePreservedMetadata', () => {
  it('re-inserts preserved entries, overwriting anything minted after the drop', async () => {
    const { pool } = createMockPool(() => Promise.resolve(qr([])));
    const logger = stubLogger();

    await restorePreservedMetadata(pool, [{ key: 'instance_id', value: 'instance-1' }], logger);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'),
      ['instance_id', 'instance-1'],
    );
    expect(logger.logTrace).toHaveBeenCalledWith(
      'Restored preserved metadata entry after database reset.',
      { key: 'instance_id' },
    );
  });

  it('logs and continues when a restore insert fails', async () => {
    const error = new Error('connection lost');
    const { pool } = createMockPool(() => Promise.reject(error));
    const logger = stubLogger();

    await restorePreservedMetadata(pool, [{ key: 'instance_id', value: 'instance-1' }], logger);

    expect(logger.logFromError).toHaveBeenCalledWith(
      error,
      "Failed to restore preserved metadata entry 'instance_id' after database reset",
    );
  });
});

// ---------------------------------------------------------------------------
// storeCurrentVersion
// ---------------------------------------------------------------------------

describe('storeCurrentVersion', () => {
  const originalEnv = process.env.APP_VERSION;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = originalEnv;
    }
  });

  it('upserts the current version into the metadata table', async () => {
    process.env.APP_VERSION = '3.0.0';
    const { pool } = createMockPool(() => Promise.resolve(qr([])));
    const logger = stubLogger();

    await storeCurrentVersion(pool, logger);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO'),
      ['3.0.0'],
    );
    expect(logger.logTrace).toHaveBeenCalledWith(
      'Stored current app version in metadata.',
      { version: '3.0.0' },
    );
  });

  it('does nothing when APP_VERSION is not set', async () => {
    delete process.env.APP_VERSION;
    const { pool } = createMockPool(() => Promise.resolve(qr([])));

    await storeCurrentVersion(pool, stubLogger());

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('logs and swallows errors from the upsert query', async () => {
    process.env.APP_VERSION = '3.0.0';
    const error = new Error('connection lost');
    const { pool } = createMockPool(() => Promise.reject(error));
    const logger = stubLogger();

    await storeCurrentVersion(pool, logger);

    expect(logger.logFromError).toHaveBeenCalledWith(
      error,
      'Failed to store app version in metadata',
    );
  });
});

// ---------------------------------------------------------------------------
// findSeedSkipReason
// ---------------------------------------------------------------------------

describe('findSeedSkipReason', () => {
  const originalVersion = process.env.APP_VERSION;
  const originalBootId = process.env.BOOT_ID;

  // Routes each metadata read on its key parameter; an absent key has no row.
  const metadataPool = (stored: Record<string, string>) =>
    createMockPool((_text, values) => {
      const value = stored[String(values?.[0])];
      return Promise.resolve(qr(value === undefined ? [] : [{ value }]));
    });

  const queriedKeys = (pool: Pool) =>
    vi.mocked(pool.query).mock.calls.map(([, values]) => (Array.isArray(values) ? values[0] : undefined));

  beforeEach(() => {
    delete process.env.APP_VERSION;
    delete process.env.BOOT_ID;
  });

  afterEach(() => {
    restoreEnv('APP_VERSION', originalVersion);
    restoreEnv('BOOT_ID', originalBootId);
  });

  it("returns 'version' without reading the seeded boot id when the stored version matches", async () => {
    process.env.APP_VERSION = '2.0.0';
    process.env.BOOT_ID = 'boot-1';
    const { pool } = metadataPool({ app_version: '2.0.0', seeded_boot_id: 'boot-1' });

    await expect(findSeedSkipReason(pool)).resolves.toBe('version');
    expect(queriedKeys(pool)).toEqual(['app_version']);
  });

  it("returns 'boot' when the stored version differs and the seeded boot id matches", async () => {
    process.env.APP_VERSION = '2.0.0';
    process.env.BOOT_ID = 'boot-1';
    const { pool } = metadataPool({ app_version: '1.0.0', seeded_boot_id: 'boot-1' });

    await expect(findSeedSkipReason(pool)).resolves.toBe('boot');
  });

  it("returns 'boot' when no version is stored and the seeded boot id matches", async () => {
    process.env.APP_VERSION = '2.0.0';
    process.env.BOOT_ID = 'boot-1';
    const { pool } = metadataPool({ seeded_boot_id: 'boot-1' });

    await expect(findSeedSkipReason(pool)).resolves.toBe('boot');
  });

  it("returns 'boot' without reading the stored version when APP_VERSION is not set", async () => {
    process.env.BOOT_ID = 'boot-1';
    const { pool } = metadataPool({ app_version: '1.0.0', seeded_boot_id: 'boot-1' });

    await expect(findSeedSkipReason(pool)).resolves.toBe('boot');
    expect(queriedKeys(pool)).toEqual(['seeded_boot_id']);
  });

  it('returns null when the seeded boot id belongs to a previous boot', async () => {
    process.env.APP_VERSION = '2.0.0';
    process.env.BOOT_ID = 'boot-2';
    const { pool } = metadataPool({ app_version: '1.0.0', seeded_boot_id: 'boot-1' });

    await expect(findSeedSkipReason(pool)).resolves.toBeNull();
  });

  it('returns null when no boot id has been seeded yet', async () => {
    process.env.APP_VERSION = '2.0.0';
    process.env.BOOT_ID = 'boot-1';
    const { pool } = metadataPool({ app_version: '1.0.0' });

    await expect(findSeedSkipReason(pool)).resolves.toBeNull();
  });

  it('returns null without any query when neither APP_VERSION nor BOOT_ID is set', async () => {
    const { pool } = metadataPool({ app_version: '1.0.0', seeded_boot_id: 'boot-1' });

    await expect(findSeedSkipReason(pool)).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('treats empty APP_VERSION and BOOT_ID as not set', async () => {
    process.env.APP_VERSION = '';
    process.env.BOOT_ID = '';
    const { pool } = metadataPool({ app_version: '', seeded_boot_id: '' });

    await expect(findSeedSkipReason(pool)).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns null when the metadata table does not exist', async () => {
    process.env.APP_VERSION = '2.0.0';
    process.env.BOOT_ID = 'boot-1';
    const error = Object.assign(new Error('relation "platform_metadata" does not exist'), { code: '42P01' });
    const { pool } = createMockPool(() => Promise.reject(error));

    await expect(findSeedSkipReason(pool)).resolves.toBeNull();
  });

  it('rethrows any other error', async () => {
    process.env.BOOT_ID = 'boot-1';
    const error = Object.assign(new Error('connection terminated unexpectedly'), { code: '08006' });
    const { pool } = createMockPool(() => Promise.reject(error));

    await expect(findSeedSkipReason(pool)).rejects.toThrow(error);
  });
});

// ---------------------------------------------------------------------------
// storeSeededBoot
// ---------------------------------------------------------------------------

describe('storeSeededBoot', () => {
  const originalBootId = process.env.BOOT_ID;

  afterEach(() => restoreEnv('BOOT_ID', originalBootId));

  it('upserts the boot id under the seeded_boot_id key', async () => {
    process.env.BOOT_ID = 'boot-1';
    const { pool } = createMockPool(() => Promise.resolve(qr([])));
    const logger = stubLogger();

    await storeSeededBoot(pool, logger);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (key) DO UPDATE'),
      ['seeded_boot_id', 'boot-1'],
    );
    expect(logger.logTrace).toHaveBeenCalledWith(
      'Stored the seeded boot id in metadata.',
      { bootId: 'boot-1' },
    );
  });

  it('does nothing when BOOT_ID is not set', async () => {
    delete process.env.BOOT_ID;
    const { pool } = createMockPool(() => Promise.resolve(qr([])));

    await storeSeededBoot(pool, stubLogger());

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('does nothing when BOOT_ID is empty', async () => {
    process.env.BOOT_ID = '';
    const { pool } = createMockPool(() => Promise.resolve(qr([])));

    await storeSeededBoot(pool, stubLogger());

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('logs and swallows errors from the upsert query', async () => {
    process.env.BOOT_ID = 'boot-1';
    const error = new Error('connection lost');
    const { pool } = createMockPool(() => Promise.reject(error));
    const logger = stubLogger();

    await storeSeededBoot(pool, logger);

    expect(logger.logFromError).toHaveBeenCalledWith(
      error,
      'Failed to store the seeded boot id in metadata',
    );
  });
});
