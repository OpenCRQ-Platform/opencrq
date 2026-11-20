import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, userOwnershipPolicy } from '../../security';
import { users } from '../users';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  // eslint-disable-next-line no-restricted-syntax -- notification data payload is opaque and event-type-specific; shape is not known at schema definition time
  data: jsonb('data'),
  status: text('status').notNull().default('active'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

defineSecurityPolicies(notifications, userOwnershipPolicy);
