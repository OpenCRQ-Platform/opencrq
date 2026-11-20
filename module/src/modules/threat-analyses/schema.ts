import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ActivityAnchorKind } from './activity-scoring';
import type { ActorClass } from './actor-classes';
import type { ThreatEntityType } from './entity-types';
import type { ThreatSourceKind } from './source-kinds';
import { defineSecurityPolicies, tenantIsolationPolicy, threatAnalysisTenantIsolationPolicy } from '../../security';
import { attackOutcomes } from '../attack-outcomes/schema';
import { tenants } from '../tenants';

/**
 * The canonical actor, one row per upstream object per tenant, identified by the STIX id of the
 * object that produced it under the `(tenant_id, stix_id)` unique key. Nothing folds two upstream
 * objects into one actor: two feeds describing the same group give two actors until the objects are
 * merged upstream. Every stated attribute is made equal to the upstream object's on each ingestion, normalised by
 * `deriveCanonicalAnalysis`, so the row never keeps a claim the feed has since stopped stating.
 */
export const threatAnalyses = pgTable('threat_analyses', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stixId: text('stix_id').notNull(),
  entityType: text('entity_type').notNull().default('intrusion-set').$type<ThreatEntityType>(),
  /** Only a `connector` actor's STIX ids are guaranteed to resolve on the tenant's own OpenCTI. */
  kind: text('kind').notNull().$type<ThreatSourceKind>(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  description: text('description'),
  mitreGroupId: text('mitre_group_id'),
  confidence: integer('confidence'),
  stixCreated: timestamp('stix_created', { withTimezone: true, mode: 'date' }),
  firstSeen: timestamp('first_seen', { withTimezone: true, mode: 'date' }),
  lastSeen: timestamp('last_seen', { withTimezone: true, mode: 'date' }),
  primaryMotivation: text('primary_motivation'),
  resourceLevel: text('resource_level'),
  sophistication: text('sophistication'),
  objective: text('objective'),
  actorClass: text('actor_class').notNull().default('default').$type<ActorClass>(),
  /** Manual class. Ingestion rewrites only `actor_class`, which is how this survives a resync. */
  actorClassOverride: text('actor_class_override').$type<ActorClass>(),
  outcomeModelVersion: text('outcome_model_version'),
  /** Whether the stored probabilities can be trusted: judged, or the model's on a record holding enough data. */
  outcomeEvidenceSufficient: boolean('outcome_evidence_sufficient').notNull().default(false),
  /** When the judgment set the actor's judged probabilities come from was made, null when none is judged. */
  outcomeJudgedAt: timestamp('outcome_judged_at', { withTimezone: true, mode: 'date' }),
  /**
   * Written by the `threat-activity-recompute` job, never by an ingestion and never at read
   * time. `activity_computed_at` tells an actor an ingestion touched (`updated_at` moved past it)
   * from one already folded, and `activity_gate` the confidence gate that fold applied, which is how
   * a gate change is seen without a timestamp on the settings row.
   */
  lastObservedAt: timestamp('last_observed_at', { withTimezone: true, mode: 'date' }),
  /**
   * The threat whose date `last_observed_at` is, when a threat attributed to this one supplied it.
   * No foreign key: it is resolved at read inside the tenant, so a source deleted or recreated by a
   * resync stops resolving, and the job rewrites the column on its next fold anyway.
   */
  lastObservedViaAnalysisId: uuid('last_observed_via_analysis_id'),
  lastAuthoredAt: timestamp('last_authored_at', { withTimezone: true, mode: 'date' }),
  activityScore: doublePrecision('activity_score'),
  activityComputedAt: timestamp('activity_computed_at', { withTimezone: true, mode: 'date' }),
  activityGate: integer('activity_gate'),
  // When the actor entered the catalog, which is why only `last_ingested_at` moves on a re-ingestion.
  firstIngestedAt: timestamp('first_ingested_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastIngestedAt: timestamp('last_ingested_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  // One row per upstream object: re-ingesting the same object updates it in place. Two OpenCTI
  // instances exporting the same actor produce the same deterministic id, so collapsing them onto
  // one row is correct.
  unique('threat_analyses_tenant_stix_unique').on(table.tenantId, table.stixId),
  // The target of the composite key `threat_analysis_outcome_probabilities` holds to the tenant.
  unique('threat_analyses_id_tenant_id_uq').on(table.id, table.tenantId),
  // Backs the threat-center list's name-prefix search (`name_folded LIKE ...`), which would
  // otherwise sequential-scan the tenant's whole catalog. `text_pattern_ops`, not the default opclass:
  // the DB's collation isn't `C`, and a plain btree can't serve a prefix `LIKE` under a non-C collation.
  index('threat_analyses_name_lower_idx').on(sql`${table.nameFolded} text_pattern_ops`),
  check('threat_analyses_entity_type_ck', sql`${table.entityType} IN ('intrusion-set', 'threat-actor', 'campaign')`),
]);

defineSecurityPolicies(threatAnalyses, tenantIsolationPolicy);

export const threatAnalysisAliases = pgTable('threat_analysis_aliases', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
}, (table) => [
  index('threat_analysis_aliases_analysis_id_idx').on(table.analysisId),
  uniqueIndex('threat_analysis_aliases_analysis_alias_unique').on(table.analysisId, sql`lower(${table.alias})`),
]);

defineSecurityPolicies(threatAnalysisAliases, threatAnalysisTenantIsolationPolicy);

// SQL identifiers use "motives" (not "motivations"): the full word pushes the
// "${table}_notify_data_changed" trigger name past Postgres's 63-byte identifier limit.
export const threatAnalysisSecondaryMotivations = pgTable('threat_analysis_secondary_motives', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),
}, (table) => [
  index('threat_analysis_secondary_motives_analysis_id_idx').on(table.analysisId),
  uniqueIndex('threat_analysis_secondary_motives_analysis_value_unique').on(table.analysisId, sql`lower(${table.value})`),
]);

defineSecurityPolicies(threatAnalysisSecondaryMotivations, threatAnalysisTenantIsolationPolicy);

export const threatAnalysisGoals = pgTable('threat_analysis_goals', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),
}, (table) => [
  index('threat_analysis_goals_analysis_id_idx').on(table.analysisId),
  uniqueIndex('threat_analysis_goals_analysis_value_unique').on(table.analysisId, sql`lower(${table.value})`),
]);

defineSecurityPolicies(threatAnalysisGoals, threatAnalysisTenantIsolationPolicy);

export const threatAnalysisThreatActorTypes = pgTable('threat_analysis_threat_actor_types', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull(),
  value: text('value').notNull(),
}, (table) => [
  foreignKey({ name: 'threat_analysis_threat_actor_types_analysis_fk', columns: [table.analysisId], foreignColumns: [threatAnalyses.id] }).onDelete('cascade'),
  index('threat_analysis_threat_actor_types_analysis_id_idx').on(table.analysisId),
  uniqueIndex('threat_analysis_threat_actor_types_analysis_value_unique').on(table.analysisId, sql`lower(${table.value})`),
]);

defineSecurityPolicies(threatAnalysisThreatActorTypes, threatAnalysisTenantIsolationPolicy);

export const threatAnalysisRoles = pgTable('threat_analysis_roles', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),
}, (table) => [
  index('threat_analysis_roles_analysis_id_idx').on(table.analysisId),
  uniqueIndex('threat_analysis_roles_analysis_value_unique').on(table.analysisId, sql`lower(${table.value})`),
]);

defineSecurityPolicies(threatAnalysisRoles, threatAnalysisTenantIsolationPolicy);

/**
 * One row per STIX `attributed-to` a threat states toward another threat. The target is held by STIX
 * id and resolved against the tenant's threats at read, so a target ingested later appears and a
 * target removed disappears without the source threat being rewritten.
 */
export const threatAnalysisAttributions = pgTable('threat_analysis_attributions', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull(),
  stixRelationId: text('stix_relation_id').notNull(),
  targetStixId: text('target_stix_id').notNull(),
  producerStixId: text('producer_stix_id'),
  producerName: text('producer_name'),
  isInferred: boolean('is_inferred').notNull().default(false),
  relCreated: timestamp('rel_created', { withTimezone: true, mode: 'date' }),
  relStartTime: timestamp('rel_start_time', { withTimezone: true, mode: 'date' }),
  relStopTime: timestamp('rel_stop_time', { withTimezone: true, mode: 'date' }),
  relModified: timestamp('rel_modified', { withTimezone: true, mode: 'date' }),
  relConfidence: integer('rel_confidence'),
}, (table) => [
  foreignKey({ name: 'threat_analysis_attributions_analysis_fk', columns: [table.analysisId], foreignColumns: [threatAnalyses.id] }).onDelete('cascade'),
  index('threat_analysis_attributions_analysis_id_idx').on(table.analysisId),
  index('threat_analysis_attributions_target_stix_id_idx').on(table.targetStixId),
  unique('threat_analysis_attributions_analysis_relation_unique').on(table.analysisId, table.stixRelationId),
]);

defineSecurityPolicies(threatAnalysisAttributions, threatAnalysisTenantIsolationPolicy);

export const threatAnalysisLocations = pgTable('threat_analysis_locations', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  stixId: text('stix_id').notNull(),
  stixRelationId: text('stix_relation_id').notNull(),
  name: text('name').notNull(),
  country: text('country'),
  producerStixId: text('producer_stix_id'),
  producerName: text('producer_name'),
  isInferred: boolean('is_inferred').notNull().default(false),
  relCreated: timestamp('rel_created', { withTimezone: true, mode: 'date' }),
  relStartTime: timestamp('rel_start_time', { withTimezone: true, mode: 'date' }),
  relStopTime: timestamp('rel_stop_time', { withTimezone: true, mode: 'date' }),
  relModified: timestamp('rel_modified', { withTimezone: true, mode: 'date' }),
  relConfidence: integer('rel_confidence'),
}, (table) => [
  index('threat_analysis_locations_analysis_id_idx').on(table.analysisId),
  unique('threat_analysis_locations_analysis_relation_unique').on(table.analysisId, table.stixRelationId),
]);

defineSecurityPolicies(threatAnalysisLocations, threatAnalysisTenantIsolationPolicy);

export const threatAnalysisSectors = pgTable('threat_analysis_sectors', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  stixId: text('stix_id').notNull(),
  stixRelationId: text('stix_relation_id').notNull(),
  name: text('name').notNull(),
  producerStixId: text('producer_stix_id'),
  producerName: text('producer_name'),
  isInferred: boolean('is_inferred').notNull().default(false),
  relCreated: timestamp('rel_created', { withTimezone: true, mode: 'date' }),
  relStartTime: timestamp('rel_start_time', { withTimezone: true, mode: 'date' }),
  relStopTime: timestamp('rel_stop_time', { withTimezone: true, mode: 'date' }),
  relModified: timestamp('rel_modified', { withTimezone: true, mode: 'date' }),
  relConfidence: integer('rel_confidence'),
}, (table) => [
  index('threat_analysis_sectors_analysis_id_idx').on(table.analysisId),
  unique('threat_analysis_sectors_analysis_relation_unique').on(table.analysisId, table.stixRelationId),
]);

defineSecurityPolicies(threatAnalysisSectors, threatAnalysisTenantIsolationPolicy);

export const threatAnalysisCves = pgTable('threat_analysis_cves', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  stixId: text('stix_id').notNull(),
  stixRelationId: text('stix_relation_id').notNull(),
  cveId: text('cve_id').notNull(),
  producerStixId: text('producer_stix_id'),
  producerName: text('producer_name'),
  isInferred: boolean('is_inferred').notNull().default(false),
  relCreated: timestamp('rel_created', { withTimezone: true, mode: 'date' }),
  relStartTime: timestamp('rel_start_time', { withTimezone: true, mode: 'date' }),
  relStopTime: timestamp('rel_stop_time', { withTimezone: true, mode: 'date' }),
  relModified: timestamp('rel_modified', { withTimezone: true, mode: 'date' }),
  relConfidence: integer('rel_confidence'),
}, (table) => [
  index('threat_analysis_cves_analysis_id_idx').on(table.analysisId),
  // Reverse lookup: CVE -> threats targeting it.
  index('threat_analysis_cves_cve_id_idx').on(table.cveId),
  unique('threat_analysis_cves_analysis_relation_unique').on(table.analysisId, table.stixRelationId),
]);

defineSecurityPolicies(threatAnalysisCves, threatAnalysisTenantIsolationPolicy);

export const threatAnalysisTechniques = pgTable('threat_analysis_techniques', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  stixId: text('stix_id').notNull(),
  stixRelationId: text('stix_relation_id').notNull(),
  name: text('name').notNull(),
  mitreExternalId: text('mitre_external_id').notNull(),
  // `split_part` is `IMMUTABLE`, so this can back a stored generated column (an `unaccent`-based
  // one could not). Lets a claimed sub-technique match its parent catalogue row through a plain
  // equality instead of `split_part` in the join condition, which no index can serve.
  parentExternalId: text('parent_external_id').generatedAlwaysAs(sql`split_part(mitre_external_id, '.', 1)`),
  producerStixId: text('producer_stix_id'),
  producerName: text('producer_name'),
  isInferred: boolean('is_inferred').notNull().default(false),
  relCreated: timestamp('rel_created', { withTimezone: true, mode: 'date' }),
  relStartTime: timestamp('rel_start_time', { withTimezone: true, mode: 'date' }),
  relStopTime: timestamp('rel_stop_time', { withTimezone: true, mode: 'date' }),
  relModified: timestamp('rel_modified', { withTimezone: true, mode: 'date' }),
  relConfidence: integer('rel_confidence'),
}, (table) => [
  index('threat_analysis_techniques_analysis_id_idx').on(table.analysisId),
  // Reverse lookup: MITRE technique -> threats using it.
  index('threat_analysis_techniques_mitre_external_id_idx').on(table.mitreExternalId),
  index('threat_analysis_techniques_parent_external_id_idx').on(table.parentExternalId),
  unique('threat_analysis_techniques_analysis_relation_unique').on(table.analysisId, table.stixRelationId),
]);

defineSecurityPolicies(threatAnalysisTechniques, threatAnalysisTenantIsolationPolicy);

/**
 * One dated row per relationship that can date an actor, plus one per actor for its own
 * `last_seen ?? first_seen`.
 * It is a projection of the claim tables and of `threat_analyses`, rebuilt by the
 * `threat-activity-recompute` job, so it is never written by an ingestion and rebuilding it
 * is rerunning that job.
 *
 * The grade of a date is the column it sits in, not a value: `observed_at` carries a real activity
 * window and `authored_at` the knowledge-base date, and a row carries both when the relationship
 * states both, so a reading of either grade works off the same rows.
 */
export const threatActivityAnchors = pgTable('threat_activity_anchors', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().$type<ActivityAnchorKind>(),
  /** The relationship's STIX id, or, on an `actor` row, the threat's own STIX id. */
  stixRelationId: text('stix_relation_id').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }),
  authoredAt: timestamp('authored_at', { withTimezone: true, mode: 'date' }),
  confidence: integer('confidence'),
  producerStixId: text('producer_stix_id'),
}, (table) => [
  index('threat_activity_anchors_analysis_id_idx').on(table.analysisId),
  // An `actor` row keys on the threat's STIX id and a claim row on the relationship's, and an
  // actor states each at most once, so the pair is unique across both kinds.
  unique('threat_activity_anchors_analysis_relation_unique').on(table.analysisId, table.stixRelationId),
]);

defineSecurityPolicies(threatActivityAnchors, tenantIsolationPolicy);

/**
 * One row per (analysis, attack outcome) holding the probability the offline model gives the actor
 * of leading to that outcome. Every outcome has a row, low probabilities included: a campaign
 * reads its group's seven probabilities, so an absent row would be read as zero rather than as
 * unknown.
 *
 * `tenant_id` is denormalized so the row uses the plain tenant policy rather than a correlated
 * subquery through `analysis_id` on every read, and so the selection index can lead with it.
 */
export const threatAnalysisOutcomeProbabilities = pgTable('threat_analysis_outcome_probabilities', {
  analysisId: uuid('analysis_id').notNull(),
  attackOutcomeId: uuid('attack_outcome_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  probability: doublePrecision('probability').notNull(),
  /** Whether a judgment set gave this probability, rather than the counter filling an outcome it leaves out. */
  judged: boolean('judged').notNull().default(false),
}, (table) => [
  primaryKey({ name: 'threat_analysis_outcome_probabilities_pk', columns: [table.tenantId, table.analysisId, table.attackOutcomeId] }),
  index('threat_analysis_outcome_probabilities_tenant_outcome_probability_idx').on(table.tenantId, table.attackOutcomeId, table.probability.desc().nullsFirst()),
  // Composite so a row can never sit in another tenant than its analysis or its outcome. The primary
  // key and the index above lead with `tenantId`, which is what serves each cascade's lookup.
  foreignKey({
    name: 'threat_analysis_outcome_probabilities_analysis_fk',
    columns: [table.analysisId, table.tenantId],
    foreignColumns: [threatAnalyses.id, threatAnalyses.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'threat_analysis_outcome_probabilities_attack_outcome_fk',
    columns: [table.attackOutcomeId, table.tenantId],
    foreignColumns: [attackOutcomes.id, attackOutcomes.tenantId],
  }).onDelete('cascade'),
]);

defineSecurityPolicies(threatAnalysisOutcomeProbabilities, tenantIsolationPolicy);

/**
 * The outcome counter version a tenant's analyses were last all sent back for rescoring under. Once
 * it matches the code's version, it is the counter recompute job's only read, so the rescoring the
 * job set off does not wake it again on every batch the mirror rebuild writes.
 */
export const threatOutcomeCounterVersions = pgTable('threat_outcome_counter_versions', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  dispatchedVersion: text('dispatched_version').notNull(),
});

defineSecurityPolicies(threatOutcomeCounterVersions, tenantIsolationPolicy);

/**
 * The stored probability of each (analysis, attack outcome) pair above the model's weight threshold,
 * materialized so the threat-center list orders and pages in SQL instead of reading every tenant's
 * probabilities to answer for fifty rows. A projection, never a source: the
 * `threat-list-projection-recompute` job is its only writer.
 *
 * One row per pair above the threshold, which is also the outcome filter's admission rule: an
 * absent row means the threat does not lead to the outcome, so the filtered list inner-joins here
 * and the default list outer-joins.
 *
 * `is_top` marks the winner of its analysis under the list's own tie-break, score descending then
 * outcome name ascending. Without it the default list would group the whole tenant's scores on
 * every page to find each row's best outcome.
 *
 * `tenant_id` is denormalized rather than reached through `analysis_id`, for two reasons: the
 * ordering index above needs it directly, and it lets the row use the plain tenant policy rather
 * than a correlated subquery through `analysis_id` on every read.
 */
export const threatOutcomeScores = pgTable('threat_outcome_scores', {
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  attackOutcomeId: uuid('attack_outcome_id').notNull().references(() => attackOutcomes.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  score: doublePrecision('score').notNull(),
  isTop: boolean('is_top').notNull(),
}, (table) => [
  // Leads with `tenantId`, not just `analysisId`/`attackOutcomeId`, so the recompute job's batch
  // upsert can name it as a certified `onConflictDoOverwrite` target — the policy's overwrite key
  // must sit inside the conflict target or the write reads back its own output.
  primaryKey({ columns: [table.tenantId, table.analysisId, table.attackOutcomeId] }),
  index('threat_outcome_scores_tenant_outcome_score_idx').on(table.tenantId, table.attackOutcomeId, table.score.desc().nullsFirst()),
  // Partial: the default list reads one row per analysis and would otherwise page through every
  // pair to find them.
  index('threat_outcome_scores_tenant_top_score_idx').on(table.tenantId, table.score.desc().nullsLast()).where(sql`is_top`),
  // The primary key leads with `tenantId`, so neither foreign key is reachable by index without
  // these: Postgres checks a cascade on the referencing column alone.
  index('threat_outcome_scores_analysis_id_idx').on(table.analysisId),
  index('threat_outcome_scores_attack_outcome_id_idx').on(table.attackOutcomeId),
]);

defineSecurityPolicies(threatOutcomeScores, tenantIsolationPolicy);

/**
 * The threat-center list's two claim counts per analysis, materialized beside the outcome scores
 * and by the same job, so a page reads them instead of aggregating the tenant's claim tables.
 *
 * Keyed on the analysis alone, not on `threat_outcome_scores`: a count is a fact about the
 * actor, and an actor that scores no outcome holds no row there yet still shows its counts on the
 * unfiltered list. One row per analysis, zero counts included, so a claim withdrawn leaves a zero
 * rather than a row the sweep would have to hunt down and delete.
 *
 * These cannot be columns on `threat_analyses`: the job reads that table to walk the tenant,
 * so writing it too would wake the activity recompute on every sweep and be woken back by it — a
 * feeding cycle the dispatcher reports but does not break.
 */
export const threatAnalysisCounts = pgTable('threat_analysis_counts', {
  analysisId: uuid('analysis_id').notNull().references(() => threatAnalyses.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cveCount: integer('cve_count').notNull(),
  techniqueCount: integer('technique_count').notNull(),
  /**
   * A fingerprint of everything the row and its sibling score rows were folded from, which is what
   * lets the sweep skip an analysis nothing has changed for. Any of the four differing from the
   * input it names marks the analysis stale; the row being absent marks it never computed, which is
   * also what the list reads as pending.
   *
   * Fingerprints rather than a `computed_at` clock on purpose: the sweep stamps the input values it
   * read at the start of the batch, so an ingestion committing mid-sweep leaves them differing from
   * the analysis's own and the next run folds it again. A timestamp would have to be compared
   * against a write that may have landed after it.
   */
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  confidenceGate: integer('confidence_gate').notNull(),
  projectionVersion: text('projection_version').notNull(),
  /**
   * A digest of what the fold reads outside the analyses: the attack outcomes' names, which break a
   * tie between an analysis's top outcomes, and the ATT&CK succession a technique count is taken
   * through. The other three stamps name inputs the tenant's own data moves, and none of them moves
   * when a release revokes a technique or renames an outcome. Without this column such a boot wakes
   * the sweep, finds nothing stale and leaves the tenant folded against a catalogue that no longer
   * exists.
   */
  catalogueFingerprint: text('catalogue_fingerprint').notNull(),
}, (table) => [
  // See `threat_outcome_scores`: `tenantId` has to lead the key for the same
  // `onConflictDoOverwrite` certification reason.
  primaryKey({ columns: [table.tenantId, table.analysisId] }),
  // Same reachability gap as `threat_outcome_scores`: without this, a cascade delete
  // seq-scans this table too.
  index('threat_analysis_counts_analysis_id_idx').on(table.analysisId),
]);

defineSecurityPolicies(threatAnalysisCounts, tenantIsolationPolicy);
