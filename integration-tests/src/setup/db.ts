import { schema } from '@app/module';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getWorkerDbName, pgConfig, TEST_DB_TEMPLATE } from './pg-config';

const workerDbName = getWorkerDbName();

// Each Vitest worker gets its own DB, cloned from the seeded template.
// Cloning happens once per worker process; re-uses on subsequent file loads
// in the same worker (isolate=true still works because truncateAllTables in beforeEach
// keeps tests independent).
const adminPool = new pg.Pool({ ...pgConfig, database: 'postgres' });
try {
  const { rows } = await adminPool.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
    [workerDbName],
  );
  if (!rows[0]?.exists) {
    await adminPool.query(
      `CREATE DATABASE "${workerDbName}" TEMPLATE "${TEST_DB_TEMPLATE}"`,
    );
  }
} finally {
  await adminPool.end();
}

const pool = new pg.Pool({ ...pgConfig, database: workerDbName });

export const db = drizzle(pool, { schema });
export { pool };

export const closeDb = async () => {
  await pool.end();
};
