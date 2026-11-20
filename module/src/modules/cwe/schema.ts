import { pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { CweLinkOverrideKind } from './constants';
import type { CweLinkJustificationKind } from './data/cwe-technique-link';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityWritePolicy } from '../../security/policies';
import { mitreTechniques } from '../mitre-attack/schema';
import { tenants } from '../tenants/schema';

export { CWE_LINK_ENTRY_STATES, CWE_LINK_JUSTIFICATION_KINDS, CWE_LINK_OVERRIDE_KINDS } from './constants';
export type { CweLinkEntryState, CweLinkOverrideKind } from './constants';

export const cweWeaknesses = pgTable('cwe_weaknesses', {
  id: uuid('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
});

/**
 * One reason the shipped link gives for a weakness making a technique possible, so a technique two
 * reasons reach has two rows. The boot seed only upserts: a row a new link version drops is
 * removed by the migration that ships that version.
 */
export const cweTechniqueLinks = pgTable('cwe_technique_links', {
  id: uuid('id').primaryKey(),
  cweId: uuid('cwe_id').notNull().references(() => cweWeaknesses.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  techniqueExternalId: text('technique_external_id').notNull(),
  justificationKind: text('justification_kind').notNull().$type<CweLinkJustificationKind>(),
  /** `CAPEC-593` for an attack pattern, the CWE impact value verbatim for a consequence. */
  justificationRef: text('justification_ref').notNull(),
  justificationName: text('justification_name'),
}, (table) => [
  unique('cwe_technique_links_uniq').on(table.cweId, table.mitreTechniqueId, table.justificationKind, table.justificationRef),
]);

/**
 * The tenant's differences from the shipped link, never a copy of it: a weakness with no row here
 * follows every shipped version.
 */
export const cweTechniqueOverrides = pgTable('cwe_technique_overrides', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cweId: uuid('cwe_id').notNull().references(() => cweWeaknesses.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().$type<CweLinkOverrideKind>(),
}, (table) => [
  unique('cwe_technique_overrides_uniq').on(table.tenantId, table.cweId, table.mitreTechniqueId),
]);

defineSecurityPolicies(cweTechniqueOverrides, tenantIsolationPolicy, manageSecurityWritePolicy);
