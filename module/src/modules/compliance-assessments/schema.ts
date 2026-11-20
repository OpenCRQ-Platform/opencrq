import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { ComplianceAssessmentStatus, ControlLinkAxis, FrameworkNodeKind } from './constants';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { controlCapabilities } from '../controls/capability/schema';
import { serviceAccounts } from '../service-accounts/schema';
import { tenants } from '../tenants';
import { users } from '../users';

export const complianceFrameworks = pgTable('compliance_frameworks', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  title: text('title').notNull(),
  titleFolded: text('title_folded').generatedAlwaysAs(sql`fold_text(title)`),
  version: text('version').notNull(),
  oscalCatalogUuid: uuid('oscal_catalog_uuid').notNull(),
});

/** A node the catalog later drops is kept, so the answers given on it stay readable. */
export const complianceFrameworkNodes = pgTable('compliance_framework_nodes', {
  id: uuid('id').primaryKey(),
  frameworkId: uuid('framework_id').notNull().references(() => complianceFrameworks.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => complianceFrameworkNodes.id, { onDelete: 'cascade' }),
  oscalId: text('oscal_id').notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  statement: text('statement'),
  kind: text('kind').notNull().$type<FrameworkNodeKind>(),
  /** The node an answer is given on: a control with no active child. */
  isRequirement: boolean('is_requirement').notNull(),
  position: integer('position').notNull(),
}, (table) => [
  unique('compliance_framework_nodes_framework_oscal_id_uq').on(table.frameworkId, table.oscalId),
]);

/** The OpenCRQ controls an answer on a requirement feeds, seeded from the vendored OSCAL mappings. */
export const complianceRequirementControls = pgTable('compliance_requirement_controls', {
  requirementId: uuid('requirement_id').notNull().references(() => complianceFrameworkNodes.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  axis: text('axis').notNull().$type<ControlLinkAxis>(),
}, (table) => [
  primaryKey({ name: 'compliance_requirement_controls_pk', columns: [table.requirementId, table.capabilityId] }),
]);

/** Nothing is unique on (tenant, framework): successive assessments of one framework coexist. */
export const complianceAssessments = pgTable('compliance_assessments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  frameworkId: uuid('framework_id').notNull().references(() => complianceFrameworks.id),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft').$type<ComplianceAssessmentStatus>(),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdByServiceAccountId: uuid('created_by_service_account_id').references(() => serviceAccounts.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedById: uuid('published_by_id').references(() => users.id, { onDelete: 'set null' }),
  publishedByServiceAccountId: uuid('published_by_service_account_id').references(() => serviceAccounts.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('compliance_assessments_id_tenant_id_uq').on(table.id, table.tenantId),
]);

defineSecurityPolicies(complianceAssessments, tenantIsolationPolicy);

/**
 * The answer to one requirement. A row may carry an owner, a due date or a comment and no answer
 * yet: it counts as answered only once it holds a level or is marked not applicable.
 */
export const complianceAssessmentAnswers = pgTable('compliance_assessment_answers', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull(),
  requirementId: uuid('requirement_id').notNull().references(() => complianceFrameworkNodes.id),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  dueDate: date('due_date', { mode: 'string' }),
  level: integer('level'),
  notApplicable: boolean('not_applicable').notNull().default(false),
  comment: text('comment'),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Composite so an answer can never sit in another tenant than its assessment.
  foreignKey({
    name: 'compliance_assessment_answers_assessment_fk',
    columns: [table.assessmentId, table.tenantId],
    foreignColumns: [complianceAssessments.id, complianceAssessments.tenantId],
  }).onDelete('cascade'),
  unique('compliance_assessment_answers_assessment_requirement_uq').on(table.assessmentId, table.requirementId),
  check('compliance_assessment_answers_level_range_ck', sql`${table.level} BETWEEN 0 AND 5`),
  check('compliance_assessment_answers_level_or_na_ck', sql`NOT (${table.notApplicable} AND ${table.level} IS NOT NULL)`),
]);

defineSecurityPolicies(complianceAssessmentAnswers, tenantIsolationPolicy);
