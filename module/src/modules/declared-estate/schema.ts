import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { DeclaredEstateKind } from './constants';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { organizations } from '../organizations/schema';
import { tenants } from '../tenants';
import { users } from '../users/schema';

/**
 * A risk scope's answer for one kind of asset. A kind with no row is unanswered, which the engine
 * reads as nothing declared, never as zero.
 */
export const declaredEstate = pgTable('declared_estate', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  kind: text('kind').notNull().$type<DeclaredEstateKind>(),
  low: integer('low').notNull(),
  high: integer('high').notNull(),
  internetFacing: boolean('internet_facing'),
  setByUserId: uuid('set_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'declared_estate_pk', columns: [table.organizationId, table.kind] }),
  foreignKey({
    name: 'declared_estate_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  check('declared_estate_bounds_ck', sql`0 <= ${table.low} AND ${table.low} <= ${table.high}`),
]);

defineSecurityPolicies(declaredEstate, tenantIsolationPolicy);

/** One kind changed by one save, its answer before and after; null bounds mean no answer. */
export const declaredEstateEvents = pgTable('declared_estate_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  kind: text('kind').notNull().$type<DeclaredEstateKind>(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  oldLow: integer('old_low'),
  oldHigh: integer('old_high'),
  oldInternetFacing: boolean('old_internet_facing'),
  newLow: integer('new_low'),
  newHigh: integer('new_high'),
  newInternetFacing: boolean('new_internet_facing'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: 'declared_estate_events_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('declared_estate_events_organization_date_idx').on(table.organizationId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
]);

defineSecurityPolicies(declaredEstateEvents, tenantIsolationPolicy);
