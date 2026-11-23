import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { SupportedLocale } from '../users/validation';
import type { OpenctiThreatVisibility } from './threat-visibility';
import { defineSecurityPolicies, tenantMembershipPolicy, tenantUpdatePolicy, tenantUserRowsPolicy } from '../../security';
import { users } from '../users';
import { OPENCTI_THREAT_VISIBILITIES } from './threat-visibility';

const THREAT_VISIBILITY_LITERALS = sql.raw(OPENCTI_THREAT_VISIBILITIES.map((visibility) => `'${visibility}'`).join(', '));

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  /** Null is Automatic: each member's browser decides. */
  defaultLocale: text('default_locale').$type<SupportedLocale>(),
  threatVisibility: text('threat_visibility').notNull().default('per_member').$type<OpenctiThreatVisibility>(),
}, (table) => [
  check('tenants_threat_visibility_ck', sql`${table.threatVisibility} IN (${THREAT_VISIBILITY_LITERALS})`),
]);

defineSecurityPolicies(tenants, tenantMembershipPolicy, tenantUpdatePolicy);

export const tenantUsers = pgTable('tenant_users', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  title: text('title'),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.userId] }),
]);

defineSecurityPolicies(tenantUsers, tenantUserRowsPolicy);
