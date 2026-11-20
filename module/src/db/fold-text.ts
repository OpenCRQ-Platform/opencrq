import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { escapeLikePattern } from './like-pattern';

/**
 * A stored generated column holding `fold_text(<column>)`, named `<column>_folded`. `fold_text`
 * wraps the STABLE `unaccent`, so Postgres cannot inline it: evaluated at query time it costs a call
 * per row, which the stored column pays once at write time instead. `fold_text`, defined in the
 * baseline migration, passes `unaccent` its dictionary by name, which frees it from `search_path`
 * and makes it truly IMMUTABLE, as a generated column requires.
 */
export type FoldedColumn = PgColumn & { readonly _: { readonly name: `${string}_folded` } };

/** The pattern goes through `fold_text` in SQL too, so both sides share the same `unaccent` rules. */
export const foldedLike = (folded: FoldedColumn, search: string, mode: 'prefix' | 'contains'): SQL => {
  const escaped = escapeLikePattern(search);
  const pattern = mode === 'prefix' ? `${escaped}%` : `%${escaped}%`;
  return sql`${folded} like fold_text(${pattern})`;
};

/**
 * Orders by the folded value, then by the raw one in byte order so variants of a name stay in a
 * stable order. Nulls are placed as `orderNullsLast` places them, on the raw column's nullability.
 */
export const orderByFolded = (folded: FoldedColumn, raw: PgColumn, descending: boolean): [SQL, SQL] => {
  const direction = descending ? sql`desc` : sql`asc`;
  const nulls = raw.notNull ? sql`` : sql` nulls last`;
  return [
    sql`${folded} ${direction}${nulls}`,
    sql`${raw} collate "C" ${direction}${nulls}`,
  ];
};
