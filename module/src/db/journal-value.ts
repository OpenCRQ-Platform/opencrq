import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';

export const journalValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.number().nullable())]).nullable();

export type JournalValue = z.infer<typeof journalValueSchema>;

/** A journal stores an answer of any type as its JSON text, so one text column reads back typed. */
export const encodeJournalValue = (value: JournalValue): string | null => (value === null ? null : JSON.stringify(value));

export const decodeJournalValue = (text: string | null): JournalValue => (text === null ? null : journalValueSchema.parse(JSON.parse(text)));

/** The insert's own time, taken once the scope is locked: `now()` would date a save that waited for the lock before the one it waited for. */
export const journalCreatedAt = () => timestamp('created_at', { withTimezone: true }).notNull().default(sql`statement_timestamp()`);
