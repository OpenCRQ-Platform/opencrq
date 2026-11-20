import { SYNC_DATE_COLUMNS } from '@app/module';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../setup/db';

/** The arguments each doorbell function reads before the sync dates. */
const LEADING_ARGUMENTS: Record<string, number> = {
  notify_data_changed_tenant: 0,
  notify_data_changed_tenant_via_fk: 2,
};

interface DoorbellTrigger {
  table: string,
  fn: string,
  args: Array<string>,
  syncColumns: Array<string>,
}

const doorbellTriggers = async (): Promise<Array<DoorbellTrigger>> => {
  const result = await db.execute<{ table: string, fn: string, args: Buffer, sync_columns: Array<string> }>(sql`
    SELECT c.relname AS table, p.proname AS fn, t.tgargs AS args,
      array(
        SELECT a.attname::text FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attname = ANY(${`{${SYNC_DATE_COLUMNS.join(',')}}`}::text[])
        ORDER BY a.attname
      ) AS sync_columns
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND p.proname LIKE 'notify_data_changed%'
  `);
  return result.rows.map((row) => ({
    table: row.table,
    fn: row.fn,
    // `tgargs` holds each argument followed by a NUL byte.
    args: row.args.toString('utf8').split('\0').slice(0, -1),
    syncColumns: row.sync_columns,
  }));
};

describe('doorbell triggers and SYNC_DATE_COLUMNS', () => {
  it('should name, on every table, exactly the sync dates it carries', async () => {
    const triggers = await doorbellTriggers();

    const mismatches = triggers.flatMap(({ table, fn, args, syncColumns }) => {
      if (syncColumns.length === 0) {
        const leading = LEADING_ARGUMENTS[fn] ?? args.length;
        return args.length === leading ? [] : [{ table, fn, args, syncColumns }];
      }
      const leading = LEADING_ARGUMENTS[fn];
      const named = leading === undefined ? [] : args.slice(leading).toSorted();
      return leading !== undefined && named.join(',') === syncColumns.join(',') ? [] : [{ table, fn, args, syncColumns }];
    });

    expect(triggers.length).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });

  it('should mask every sync date in the functions that read them', async () => {
    const result = await db.execute<{ fn: string, definition: string }>(sql`
      SELECT p.proname AS fn, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY(${`{${Object.keys(LEADING_ARGUMENTS).join(',')}}`}::text[])
    `);

    expect(result.rows.map((row) => row.fn).toSorted()).toEqual(Object.keys(LEADING_ARGUMENTS).toSorted());
    for (const { fn, definition } of result.rows) {
      for (const column of SYNC_DATE_COLUMNS) {
        expect(definition, `${fn} masks ${column}`).toContain(`v_masked.${column} := OLD.${column}`);
      }
    }
  });
});
