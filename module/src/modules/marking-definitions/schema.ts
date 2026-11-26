import { check, foreignKey, index, integer, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityWritePolicy } from '../../security/policies';
import { groups } from '../groups/schema';
import { tenants } from '../tenants';

/**
 * The marking definitions of a tenant (CTEM marking parity, G2): one row per marking, identified
 * across the products by its OpenCTI STIX `standard_id`, so a marking on an OpenCTI object, an
 * OpenAEV asset and an OpenCRQ object is the same marking. `order` ranks the markings of one type
 * as OpenCTI's `x_opencti_order` and OpenAEV's ordinal do; `null` is a marking nobody ranked, cleared
 * only when held directly. Every member reads them; a security manager writes them.
 */
export const markingDefinitions = pgTable('marking_definitions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stixId: text('stix_id').notNull(),
  definitionType: text('definition_type').notNull(),
  definition: text('definition').notNull(),
  color: text('color'),
  order: integer('order'),
}, (table) => [
  unique('marking_definitions_tenant_stix_id_uq').on(table.tenantId, table.stixId),
  unique('marking_definitions_id_tenant_id_uq').on(table.id, table.tenantId),
  check('marking_definitions_stix_id_ck', sql`${table.stixId} ~ '^marking-definition--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
]);

defineSecurityPolicies(markingDefinitions, tenantIsolationPolicy, manageSecurityWritePolicy);

/**
 * The clearance of a group: the markings its members may read. A member's clearance is the union
 * over their groups, as in OpenCTI and OpenAEV.
 */
export const groupMarkingDefinitions = pgTable('group_marking_definitions', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull(),
  markingDefinitionId: uuid('marking_definition_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.markingDefinitionId] }),
  foreignKey({
    name: 'group_marking_definitions_group_tenant_fk',
    columns: [table.groupId, table.tenantId],
    foreignColumns: [groups.id, groups.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'group_marking_definitions_marking_tenant_fk',
    columns: [table.markingDefinitionId, table.tenantId],
    foreignColumns: [markingDefinitions.id, markingDefinitions.tenantId],
  }).onDelete('cascade'),
  index('group_marking_definitions_marking_idx').on(table.markingDefinitionId),
]);

defineSecurityPolicies(groupMarkingDefinitions, tenantIsolationPolicy, manageSecurityWritePolicy);
