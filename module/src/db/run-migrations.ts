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
  await reserveRoomForInPlaceUpdates(db);
};

/**
 * The tables the syncs and the score recompute rewrite far more often than they insert into. An
 * update stays on its page with no new index entry (HOT) only when the page has room, and a sync
 * rewrites a page's rows in one transaction, before any old version can be reclaimed: on a replay of
 * the syncs, 70 kept nearly all of them in place, where 90 still sent most to other pages.
 */
const IN_PLACE_UPDATE_TABLES = ['asset_evidence', 'asset_evidence_sources', 'cve', 'cve_source_observations', 'finding_scores', 'unique_finding_scores'];
export const IN_PLACE_UPDATE_FILLFACTOR = 70;

/**
 * A storage parameter applies to the pages written after it, so the rows already stored move into
 * the room as they are rewritten. Applied here rather than in a migration because the squash
 * rebuilds the schema from `drizzle-kit`, which does not model it. A table that left the list loses
 * the figure, so a migrated database keeps the storage a fresh one gets; any other figure is an
 * operator's and is kept. The lock it takes conflicts with vacuum only, never with a read or a
 * write, and a wait past `deadlock_timeout` cancels an autovacuum holding it.
 */
const reserveRoomForInPlaceUpdates = async (db: DrizzleDB) => {
  // A DO block takes no bound parameter: the names and the figure are this file's constants.
  const tables = sql.raw(IN_PLACE_UPDATE_TABLES.map((name) => `'${name}'`).join(', '));
  const fillfactor = sql.raw(String(IN_PLACE_UPDATE_FILLFACTOR));
  await db.execute(sql`
    DO $$
    DECLARE t regclass; listed boolean;
    BEGIN
      SET LOCAL lock_timeout = '2s';
      FOR t, listed IN
        SELECT c.oid::regclass, c.relname IN (${tables}) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_has_role(c.relowner, 'USAGE')
          AND (c.relname IN (${tables})) <> coalesce(c.reloptions, '{}') @> ARRAY['fillfactor=${fillfactor}']
      LOOP
        BEGIN
          IF listed THEN
            EXECUTE format('ALTER TABLE %s SET (fillfactor = ${fillfactor})', t);
          ELSE
            EXECUTE format('ALTER TABLE %s RESET (fillfactor)', t);
          END IF;
        EXCEPTION WHEN lock_not_available THEN
          RAISE WARNING 'fillfactor left unchanged on %, locked by another session', t;
        END;
      END LOOP;
    END $$
  `);
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
