import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../schema';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});
