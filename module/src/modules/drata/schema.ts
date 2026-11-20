import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';

export const drataFrameworks = pgTable('drata_frameworks', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  drataId: integer('drata_id').notNull(),
  slug: text('slug').notNull(),
  tag: text('tag').notNull(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  description: text('description'),
  isReady: boolean('is_ready').notNull().default(false),
  numInScopeRequirements: integer('num_in_scope_requirements').notNull().default(0),
  numReadyInScopeRequirements: integer('num_ready_in_scope_requirements').notNull().default(0),
  numInScopeControls: integer('num_in_scope_controls').notNull().default(0),
  lastReportedAt: timestamp('last_reported_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('drata_frameworks_tenant_drata_id_idx').on(table.tenantId, table.drataId),
]);

export const drataRequirements = pgTable('drata_requirements', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  frameworkId: uuid('framework_id').notNull().references(() => drataFrameworks.id, { onDelete: 'cascade' }),
  drataId: integer('drata_id').notNull(),
  code: text('code'),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  isInScope: boolean('is_in_scope').notNull().default(true),
  isReady: boolean('is_ready').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('drata_requirements_framework_drata_id_idx').on(table.frameworkId, table.drataId),
]);

export const drataControls = pgTable('drata_controls', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  drataId: integer('drata_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isReady: boolean('is_ready').notNull().default(false),
  isMonitored: boolean('is_monitored').notNull().default(false),
  hasEvidence: boolean('has_evidence').notNull().default(false),
  hasPolicy: boolean('has_policy').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('drata_controls_tenant_drata_id_idx').on(table.tenantId, table.drataId),
]);

export const drataRequirementControls = pgTable('drata_requirement_controls', {
  requirementId: uuid('requirement_id').notNull().references(() => drataRequirements.id, { onDelete: 'cascade' }),
  controlId: uuid('control_id').notNull().references(() => drataControls.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.requirementId, table.controlId] }),
  index('drata_requirement_controls_control_idx').on(table.controlId),
]);

defineSecurityPolicies(drataFrameworks, tenantIsolationPolicy);
defineSecurityPolicies(drataRequirements, tenantIsolationPolicy);
defineSecurityPolicies(drataControls, tenantIsolationPolicy);
