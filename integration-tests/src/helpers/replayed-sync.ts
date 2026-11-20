import pg from 'pg';
import { expect } from 'vitest';
import { getWorkerDbName, pgConfig } from '../setup/pg-config';

const SETTLE_MS = 400;

interface DataChangedEvent {
  table: string,
  op: string,
}

const isDataChangedEvent = (value: unknown): value is DataChangedEvent =>
  typeof value === 'object' && value !== null
  && 'table' in value && typeof value.table === 'string'
  && 'op' in value && typeof value.op === 'string';

const listenForDataChanges = async (client: pg.Client): Promise<Array<DataChangedEvent>> => {
  const events: Array<DataChangedEvent> = [];
  client.on('notification', (message) => {
    if (!message.payload) {
      return;
    }
    const parsed: unknown = JSON.parse(message.payload);
    if (isDataChangedEvent(parsed)) {
      events.push(parsed);
    }
  });
  await client.query('LISTEN data_changed');
  return events;
};

/** Every doorbell the run rings, one entry per row written. */
export const recordDataChanges = async (run: () => Promise<unknown>): Promise<Array<DataChangedEvent>> => {
  const client = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
  await client.connect();
  try {
    const events = await listenForDataChanges(client);
    await run();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    return events;
  } finally {
    await client.end();
  }
};

/**
 * Replays a sync that already ran once over the same source data, and expects it to ring no
 * doorbell and move no `updated_at`. `bookkeepingTables` are the tables the sync keeps one row per
 * run or per stream in, which no doorbell reader computes on. The first pass is the caller's, made
 * before this call.
 */
export const expectReplayedSyncSilent = async (
  replay: () => Promise<unknown>,
  options: { bookkeepingTables?: ReadonlyArray<string> } = {},
): Promise<void> => {
  const bookkeeping = new Set(options.bookkeepingTables ?? []);
  const client = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
  await client.connect();
  try {
    const events = await listenForDataChanges(client);

    const { rows: [mark] } = await client.query<{ at: string }>('select clock_timestamp()::text as at');
    await replay();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const rang = [...new Set(events.filter((event) => !bookkeeping.has(event.table)).map((event) => `${event.table} (${event.op})`))];
    expect(rang, 'tables that rang on a replayed sync').toEqual([]);

    const { rows: tables } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'updated_at'
       order by table_name`,
    );
    const moved: Array<string> = [];
    for (const { table_name: table } of tables) {
      if (bookkeeping.has(table)) {
        continue;
      }
      const { rows } = await client.query<{ moved: number }>(
        `select count(*)::int as moved from "${table}" where updated_at > $1::timestamptz`,
        [mark.at],
      );
      if (rows[0].moved > 0) {
        moved.push(`${table} (${rows[0].moved} rows)`);
      }
    }
    expect(moved, 'tables whose updated_at moved on a replayed sync').toEqual([]);
  } finally {
    await client.end();
  }
};
