import { metrics } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseStatistics, TableStatistics } from './db-table-metrics';
import { createSnapshotReader } from '../../utils/metrics-snapshot';

// Bound before the first import of the module under test: its meter is taken at module load.
const { reader, collect } = createSnapshotReader();
// An empty resource, so no identity label is promoted onto the samples asserted below.
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader], resource: resourceFromAttributes({}) }));
const { readDatabaseStatistics, registerDbTableMetrics } = await import('./db-table-metrics');

const tableStatistics = (table: string, overrides: Partial<TableStatistics> = {}): TableStatistics => ({
  table,
  heapBytes: 8192,
  indexesBytes: 16384,
  toastBytes: 0,
  liveRows: 10,
  deadRows: 2,
  hotUpdates: 30,
  updates: 40,
  autovacuums: 3,
  vacuums: 1,
  ...overrides,
});

let current: DatabaseStatistics | null = null;
registerDbTableMetrics(() => current);

const sampleLines = (document: string): Array<string> => document.split('\n').filter((line) => line !== '' && !line.startsWith('#'));

describe('registerDbTableMetrics', () => {
  it('reports no series before the first reading', async () => {
    current = null;

    expect(sampleLines(await collect())).toEqual([]);
  });

  it('reports every part, state and kind of every table from the last reading', async () => {
    current = { databaseBytes: 1_000_000, tables: [tableStatistics('assets'), tableStatistics('findings', { toastBytes: 4096 })] };

    const document = await collect();

    expect(document).toContain('opencrq_db_table_size{db_table="findings",part="heap"} 8192');
    expect(document).toContain('opencrq_db_table_size{db_table="findings",part="indexes"} 16384');
    expect(document).toContain('opencrq_db_table_size{db_table="findings",part="toast"} 4096');
    expect(document).toContain('opencrq_db_table_rows{db_table="assets",state="live"} 10');
    expect(document).toContain('opencrq_db_table_rows{db_table="assets",state="dead"} 2');
    expect(document).toContain('opencrq_db_table_updates_total{db_table="assets",in_place="true"} 30');
    expect(document).toContain('opencrq_db_table_updates_total{db_table="assets",in_place="false"} 10');
    expect(document).toContain('opencrq_db_table_vacuums_total{db_table="assets",kind="auto"} 3');
    expect(document).toContain('opencrq_db_table_vacuums_total{db_table="assets",kind="manual"} 1');
    expect(document).toContain('opencrq_db_size 1000000');
    // Nine series per table, plus the database's own size.
    expect(sampleLines(document)).toHaveLength(19);
  });

  it('reports a statistics reset as a counter that starts again from the lower value, never a sum or a negative', async () => {
    current = { databaseBytes: 1, tables: [tableStatistics('scenarios', { hotUpdates: 500, updates: 900 })] };
    await collect();

    current = { databaseBytes: 1, tables: [tableStatistics('scenarios', { hotUpdates: 5, updates: 7 })] };
    const document = await collect();

    expect(document).toContain('opencrq_db_table_updates_total{db_table="scenarios",in_place="true"} 5');
    expect(document).toContain('opencrq_db_table_updates_total{db_table="scenarios",in_place="false"} 2');
  });

  // The SDK keeps every attribute set an asynchronous counter or gauge once observed, at its last
  // value, so a reading that fails or a table a migration drops leaves its series in place until the
  // process restarts.
  it('keeps serving the last value of a table a later reading no longer carries', async () => {
    current = { databaseBytes: 1, tables: [tableStatistics('dropped_table')] };
    await collect();

    current = { databaseBytes: 1, tables: [] };

    expect(await collect()).toContain('opencrq_db_table_rows{db_table="dropped_table",state="live"} 10');
  });
});

const row = {
  table: 'assets',
  heap_bytes: 8192,
  indexes_bytes: 16384,
  toast_bytes: 0,
  live_rows: 10,
  dead_rows: 2,
  hot_updates: 30,
  updates: 40,
  autovacuums: 3,
  vacuums: 1,
};

const fakePool = (query: (text: string) => Promise<{ rows: Array<unknown> }>) => {
  const client = { query: vi.fn(query), release: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fake, the subset of `pg.Pool` the reader calls
  return { client, pool: { connect: () => Promise.resolve(client) } as unknown as Pool };
};

describe('readDatabaseStatistics', () => {
  it('reads in one read-only transaction bounded by a lock and a statement timeout, and releases its client', async () => {
    const { client, pool } = fakePool((text) => Promise.resolve({
      rows: text.includes('pg_stat_user_tables') ? [row] : [{ bytes: 1_000_000 }],
    }));

    const statistics = await readDatabaseStatistics(pool);

    expect(statistics).toEqual({ databaseBytes: 1_000_000, tables: [tableStatistics('assets')] });
    const statements = client.query.mock.calls.map(([text]) => text);
    expect(statements[0]).toBe('BEGIN READ ONLY');
    expect(statements).toContain('SET LOCAL lock_timeout = \'2s\'');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases its client when a statement fails', async () => {
    const { client, pool } = fakePool((text) => (text.includes('pg_stat_user_tables')
      ? Promise.reject(new Error('canceling statement due to lock timeout'))
      : Promise.resolve({ rows: [] })));

    await expect(readDatabaseStatistics(pool)).rejects.toThrow('lock timeout');

    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
