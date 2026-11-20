import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  AssessmentAxis,
  AssessmentEventType,
  AssessmentMode,
  CapabilityFunction,
  ControlDomain,
  CoverageBasis,
  CoverageBucket,
  CrosswalkFramework,
  StrengthRung,
  TechniqueOverrideKind,
} from './constants';
import type { AssetCategory } from '../../supporting-assets/constants';
import { defineSecurityPolicies, organizationTenantIsolationPolicy, tenantIsolationPolicy } from '../../../security';
import { mitreTechniques } from '../../mitre-attack/schema';
import { organizations } from '../../organizations/schema';
import { tenants } from '../../tenants/schema';
import { users } from '../../users/schema';

export const CONTROL_CAPABILITY_SCOPE_OVERRIDE_UNIQUE = 'control_capability_scope_overrides_scope_capability_uniq';

// ─── Platform reference tables (no RLS — all tenants read, no tenant writes) ────

export const controlCapabilities = pgTable('control_capabilities', {
  id: uuid('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  domain: text('domain').notNull().$type<ControlDomain>(),
  // The catalogue's order, which the controls list keeps within a domain.
  position: integer('position').notNull(),
});

export const controlCapabilityStrengthRungLabels = pgTable('control_capability_strength_rung_labels', {
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  rung: text('rung').notNull().$type<StrengthRung>(),
  // Explanatory CISO-readable rung label, <= 600 chars.
  label: text('label').notNull(),
}, (table) => [
  primaryKey({ columns: [table.capabilityId, table.rung] }),
]);

export const controlCapabilityEdges = pgTable('control_capability_edges', {
  id: uuid('id').primaryKey(),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  // Traceability: the raw ATT&CK external id (e.g. T1078.004) the edge was authored against.
  techniqueExternalId: text('technique_external_id').notNull(),
  function: text('function').notNull().$type<CapabilityFunction>(),
}, (table) => [
  unique('control_capability_edges_capability_technique_function_uniq').on(table.capabilityId, table.mitreTechniqueId, table.function),
  index('control_capability_edges_technique_idx').on(table.mitreTechniqueId),
]);

// The security-tooling families a control is implemented by. `platformTypeKey` mirrors
// OpenAEV's SECURITY_PLATFORM_TYPE enum literal and is the join key ingestion will use.
export const securityPlatformFamilies = pgTable('security_platform_families', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  platformTypeKey: text('platform_type_key').notNull().unique(),
});

export const securityPlatformFamilyControls = pgTable('security_platform_family_controls', {
  familyId: uuid('family_id').notNull().references(() => securityPlatformFamilies.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ name: 'security_platform_family_controls_pk', columns: [table.familyId, table.capabilityId] }),
]);

export const controlCapabilityCrosswalk = pgTable('control_capability_crosswalk', {
  id: uuid('id').primaryKey(),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  framework: text('framework').notNull().$type<CrosswalkFramework>(),
  externalId: text('external_id').notNull(),
}, (table) => [
  unique('control_capability_crosswalk_uniq').on(table.capabilityId, table.framework, table.externalId),
]);

/**
 * The asset families each control protects: those the defense catalogue's block and detect links aim it
 * at, which can reach past where it runs, as the identity platform's reach covers SaaS tenants.
 * Seeded from the vendored table, read by every family-scoped credit the product
 * gives. A tenant that one day disagrees with a pair overrides it the way it overrides a technique
 * recommendation, through its own table, rather than through a per-tenant copy of this one.
 */
export const controlCapabilityProtectedFamilies = pgTable('control_capability_protected_families', {
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().$type<AssetCategory>(),
}, (table) => [
  primaryKey({ name: 'control_capability_protected_families_pk', columns: [table.capabilityId, table.categoryId] }),
  // The key leads on the capability, and the finding score reads the table the other way round.
  index('control_capability_protected_families_family_idx').on(table.categoryId),
]);

// ─── Tenant tables (RLS via tenantIsolationPolicy) ─────────────────────────────

export const controlCapabilityAssessments = pgTable('control_capability_assessments', {
  id: uuid('id').primaryKey(),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  strengthRung: text('strength_rung').notNull().default('L0').$type<StrengthRung>(),
  coverageBucket: text('coverage_bucket').notNull().default('L0').$type<CoverageBucket>(),
  // Per axis, `auto` hands the value to the derivation and `manual` keeps it until the user re-attaches it.
  strengthMode: text('strength_mode').notNull().default('manual').$type<AssessmentMode>(),
  coverageMode: text('coverage_mode').notNull().default('manual').$type<AssessmentMode>(),
  coverageBasis: text('coverage_basis').notNull().default('declared').$type<CoverageBasis>(),
  comment: text('comment'),
}, (table) => [
  unique('control_capability_assessments_capability_tenant_uniq').on(table.capabilityId, table.tenantId),
  unique('control_capability_assessments_id_tenant_uniq').on(table.id, table.tenantId),
]);

defineSecurityPolicies(controlCapabilityAssessments, tenantIsolationPolicy);

/**
 * What fed each derived axis of an assessment: `drata`, or the key of a framework whose published
 * answers reached the control. The provenance line names them, since one event's writer cannot.
 */
export const controlCapabilityAssessmentSources = pgTable('control_capability_assessment_sources', {
  assessmentId: uuid('assessment_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  axis: text('axis').notNull().$type<AssessmentAxis>(),
  source: text('source').notNull(),
}, (table) => [
  primaryKey({ name: 'control_capability_assessment_sources_pk', columns: [table.assessmentId, table.axis, table.source] }),
  // Composite so a source row can never sit in another tenant than its assessment.
  foreignKey({
    name: 'control_capability_assessment_sources_assessment_fk',
    columns: [table.assessmentId, table.tenantId],
    foreignColumns: [controlCapabilityAssessments.id, controlCapabilityAssessments.tenantId],
  }).onDelete('cascade'),
]);

defineSecurityPolicies(controlCapabilityAssessmentSources, tenantIsolationPolicy);

// Tenant overlay on the catalogue's technique recommendations, one row per
// (tenant, control, technique, function): an override always names the behaviour it overrides,
// so removing a technique from prevention leaves detection untouched.
export const controlCapabilityTechniqueOverrides = pgTable('control_capability_technique_overrides', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().$type<TechniqueOverrideKind>(),
  function: text('function').notNull().$type<CapabilityFunction>(),
}, (table) => [
  unique('control_capability_technique_overrides_uniq')
    .on(table.tenantId, table.capabilityId, table.mitreTechniqueId, table.function),
]);

defineSecurityPolicies(controlCapabilityTechniqueOverrides, tenantIsolationPolicy);

/**
 * A risk scope's own declaration over the tenant's. A null dimension follows the tenant, so a row
 * declaring none says nothing: clearing the last declared one deletes the row.
 *
 * No `tenant_id`: the scope carries it, and a second copy is one more thing nothing keeps equal.
 */
export const controlCapabilityScopeOverrides = pgTable('control_capability_scope_overrides', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  strengthRung: text('strength_rung').$type<StrengthRung>(),
  coverageBucket: text('coverage_bucket').$type<CoverageBucket>(),
  comment: text('comment'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique(CONTROL_CAPABILITY_SCOPE_OVERRIDE_UNIQUE).on(table.organizationId, table.capabilityId),
  index('control_capability_scope_overrides_capability_idx').on(table.capabilityId),
]);

defineSecurityPolicies(controlCapabilityScopeOverrides, organizationTenantIsolationPolicy);

export const controlCapabilityAssessmentEvents = pgTable('control_capability_assessment_events', {
  id: uuid('id').primaryKey(),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Which level the line speaks for; null is the tenant declaration.
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  // Names the connector that wrote the event; null means a user did, whatever userId now holds.
  connector: text('connector'),
  type: text('type').notNull().$type<AssessmentEventType>(),
  oldStrength: text('old_strength').$type<StrengthRung>(),
  newStrength: text('new_strength').$type<StrengthRung>(),
  oldCoverage: text('old_coverage').$type<CoverageBucket>(),
  newCoverage: text('new_coverage').$type<CoverageBucket>(),
  // The mode the event switched that axis to; null when it left the axis's mode alone.
  strengthMode: text('strength_mode').$type<AssessmentMode>(),
  coverageMode: text('coverage_mode').$type<AssessmentMode>(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('control_capability_assessment_events_cap_tenant_date_idx').on(table.capabilityId, table.tenantId, table.createdAt),
  index('control_capability_assessment_events_organization_idx').on(table.organizationId),
  unique('control_capability_assessment_events_id_tenant_uniq').on(table.id, table.tenantId),
]);

defineSecurityPolicies(controlCapabilityAssessmentEvents, tenantIsolationPolicy);

/**
 * The assessment's name is copied because a reopened assessment can be renamed. Its id has no
 * foreign key: the compliance assessments schema already imports this one.
 */
export const controlCapabilityAssessmentEventSources = pgTable('control_capability_assessment_event_sources', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  axis: text('axis').notNull().$type<AssessmentAxis>(),
  // `drata` or a framework key.
  source: text('source').notNull(),
  complianceAssessmentId: uuid('compliance_assessment_id'),
  complianceAssessmentName: text('compliance_assessment_name'),
  complianceAssessmentNameFolded: text('compliance_assessment_name_folded').generatedAlwaysAs(sql`fold_text(compliance_assessment_name)`),
}, (table) => [
  foreignKey({
    name: 'control_capability_assessment_event_sources_event_fk',
    columns: [table.eventId, table.tenantId],
    foreignColumns: [controlCapabilityAssessmentEvents.id, controlCapabilityAssessmentEvents.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'control_capability_assessment_event_sources_tenant_fk',
    columns: [table.tenantId],
    foreignColumns: [tenants.id],
  }).onDelete('cascade'),
  check(
    'control_capability_assessment_event_sources_assessment_ck',
    sql`(${table.complianceAssessmentId} IS NULL) = (${table.complianceAssessmentName} IS NULL)`,
  ),
  index('control_capability_assessment_event_sources_event_idx').on(table.eventId),
]);

defineSecurityPolicies(controlCapabilityAssessmentEventSources, tenantIsolationPolicy);
