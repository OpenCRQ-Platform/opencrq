import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** No security policy, deliberately: the registry has no tenant, and its reader returns a boolean, never rows. */
export const workers = pgTable('workers', {
  id: uuid('id').primaryKey(),
  processName: text('process_name').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  index('workers_heartbeat_at_idx').on(table.heartbeatAt),
]);
