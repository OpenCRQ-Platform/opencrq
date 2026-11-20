import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const platformCapabilities = pgTable('platform_capabilities', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});
