import { newError } from '@app/utils';
import { getTableColumns, is, SQL, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * The dates a sync moves without the data changing. The doorbell ignores them too, on a table whose
 * trigger names them in its arguments; an integration test holds every trigger to this list.
 */
export const SYNC_DATE_COLUMNS: ReadonlyArray<string> = ['last_reported_at', 'last_seen_at', 'last_ingested_at'];

const UPDATED_AT_KEY = 'updatedAt';

const comparedColumns = (table: PgTable, set: Record<string, unknown>, ignored: ReadonlyArray<string>) => {
  const columns: Record<string, PgColumn> = getTableColumns(table);
  return Object.keys(set)
    .filter((key) => key !== UPDATED_AT_KEY)
    .map((key) => {
      const column = columns[key];
      if (!column) {
        throw newError('A write guard names a column the table does not have', { key });
      }
      return { key, column };
    })
    .filter(({ column }) => !ignored.includes(column.name));
};

const distinctFrom = (table: PgTable, set: Record<string, unknown>, ignored: ReadonlyArray<string>): SQL => {
  const compared = comparedColumns(table, set, ignored);
  if (compared.length === 0) {
    return sql`false`;
  }
  const values = compared.map(({ key, column }) => {
    const value = set[key];
    return is(value, SQL) ? value : sql.param(value, column);
  });
  return sql`(${sql.join(compared.map(({ column }) => column), sql`, `)}) is distinct from (${sql.join(values, sql`, `)})`;
};

/**
 * `setWhere` of an upsert: true when a column of the `set`, `updatedAt` excepted, would take
 * another value than the stored one. Keys are the Drizzle column keys; a value is a `SQL` fragment
 * (`excluded.x`, a `CASE`) or a plain value, bound through the column's encoder. `false` when no
 * column is left.
 */
export const valuesChange = (table: PgTable, set: Record<string, unknown>): SQL => distinctFrom(table, set, []);

/** `valuesChange` without the `SYNC_DATE_COLUMNS`: the data changes, not only a sync date. */
export const dataChanges = (table: PgTable, set: Record<string, unknown>): SQL => distinctFrom(table, set, SYNC_DATE_COLUMNS);

/**
 * The `updatedAt` of an upsert's `set`: `now()`, or `at` when given, when `dataChanges` holds, the
 * stored value otherwise. `at` is for a table whose `updated_at` is read back as a JS `Date` and
 * compared for equality, which the database's microsecond `now()` never matches. Throws on a table
 * without an `updatedAt` column.
 */
export const updatedAtOnDataChange = (table: PgTable, set: Record<string, unknown>, at?: Date): SQL => {
  const columns: Record<string, PgColumn> = getTableColumns(table);
  const updatedAt = columns[UPDATED_AT_KEY];
  if (!updatedAt) {
    throw newError('A write guard needs an updatedAt column the table does not have');
  }
  const moved = at === undefined ? sql`now()` : sql.param(at, updatedAt);
  return sql`case when ${dataChanges(table, set)} then ${moved} else ${updatedAt} end`;
};
