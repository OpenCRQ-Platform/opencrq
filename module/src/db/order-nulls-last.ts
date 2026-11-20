import { asc, desc, is, SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Orders with a missing value last in both directions. A NOT NULL column has none to place, so it
 * sorts in the Postgres default nulls order, which one `NULLS FIRST` index serves both ways: spelling
 * `nulls last` there changes no row and loses the index on one direction. An expression, or a NOT NULL
 * column an outer join can leave empty, passed wrapped in `sql`, gets `nulls last` spelled out.
 */
export const orderNullsLast = (column: PgColumn | SQL, descending: boolean): SQL => {
  if (!is(column, SQL) && column.notNull) {
    return descending ? desc(column) : asc(column);
  }
  return descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
};
