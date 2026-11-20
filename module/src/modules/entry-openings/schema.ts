import { doublePrecision, index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { cve } from '../cve/schema';
import { mitreTechniques } from '../mitre-attack/schema';
import { assetEvidence, supportingAssets } from '../supporting-assets/schema';
import { tenants } from '../tenants';

/**
 * Per finding and initial access technique, how far the finding opens that technique before any
 * control, written by the finding-score recompute in the transaction that writes its scores. It
 * lives outside `finding-score` so the attack run can read it without reading a score that already
 * carries controls.
 *
 * `threat` is the finding's stored threat factor and `opening` is vector access times impact
 * toward the flaw's worst of confidentiality and integrity, both on 0 to 1. A finding that opens
 * no entry technique has no row, which is no data, never a safe finding.
 */
export const entryOpenings = pgTable('entry_openings', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assetEvidenceId: uuid('asset_evidence_id').notNull().references(() => assetEvidence.id, { onDelete: 'cascade' }),
  supportingAssetId: uuid('supporting_asset_id').notNull().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  opening: doublePrecision('opening').notNull(),
  threat: doublePrecision('threat').notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.assetEvidenceId, table.mitreTechniqueId] }),
  // The cascades from a finding, an asset or a CVE look rows up without the tenant the key starts with.
  index('entry_openings_asset_evidence_idx').on(table.assetEvidenceId),
  index('entry_openings_supporting_asset_idx').on(table.supportingAssetId),
  index('entry_openings_cve_idx').on(table.cveId),
]);

defineSecurityPolicies(entryOpenings, tenantIsolationPolicy);
