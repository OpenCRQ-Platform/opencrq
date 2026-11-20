import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityPolicy } from '../../security/policies';
import { serviceAccounts } from '../service-accounts/schema';
import { tenants } from '../tenants';

export const serviceAccountTokens = pgTable('service_account_tokens', {
  id: uuid('id').primaryKey(),
  serviceAccountId: uuid('service_account_id').notNull().references(() => serviceAccounts.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** First 12 base62 chars of the token (after `SERVICE_ACCOUNT_TOKEN_PREFIX`). Stored in plaintext for O(1) lookup. */
  tokenId: text('token_id').notNull().unique(),
  /** SHA-256 hex digest of the full token string (`SERVICE_ACCOUNT_TOKEN_PREFIX` and 52 characters). */
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

defineSecurityPolicies(serviceAccountTokens, tenantIsolationPolicy, manageSecurityPolicy);
