import { metrics } from '@opentelemetry/api';
import type { Pool } from 'pg';

const meter = metrics.getMeter('opencrq-db-engine');

export interface TableStatistics {
  table: string,
  heapBytes: number,
  indexesBytes: number,
  toastBytes: number,
  liveRows: number,
  deadRows: number,
  hotUpdates: number,
  updates: number,
  autovacuums: number,
  vacuums: number,
}

export interface DatabaseStatistics {
  databaseBytes: number,
  tables: Array<TableStatistics>,
}

// `heap` is the table with its free-space and visibility maps and `toast` its TOAST table with that
// table's index, so the three parts add up to `pg_total_relation_size`. The bigint columns are cast
// down: no counter or size of one table comes near 2^53.
const STATISTICS_QUERY = `
  SELECT s.relname AS table,
         (pg_table_size(s.relid) - COALESCE(pg_total_relation_size(NULLIF(c.reltoastrelid, 0)), 0))::float8 AS heap_bytes,
         pg_indexes_size(s.relid)::float8 AS indexes_bytes,
         COALESCE(pg_total_relation_size(NULLIF(c.reltoastrelid, 0)), 0)::float8 AS toast_bytes,
         s.n_live_tup::float8 AS live_rows,
         s.n_dead_tup::float8 AS dead_rows,
         s.n_tup_hot_upd::float8 AS hot_updates,
         s.n_tup_upd::float8 AS updates,
         s.autovacuum_count::float8 AS autovacuums,
         s.vacuum_count::float8 AS vacuums
    FROM pg_stat_user_tables s
    JOIN pg_class c ON c.oid = s.relid
   WHERE s.schemaname = current_schema()
   ORDER BY s.relname`;

interface StatisticsRow {
  table: string,
  heap_bytes: number,
  indexes_bytes: number,
  toast_bytes: number,
  live_rows: number,
  dead_rows: number,
  hot_updates: number,
  updates: number,
  autovacuums: number,
  vacuums: number,
}

// The size functions take an `AccessShareLock` on each table, so a migration or a `VACUUM FULL`
// holding one exclusively would otherwise park the reading, and its connection, until it commits.
const LOCK_TIMEOUT = '2s';
const STATEMENT_TIMEOUT = '30s';

export const readDatabaseStatistics = async (pool: Pool): Promise<DatabaseStatistics> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const { rows } = await client.query<StatisticsRow>(STATISTICS_QUERY);
    const { rows: [database] } = await client.query<{ bytes: number }>('SELECT pg_database_size(current_database())::float8 AS bytes');
    await client.query('COMMIT');
    return {
      databaseBytes: database.bytes,
      tables: rows.map((row) => ({
        table: row.table,
        heapBytes: row.heap_bytes,
        indexesBytes: row.indexes_bytes,
        toastBytes: row.toast_bytes,
        liveRows: row.live_rows,
        deadRows: row.dead_rows,
        hotUpdates: row.hot_updates,
        updates: row.updates,
        autovacuums: row.autovacuums,
        vacuums: row.vacuums,
      })),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * The instruments report whatever `lastReading` returns at collection time and never query: a
 * scrape reads the statistics the timer last stored, and `null` reports no series at all. Counters
 * are observed as the cumulative values Postgres keeps, so a statistics reset reads as a counter
 * reset.
 */
export const registerDbTableMetrics = (lastReading: () => DatabaseStatistics | null): void => {
  const observeTables = (observe: (table: TableStatistics) => void): void => {
    lastReading()?.tables.forEach(observe);
  };

  meter.createObservableGauge('opencrq.db.table.size', {
    description: 'The disk space a table of the application schema uses, by part: the table itself, its indexes, and its TOAST table.',
    unit: 'By',
  }).addCallback((result) => observeTables((table) => {
    result.observe(table.heapBytes, { 'db.table': table.table, part: 'heap' });
    result.observe(table.indexesBytes, { 'db.table': table.table, part: 'indexes' });
    result.observe(table.toastBytes, { 'db.table': table.table, part: 'toast' });
  }));

  meter.createObservableGauge('opencrq.db.table.rows', {
    description: 'The estimated number of live and dead rows of a table of the application schema.',
    unit: '{row}',
  }).addCallback((result) => observeTables((table) => {
    result.observe(table.liveRows, { 'db.table': table.table, state: 'live' });
    result.observe(table.deadRows, { 'db.table': table.table, state: 'dead' });
  }));

  meter.createObservableCounter('opencrq.db.table.updates', {
    description: 'The rows of a table of the application schema updated since the statistics were last reset, by whether the update stayed in place (HOT).',
    unit: '{row}',
  }).addCallback((result) => observeTables((table) => {
    result.observe(table.hotUpdates, { 'db.table': table.table, in_place: 'true' });
    result.observe(table.updates - table.hotUpdates, { 'db.table': table.table, in_place: 'false' });
  }));

  meter.createObservableCounter('opencrq.db.table.vacuums', {
    description: 'The vacuums of a table of the application schema since the statistics were last reset, by whether autovacuum or a manual VACUUM ran them.',
    unit: '{vacuum}',
  }).addCallback((result) => observeTables((table) => {
    result.observe(table.autovacuums, { 'db.table': table.table, kind: 'auto' });
    result.observe(table.vacuums, { 'db.table': table.table, kind: 'manual' });
  }));

  meter.createObservableGauge('opencrq.db.size', {
    description: 'The disk space the database uses.',
    unit: 'By',
  }).addCallback((result) => {
    const reading = lastReading();
    if (reading) {
      result.observe(reading.databaseBytes);
    }
  });
};
