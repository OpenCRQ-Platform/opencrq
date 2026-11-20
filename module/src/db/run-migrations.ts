import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import type { DrizzleDB } from './index';

const migrationPath = path.join(__dirname, 'migrations');

export const runMigration = async (db: DrizzleDB) => {
  // A row older than the oldest migration file records a migration a squash folded into the
  // baseline, and Drizzle v1 refuses to start on a row no file matches. Deleted only once
  // migrate() succeeded, so a database the baseline could not apply to keeps its history.
  const squashedBefore = readMigrationFiles({ migrationsFolder: migrationPath })[0].folderMillis;
  await migrate(db, { migrationsFolder: migrationPath });
  await db.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE created_at < ${squashedBefore}`);
  await lowerAnalyzeThresholds(db);
};

/**
 * Autovacuum analyzes a table once `50 + 10 %` of its rows changed, so a parent table written fewer
 * than 50 times never gets statistics, and a tenant check through it can walk a child's whole
 * history: 785 ms instead of 1 ms for a read of a run's children over 100k runs. Applied here rather
 * than in a migration, so a table a later migration creates gets it too. A table locked by another
 * session, an anti-wraparound vacuum for instance, is left to the next boot rather than holding up
 * startup.
 */
const lowerAnalyzeThresholds = async (db: DrizzleDB) => {
  await db.execute(sql`
    DO $$
    DECLARE t regclass;
    BEGIN
      SET LOCAL lock_timeout = '100ms';
      FOR t IN
        SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_has_role(c.relowner, 'USAGE')
          AND NOT EXISTS (SELECT FROM unnest(c.reloptions) o WHERE o LIKE 'autovacuum_analyze_threshold=%')
      LOOP
        BEGIN
          EXECUTE format('ALTER TABLE %s SET (autovacuum_analyze_threshold = 0)', t);
        EXCEPTION WHEN lock_not_available THEN
          RAISE WARNING 'autovacuum_analyze_threshold left unset on %, locked by another session', t;
        END;
      END LOOP;
    END $$
  `);
};
