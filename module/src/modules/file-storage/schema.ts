import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { serviceAccounts } from '../service-accounts/schema';
import { tenants } from '../tenants';
import { users } from '../users/schema';

export const storedFiles = pgTable('stored_files', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  storageKey: uuid('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdByServiceAccountId: uuid('created_by_service_account_id').references(() => serviceAccounts.id, { onDelete: 'set null' }),
});

defineSecurityPolicies(storedFiles, tenantIsolationPolicy);
