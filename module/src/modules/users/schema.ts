import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantUsersPolicy } from '../../security';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name'),
  title: text('title'),
  locale: text('locale'),
  theme: text('theme'),
  // Opt-in pastel palette (the design system's `pastel` root class); standard colours by default.
  pastelColours: boolean('pastel_colours').notNull().default(false),
  homeDashboardId: text('home_dashboard_id'),
  // The XTM One user (`sub`) this account signs in as, set at the first sign-in through XTM One.
  xtmSubject: text('xtm_subject').unique(),
  // XTM One's own platform administrator, as its last sign-in or renewal said (`xtm_super_admin`).
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  lastSignedInAt: timestamp('last_signed_in_at', { withTimezone: true, mode: 'date' }),
  // A pending account's single-use `/join/<token>` link, as its SHA-256: the email alone never links an account.
  joinTokenHash: text('join_token_hash').unique(),
});

defineSecurityPolicies(users, tenantUsersPolicy);
