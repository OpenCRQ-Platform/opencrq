import { date, doublePrecision, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ExpectationType } from '../supporting-assets/constants';
import type { FindingMetricKey } from './metrics';
import type { SeverityBand } from './bands';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { assetEvidence, supportingAssets } from '../supporting-assets/schema';
import { cve } from '../cve/schema';
import { mitreTechniques } from '../mitre-attack/schema';
import { organizations } from '../organizations/schema';
import { tenants } from '../tenants';

/**
 * The recompute job is its only writer, and every figure a surface prints for a finding is read
 * from here rather than rescored on request, so no two screens can show a finding two scores. It
 * also lets the list order and page in SQL, rather than scoring the whole estate for fifty rows.
 */
export const findingScores = pgTable('finding_scores', {
  assetEvidenceId: uuid('asset_evidence_id').primaryKey().references(() => assetEvidence.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Null with `band` while the finding's CVE has no vector the score can read. */
  score: doublePrecision('score'),
  band: text('band').$type<SeverityBand>(),
  // Null until a recompute writes the row. Every part is on 0 to 1, as the engine composed it.
  exploitability: doublePrecision('exploitability'),
  impact: doublePrecision('impact'),
  potentialImpact: doublePrecision('potential_impact'),
  exploitationLetThrough: doublePrecision('exploitation_let_through'),
  impactLetThrough: doublePrecision('impact_let_through'),
  reachability: doublePrecision('reachability'),
  threat: doublePrecision('threat'),
  // The exploitation technique whose path set `exploitation_let_through`; null when none stood there.
  weakestTechniqueId: uuid('weakest_technique_id').references(() => mitreTechniques.id, { onDelete: 'set null' }),
  /** When the score last moved, not when it was last checked: an unchanged row is not rewritten. */
  scoreChangedAt: timestamp('score_changed_at', { withTimezone: true }).notNull().defaultNow(),
});

defineSecurityPolicies(findingScores, tenantIsolationPolicy);

/**
 * What a finding's score was, whenever it moved. The only trace of a band's past: `finding_scores`
 * keeps one row per finding and every run overwrites it.
 *
 * A line is written when the *displayed* score changes, the integer `truncateScore` renders, or
 * when the band does. Journaling every float movement reaches millions of rows in a quarter;
 * journaling band changes alone leaves a finding's curve with four steps and nothing between them.
 */
export const findingScoreHistory = pgTable('finding_score_history', {
  id: uuid('id').primaryKey(),
  assetEvidenceId: uuid('asset_evidence_id').notNull().references(() => assetEvidence.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Null with `band` when the finding lost its score to a CVE with no readable vector. */
  score: doublePrecision('score'),
  band: text('band').$type<SeverityBand>(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
}, (table) => [
  index('finding_score_history_tenant_changed_idx').on(table.tenantId, table.changedAt),
  // The reconstruction and the trim both ask one finding for its line in force at an instant.
  index('finding_score_history_evidence_changed_idx').on(table.assetEvidenceId, table.changedAt.desc().nullsFirst()),
]);

defineSecurityPolicies(findingScoreHistory, tenantIsolationPolicy);

/**
 * One figure per metric per UTC day: the point a card's lifeline draws for that day.
 *
 * The day of the run stays live, rewritten by every run of the day, so the last point of a plot is
 * the figure printed above it rather than a snapshot taken at some hour.
 */
export const findingMetricDaily = pgTable('finding_metric_daily', {
  // Computed for the tenant and for nothing else: the only path a deleted tenant's rows can leave by.
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  metric: text('metric').notNull().$type<FindingMetricKey>(),
  value: integer('value').notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.day, table.metric] }),
]);

defineSecurityPolicies(findingMetricDaily, tenantIsolationPolicy);

/**
 * A projection the recompute writes in the transaction that writes the scores it reads, so the
 * asset list sorts on it in SQL. An asset with no applicable finding carrying an exploitability has
 * no row: that is no data, never a safe asset.
 */
export const assetPostures = pgTable('asset_postures', {
  supportingAssetId: uuid('supporting_asset_id').primaryKey().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
}, (table) => [
  index('asset_postures_tenant_score_idx').on(table.tenantId, table.score),
]);

defineSecurityPolicies(assetPostures, tenantIsolationPolicy);

/**
 * What an asset's posture was, whenever it moved: the only trace of its past, since every run
 * overwrites `asset_postures`. A line is written when the integer score changes, when an asset gets
 * its first posture, and with a null score when it loses it, so a reader never carries a lost
 * posture forward.
 *
 * The cause columns are what `explainAssetPosture` read for that score, null on a lost posture and
 * on a line older than them. The worst finding goes null with its evidence row, never the
 * line.
 */
export const assetPostureHistory = pgTable('asset_posture_history', {
  id: uuid('id').primaryKey(),
  supportingAssetId: uuid('supporting_asset_id').notNull().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  score: integer('score'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  worstAssetEvidenceId: uuid('worst_asset_evidence_id').references(() => assetEvidence.id, { onDelete: 'set null' }),
  /** The worst finding's exploitability on 0 to 100, as `partFigure` gave it to the posture. */
  worstExploitability: integer('worst_exploitability'),
  criticalCount: integer('critical_count'),
  highCount: integer('high_count'),
  mediumCount: integer('medium_count'),
  lowCount: integer('low_count'),
}, (table) => [
  index('asset_posture_history_tenant_changed_idx').on(table.tenantId, table.changedAt),
  index('asset_posture_history_asset_changed_idx').on(table.supportingAssetId, table.changedAt.desc().nullsFirst()),
  index('asset_posture_history_worst_evidence_idx').on(table.worstAssetEvidenceId),
]);

defineSecurityPolicies(assetPostureHistory, tenantIsolationPolicy);

/**
 * Per asset and technique, the worst finding's score and that finding, written in the transaction
 * that writes the scores it reads. A technique no finding opens has no row, which is no data, never
 * a safe technique.
 */
export const assetTechniqueScores = pgTable('asset_technique_scores', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supportingAssetId: uuid('supporting_asset_id').notNull().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  assetEvidenceId: uuid('asset_evidence_id').notNull().references(() => assetEvidence.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.supportingAssetId, table.mitreTechniqueId] }),
  // The cascades from an asset or a finding look rows up without the tenant the key starts with.
  index('asset_technique_scores_supporting_asset_idx').on(table.supportingAssetId),
  index('asset_technique_scores_asset_evidence_idx').on(table.assetEvidenceId),
]);

defineSecurityPolicies(assetTechniqueScores, tenantIsolationPolicy);

/**
 * One row per unique finding (a CVE, or a technique with its expectation) and per estate: the
 * whole tenant under a null `organization_id`, and each organization over the assets mapped to it.
 * A group's score depends on which assets it spans, so a scope cannot be read off the tenant's row.
 * Written in the transaction that writes the scores it reads; a technique group has no score.
 */
export const uniqueFindingScores = pgTable('unique_finding_scores', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').references(() => cve.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  expectationType: text('expectation_type').$type<ExpectationType>(),
  score: doublePrecision('score'),
  band: text('band').$type<SeverityBand>(),
  worstScore: doublePrecision('worst_score'),
  affectedAssetCount: integer('affected_asset_count').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
}, (table) => [
  unique('unique_finding_scores_group_uq')
    .on(table.tenantId, table.organizationId, table.cveId, table.mitreTechniqueId, table.expectationType)
    .nullsNotDistinct(),
  // NULLS LAST matches the list's default sort, `score desc nulls last`: a group with no score goes last.
  index('unique_finding_scores_scope_score_idx').on(table.tenantId, table.organizationId, table.score.desc().nullsLast()),
  // The cascades from a CVE or an organization look rows up without the tenant the key starts with.
  index('unique_finding_scores_cve_idx').on(table.cveId),
  index('unique_finding_scores_organization_idx').on(table.organizationId),
]);

defineSecurityPolicies(uniqueFindingScores, tenantIsolationPolicy);

/**
 * What a CVE unique finding's score and affected asset count were in one estate, whenever one of
 * them or the band moved. A null asset count marks the group leaving the estate, a null score alone
 * a group with no scored finding. Technique groups have no score to journal.
 */
export const uniqueFindingScoreHistory = pgTable('unique_finding_score_history', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  score: doublePrecision('score'),
  band: text('band').$type<SeverityBand>(),
  worstScore: doublePrecision('worst_score'),
  affectedAssetCount: integer('affected_asset_count'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
}, (table) => [
  index('unique_finding_score_history_tenant_changed_idx').on(table.tenantId, table.changedAt),
  index('unique_finding_score_history_cve_changed_idx').on(table.cveId, table.organizationId, table.changedAt.desc().nullsFirst()),
  index('unique_finding_score_history_organization_idx').on(table.organizationId),
]);

defineSecurityPolicies(uniqueFindingScoreHistory, tenantIsolationPolicy);
