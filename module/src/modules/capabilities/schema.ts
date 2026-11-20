import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const capabilities = pgTable('capabilities', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});
