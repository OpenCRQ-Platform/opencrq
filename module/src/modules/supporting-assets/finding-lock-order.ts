import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ASSET_EVIDENCE_KEY } from './schema';

type FindingKeyColumn = typeof ASSET_EVIDENCE_KEY[number]['column'];

/**
 * The one order findings are locked in, by a sync's upsert (its batch sorted with
 * `compareFindingKeys`) and by the retirement pass (`findingLockOrder`): two writers locking
 * overlapping findings in different orders can each hold a row the other waits for, and Postgres
 * then aborts one of them. Ordered on the columns of `asset_evidence_uq`, which a new finding is
 * also queued on, by their bytes with nulls last: a uuid's, which sort as its lowercase hex does,
 * and a text's UTF-8 ones, which Postgres compares under collation `C`. A text is not compared with
 * JavaScript's `<`, which reads UTF-16 code units and puts a character past U+FFFF before one in
 * U+E000–U+FFFF.
 */
export const compareFindingKeys = (
  a: { [column in FindingKeyColumn]?: string | null },
  b: { [column in FindingKeyColumn]?: string | null },
): number => {
  for (const { column, type } of ASSET_EVIDENCE_KEY) {
    const [left, right] = [a[column] ?? null, b[column] ?? null];
    if (left === right) {
      continue;
    }
    if (left === null || right === null) {
      return left === null ? 1 : -1;
    }
    if (type === 'uuid') {
      return left < right ? -1 : 1;
    }
    return Buffer.compare(Buffer.from(left), Buffer.from(right));
  }
  return 0;
};

/** The `ORDER BY` of `compareFindingKeys`, for a statement locking findings. */
export const findingLockOrder = (table: { [column in FindingKeyColumn]: PgColumn }): Array<SQL> =>
  ASSET_EVIDENCE_KEY.map(({ column, type }) => (type === 'uuid'
    ? sql`${table[column]} nulls last`
    : sql`${table[column]} collate "C" nulls last`));
