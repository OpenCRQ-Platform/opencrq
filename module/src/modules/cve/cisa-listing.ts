import type { AnyColumn } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * Listed means CISA dated it: connectors also set `kev` for "an exploit is available", which is
 * not the catalogue's claim, so the flag is never read for this signal.
 */
export const isCisaListed = (row: { kevUpdatedAt: Date | null }): boolean => row.kevUpdatedAt !== null;

export const cisaListedSql = (table: { kevUpdatedAt: AnyColumn }) => sql<boolean>`(${table.kevUpdatedAt} is not null)`;
