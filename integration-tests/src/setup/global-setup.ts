import { schema } from '@app/module';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { pgConfig, TEST_DB_TEMPLATE, TEST_DB_WORKER_PREFIX } from './pg-config';

export const setup = async () => {
  const adminPool = new pg.Pool({ ...pgConfig, database: 'postgres' });

  try {
    // Drop any leftover per-worker DBs from a previous run (crashes can leave them behind).
    const { rows: leftovers } = await adminPool.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${TEST_DB_WORKER_PREFIX}%`],
    );
    for (const { datname } of leftovers) {
      await adminPool.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [datname],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${datname}"`);
    }

    // Drop and recreate the seeded template. Workers will CREATE … TEMPLATE from it.
    await adminPool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB_TEMPLATE],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${TEST_DB_TEMPLATE}"`);
    await adminPool.query(`CREATE DATABASE "${TEST_DB_TEMPLATE}"`);
  } finally {
    await adminPool.end();
  }

  const templatePool = new pg.Pool({ ...pgConfig, database: TEST_DB_TEMPLATE });
  const templateDb = drizzle(templatePool, { schema });

  try {
    const { runMigration, seed } = await import('@app/module');
    await runMigration(templateDb);
    await seed(templateDb);
  } finally {
    await templatePool.end();
  }
};

export const teardown = async () => {
  // Worker DBs and template are kept for debugging. The next run will recycle them.
};
