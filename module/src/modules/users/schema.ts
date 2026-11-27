import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantUsersPolicy } from '../../security';

/** The constraints a write catches by name, to tell which one a unique violation hit. */
export const USERS_EMAIL_UNIQUE = 'users_email_unique';
export const USERS_XTM_SUBJECT_UNIQUE = 'users_xtm_subject_unique';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  name: text('name'),
  title: text('title'),
  locale: text('locale'),
  theme: text('theme'),
  homeDashboardId: text('home_dashboard_id'),
  // The XTM One user (`sub`) this account signs in as. Null on a pending account, which the first
  // sign-in through XTM One with its email takes.
  xtmSubject: text('xtm_subject').unique(USERS_XTM_SUBJECT_UNIQUE),
  // XTM One's own platform administrator, as its last sign-in or renewal said (`xtm_super_admin`).
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  lastSignedInAt: timestamp('last_signed_in_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  // Whatever its case: a pending account is taken by the email alone, so two accounts must never
  // hold the same one.
  uniqueIndex(USERS_EMAIL_UNIQUE).on(sql`lower(${table.email})`),
]);

defineSecurityPolicies(users, tenantUsersPolicy);
