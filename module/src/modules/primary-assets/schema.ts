import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { PrimaryAssetOnboardingTemplate, SecurityNeedLevel } from './constants';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { organizations } from '../organizations/schema';
import { tenants } from '../tenants';
import { users } from '../users';
import { PRIMARY_ASSET_ONBOARDING_TEMPLATES, SECURITY_NEED_LEVELS } from './constants';

const LEVEL_LITERALS = sql.raw(SECURITY_NEED_LEVELS.map((level) => `'${level}'`).join(', '));
const TEMPLATE_LITERALS = sql.raw(PRIMARY_ASSET_ONBOARDING_TEMPLATES.map((template) => `'${template}'`).join(', '));

export const primaryAssets = pgTable('primary_assets', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  description: text('description'),
  ownerId: uuid('owner_id').references(() => users.id),
  reference: text('reference'),
  businessFunction: text('business_function'),
  availability: text('availability').$type<SecurityNeedLevel>(),
  integrity: text('integrity').$type<SecurityNeedLevel>(),
  confidentiality: text('confidentiality').$type<SecurityNeedLevel>(),
  traceability: text('traceability').$type<SecurityNeedLevel>(),
  rtoMinutes: integer('rto_minutes'),
  rpoMinutes: integer('rpo_minutes'),
  mtpdMinutes: integer('mtpd_minutes'),
  onboardingTemplate: text('onboarding_template').$type<PrimaryAssetOnboardingTemplate>(),
}, (table) => [
  // What a composite foreign key naming the tenant can point at: the links to this asset carry it.
  unique('primary_assets_id_tenant_id_uq').on(table.id, table.tenantId),
  foreignKey({
    name: 'primary_assets_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }),
  index('primary_assets_organization_tenant_idx').on(table.organizationId, table.tenantId),
  uniqueIndex('primary_assets_organization_reference_uq').on(table.organizationId, table.reference).where(sql`${table.reference} IS NOT NULL`),
  uniqueIndex('primary_assets_organization_onboarding_template_uq').on(table.organizationId, table.onboardingTemplate)
    .where(sql`${table.onboardingTemplate} IS NOT NULL`),
  check('primary_assets_availability_ck', sql`${table.availability} IN (${LEVEL_LITERALS})`),
  check('primary_assets_integrity_ck', sql`${table.integrity} IN (${LEVEL_LITERALS})`),
  check('primary_assets_confidentiality_ck', sql`${table.confidentiality} IN (${LEVEL_LITERALS})`),
  check('primary_assets_traceability_ck', sql`${table.traceability} IN (${LEVEL_LITERALS})`),
  check('primary_assets_onboarding_template_ck', sql`${table.onboardingTemplate} IN (${TEMPLATE_LITERALS})`),
  check('primary_assets_durations_ck', sql`${table.rtoMinutes} >= 0 AND ${table.rpoMinutes} >= 0 AND ${table.mtpdMinutes} >= 0`),
]);

defineSecurityPolicies(primaryAssets, tenantIsolationPolicy);
