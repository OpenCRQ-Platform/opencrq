import { pgTable, text } from 'drizzle-orm/pg-core';

export const platformMetadata = pgTable('platform_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
