import type { SQLWrapper } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * Membership in an id list bound as one array parameter rather than one per id, as `inArray` does:
 * a list that grows with the estate would otherwise cross Postgres' 65,535 bind-parameter limit and
 * fail on the wire.
 *
 * `= any` over `in (select unnest(...))`: the planner has a selectivity estimator for the first and
 * falls back to a fixed guess for the second.
 */
export const inUuids = (column: SQLWrapper, ids: ReadonlyArray<string>) =>
  sql`${column} = any(${sql.param(ids)}::uuid[])`;

export const notInUuids = (column: SQLWrapper, ids: ReadonlyArray<string>) =>
  sql`${column} <> all(${sql.param(ids)}::uuid[])`;
