import { runMigration } from '@app/module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../../setup/db';

type Row = { hash: string, createdAt: number };

const rows = async (): Promise<Array<Row>> => {
  const { rows: found } = await pool.query<{ hash: string, created_at: string }>(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  return found.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
};

const replaceRows = async (replacement: Array<Row>): Promise<void> => {
  await pool.query('DELETE FROM drizzle.__drizzle_migrations');
  for (const row of replacement) {
    await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [row.hash, row.createdAt]);
  }
};

describe('runMigration bookkeeping', () => {
  let applied: Array<Row>;
  let baseline: Row;

  beforeEach(async () => {
    applied = await rows();
    [baseline] = applied;
  });

  afterEach(async () => {
    await replaceRows(applied);
  });

  it('should delete the rows of migrations older than the baseline, and keep the baseline\'s and every later one\'s', async () => {
    const kept = [...applied, { hash: 'later', createdAt: applied.at(-1)!.createdAt + 1_000 }];
    await replaceRows([
      { hash: 'folded-1', createdAt: baseline.createdAt - 2_000 },
      { hash: 'folded-2', createdAt: baseline.createdAt - 1_000 },
      ...kept,
    ]);

    await runMigration(db);

    expect(await rows()).toEqual(kept);
  });

  it('should keep every row of a database the baseline fails on', async () => {
    const behind = [{ hash: 'folded', createdAt: baseline.createdAt - 1_000 }];
    await replaceRows(behind);

    await expect(runMigration(db)).rejects.toThrow();

    expect(await rows()).toEqual(behind);
  });
});

describe('runMigration analyze threshold', () => {
  const table = 'created_by_a_later_migration';

  const reloptions = async (): Promise<Array<string> | null> => {
    const { rows: [found] } = await pool.query<{ reloptions: Array<string> | null }>(
      'SELECT reloptions FROM pg_class WHERE oid = $1::regclass',
      [table],
    );
    return found.reloptions;
  };

  beforeEach(async () => {
    await pool.query(`CREATE TABLE ${table} (id uuid PRIMARY KEY)`);
  });

  afterEach(async () => {
    await pool.query(`DROP TABLE ${table}`);
  });

  it('should lower the analyze threshold of a table that does not carry it yet', async () => {
    await runMigration(db);

    expect(await reloptions()).toEqual(['autovacuum_analyze_threshold=0']);
  });

  it('should keep a threshold an operator set on a table', async () => {
    await pool.query(`ALTER TABLE ${table} SET (autovacuum_analyze_threshold = 5)`);

    await runMigration(db);

    expect(await reloptions()).toEqual(['autovacuum_analyze_threshold=5']);
  });

  it('should leave a table another session holds to the next run instead of waiting for it', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`LOCK TABLE ${table} IN SHARE UPDATE EXCLUSIVE MODE`);

      await runMigration(db);

      expect(await reloptions()).toBeNull();
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }

    await runMigration(db);

    expect(await reloptions()).toEqual(['autovacuum_analyze_threshold=0']);
  });
});

describe('runMigration fillfactor', () => {
  // One of the tables the syncs rewrite, standing for all of them.
  const table = 'cve';

  const fillfactor = async (): Promise<string | undefined> => {
    const { rows: [found] } = await pool.query<{ reloptions: Array<string> | null }>(
      'SELECT reloptions FROM pg_class WHERE oid = $1::regclass',
      [table],
    );
    return found.reloptions?.find((option) => option.startsWith('fillfactor='));
  };

  beforeEach(async () => {
    await pool.query(`ALTER TABLE ${table} RESET (fillfactor)`);
  });

  afterEach(async () => {
    await pool.query(`ALTER TABLE ${table} SET (fillfactor = 70)`);
  });

  it('should give a table the syncs rewrite its fillfactor back', async () => {
    await runMigration(db);

    expect(await fillfactor()).toBe('fillfactor=70');
  });

  it('should leave a table another session holds to the next run instead of failing the boot', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`LOCK TABLE ${table} IN SHARE UPDATE EXCLUSIVE MODE`);

      await runMigration(db);

      expect(await fillfactor()).toBeUndefined();
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }

    await runMigration(db);

    expect(await fillfactor()).toBe('fillfactor=70');
  });
});
