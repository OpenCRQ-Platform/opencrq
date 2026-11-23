import { sql } from 'drizzle-orm';
import { boolean, check, date, doublePrecision, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ActorClass } from '../threat-analyses/actor-classes';
import type { ThreatEntityType } from '../threat-analyses/entity-types';
import type { AssetCategory } from '../supporting-assets/constants';
import type { EstateMode } from '../organizations/constants';
import type { TefNotMeasured, TefSizeSource } from '../tef-catalog/catalogue-constants';
import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import type { BudgetReviewStoredBasket, BudgetReviewTolerancePosture } from '../budget-reviews/constants';
import { TEF_SIZE_SOURCES } from '../tef-catalog/catalogue-constants';
import { budgetReviewLines, budgetReviews } from '../budget-reviews/schema';
import { controlCapabilities } from '../controls/capability/schema';
import { cve } from '../cve/schema';
import { mitreTechniques } from '../mitre-attack/schema';
import {
  budgetReviewTenantIsolationPolicy,
  crqIndicatorRunTenantIsolationPolicy,
  defineSecurityPolicies,
  riskScenarioTenantIsolationPolicy,
  treatmentPlanTenantIsolationPolicy,
} from '../../security';
import { riskScenarios } from '../risk-scenarios/schema';
import { treatmentPlans } from '../treatment-plans/schema';

/**
 * One run of the attack run engine. The euro and frequency figures are nullable because a scenario carrying
 * no TEF or no loss estimate still runs and still answers its reach and its outcome split: it has
 * probabilities to report, and no price to put on them.
 */
export const crqIndicatorRuns = pgTable('crq_indicator_runs', {
  id: uuid('id').primaryKey(),
  riskScenarioId: uuid('risk_scenario_id').notNull().references(() => riskScenarios.id, { onDelete: 'cascade' }),
  /** Stamped once the simulation has finished, so later than every input the run read. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * The `crq-simulation` or `crq-price-recompute` job that computed the run. No foreign key: the
   * job retention prunes that row long before the run goes, and a `set null` would rewrite the
   * run, waking every job that reads runs.
   */
  jobId: uuid('job_id'),
  /**
   * When the attempt that computed the run started reading its inputs: a retried job rereads them,
   * so its first claim is no read time. `null` on a run stored without it, which reads at `created_at`.
   */
  readAt: timestamp('read_at', { withTimezone: true }),
  /**
   * A digest of the inputs every profile computes alike, the app version included: the price pass
   * computes nothing when it matches the latest one's. What-ifs and budget review baskets stay out, and
   * the plans too but for a scenario with no TEF or no loss estimate, which every profile runs in full.
   */
  inputsFingerprint: text('inputs_fingerprint'),
  /**
   * A digest of what the run answered (`resultFingerprintOf`). A price pass whose result matches the
   * latest run's stores no run and moves that run's `inputs_fingerprint` to what it read instead.
   * Null on a run older than this column.
   */
  resultFingerprint: text('result_fingerprint'),
  /** Worlds drawn. */
  iterations: integer('iterations').notNull(),
  /** The probability an attack lands an impact, mixture-weighted: the FAIR vulnerability node. */
  vulnerabilityP5: doublePrecision('vulnerability_p5').notNull(),
  vulnerabilityP50: doublePrecision('vulnerability_p50').notNull(),
  vulnerabilityP95: doublePrecision('vulnerability_p95').notNull(),
  /** Nullable: a run predating this column has no mean on file, and none can be recovered. */
  vulnerabilityMean: doublePrecision('vulnerability_mean'),
  /** The declared TEF range the run drew from, so a stored run reads without its input table. */
  tefMin: doublePrecision('tef_min'),
  tefLikely: doublePrecision('tef_likely'),
  tefMax: doublePrecision('tef_max'),
  /**
   * Every LEF and ALE figure reads the mean, the one statistic that adds up exactly across
   * scenarios, framed by p10 and p90. The band is null on a run older than those two columns.
   */
  lefMean: doublePrecision('lef_mean'),
  lefP10: doublePrecision('lef_p10'),
  lefP90: doublePrecision('lef_p90'),
  aleMean: doublePrecision('ale_mean'),
  aleP10: doublePrecision('ale_p10'),
  aleP90: doublePrecision('ale_p90'),
  /**
   * The cost of one attack that lands, the sum of the scenario's loss drivers drawn once per world
   * and common to every actor, framed by p10 and p90 like the loss. Null on runs older than these
   * columns, and when the scenario has no loss driver.
   */
  magnitudeMean: doublePrecision('magnitude_mean'),
  magnitudeP10: doublePrecision('magnitude_p10'),
  magnitudeP90: doublePrecision('magnitude_p90'),
  /**
   * The techniques the run scored, and how many of them at least one declared control contests
   * somewhere they are played. Smaller than the actors' resolved repertoires: a technique no
   * capability of the catalogue can contest on any family the estate holds leaves the run entirely.
   */
  techniqueCount: integer('technique_count').notNull(),
  coveredTechniqueCount: integer('covered_technique_count').notNull(),
  /**
   * Why the weights read the way they do. Stored as text rather than an enum: it is a run audit
   * trail, and a future mode must not need a migration on historical rows.
   */
  threatEvidenceMode: text('threat_evidence_mode'),
  /**
   * The threat actors the evidence admitted for the scenario, each counted once whatever its class:
   * the attacker rows group them by class. Null on runs older than this column.
   */
  admittedActorCount: integer('admitted_actor_count'),
  /**
   * The four outcomes of an attack run, mixture-weighted: blocked, evicted, impact noticed, impact
   * unnoticed. They sum to one and they are the split every euro figure of the run is priced from.
   */
  outcomeBlocked: doublePrecision('outcome_blocked'),
  outcomeEvicted: doublePrecision('outcome_evicted'),
  outcomeImpactDetected: doublePrecision('outcome_impact_detected'),
  outcomeImpactUndetected: doublePrecision('outcome_impact_undetected'),
  /**
   * Where the attacks of the run ended up by the path they took: stopped at initial access, direct
   * to the scenario's resources, through the long chain, or around initial access. They sum to one.
   * Null on runs older than these columns.
   */
  pathShareStoppedAtInitialAccess: doublePrecision('path_share_stopped_at_initial_access'),
  pathShareDirect: doublePrecision('path_share_direct'),
  pathShareLong: doublePrecision('path_share_long'),
  pathShareWithoutInitialAccess: doublePrecision('path_share_without_initial_access'),
  /**
   * True when no asset of the risk scope is linked to a primary asset of the scenario, so no attack
   * can take the direct path. Null on runs older than this column.
   */
  noTarget: boolean('no_target'),
  /**
   * The calibration the constants came from. Every surface displaying a figure of this run has to
   * say what it reads here rather than deciding for itself whether the engine is calibrated.
   */
  calibrationVintage: text('calibration_vintage'),
  /**
   * The constants the calibration left at one end of their domain rather than at a calibrated
   * point, named so a reader can tell a default from a decision. Stored per run because they are a
   * property of the code that ran, not of the code that displays.
   */
  cornerConstants: text('corner_constants').array(),
  /**
   * The catalogue the reach was computed against, so an ALE move caused by a catalogue release is
   * attributable as such rather than read as a posture change.
   */
  catalogueVintage: text('catalogue_vintage'),
  /**
   * The assets of the scenario's estate carrying no vulnerability data, as a share and as counts.
   * An empty CVE mask is indistinguishable from a fully patched one on the largest single route
   * term, so the share is displayed next to the figures rather than left to be inferred from an
   * absence of findings.
   */
  unscannedAssetShare: doublePrecision('unscanned_asset_share'),
  unscannedAssetCount: integer('unscanned_asset_count'),
  /**
   * The assets this run walked: every asset of the scope's estate in the families the scenario
   * touches. It is the count the figures were computed over, so a scope narrowing its estate is
   * legible here and nowhere else.
   */
  estateAssetCount: integer('estate_asset_count'),
  /**
   * The virtual assets the scope's declared estate added to the walked families, as a count and as
   * their share of the walked estate with them. Null when the scope declared nothing, so a run
   * priced on the measured estate alone is told apart from one the declaration completed by zero.
   */
  declaredAssetCount: integer('declared_asset_count'),
  declaredAssetShare: doublePrecision('declared_asset_share'),
  /** Which estate the scope declared when the run started, so a figure is readable against it. */
  estateMode: text('estate_mode').$type<EstateMode>(),
  /**
   * The scenario-group constant, recorded when the walked estate held both matched and unmatched
   * assets, and one otherwise. It is not the ratio the resource step applied: that weight is
   * normalised per obstacle, so what the constant is worth to a given draw depends on the mix of
   * assets that obstacle can be reached on.
   */
  boostApplied: doublePrecision('boost_applied'),
  /**
   * The two reach gaps, counted; the pairs themselves are in `crq_indicator_run_reach_gaps`. They
   * are never one number: pairs this estate does not contest are a defensive gap the tenant can
   * close, pairs no capability of the catalogue reaches are a modelling gap that says nothing about
   * the tenant.
   */
  uncontestedPairCount: integer('uncontested_pair_count'),
  uncontestablePairCount: integer('uncontestable_pair_count'),
  /**
   * What this run would have answered with the detection accumulator off, on the same worlds.
   *
   * The accumulator's gain is chosen rather than fitted, and a constant nobody can anchor is
   * defensible when its sensitivity travels with it and indefensible when it does not. Zero gain is
   * the exact road back, so this is the figure the choice is measured against.
   */
  aleAtMemorylessDetection: doublePrecision('ale_at_memoryless_detection'),
  /**
   * What the run computed beyond its baseline, as `runProfileTokens` writes it. A family is read
   * from the latest run that computed it, never from the latest run.
   */
  profile: text('profile').array().notNull().default(sql`'{techniques,levers,plans}'::text[]`),
}, (table) => [
  // Serves the scenario list's per-scenario probes: the latest run and the last quantified ones.
  // NULLS FIRST matches `order by … desc`: `.desc()` alone emits NULLS LAST, which the planner cannot walk for it.
  index('crq_indicator_runs_risk_scenario_created_idx').on(table.riskScenarioId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
]);

defineSecurityPolicies(crqIndicatorRuns, riskScenarioTenantIsolationPolicy);

/**
 * One row per attacker the run simulated, with its share, its own vulnerability and the facts
 * about its race that the surface owes a reader per attacker rather than per run. An attacker is an
 * actor class standing for its admitted actors, so `groupName` and `groupEntityType` are null on it.
 *
 * `groupKey` pairs the row with its unplayable obstacles. A row naming a single actor holds the
 * threat id there with NO foreign key on purpose: a run is a dated snapshot of what the evidence
 * said, and a re-ingestion that drops an analysis must not silently rewrite the history of the runs
 * that were computed from it.
 */
export const crqIndicatorGroupScores = pgTable('crq_indicator_group_scores', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  groupKey: uuid('group_key'),
  groupName: text('group_name'),
  groupEntityType: text('group_entity_type').$type<ThreatEntityType>(),
  share: doublePrecision('share').notNull(),
  vulnerabilityP5: doublePrecision('vulnerability_p5').notNull(),
  vulnerabilityP50: doublePrecision('vulnerability_p50').notNull(),
  vulnerabilityP95: doublePrecision('vulnerability_p95').notNull(),
  vulnerabilityMean: doublePrecision('vulnerability_mean').notNull(),
  actorClass: text('actor_class').$type<ActorClass>(),
  aleMean: doublePrecision('ale_mean'),
  /** The clock this actor's race ran against, in days. */
  attackRunDays: integer('attack_run_days'),
  /**
   * The probability the declared reaction time exceeds every remaining window of this actor's attack
   * run. At one, every detect control is worth zero against it, and the surface says so. Null when
   * every attack of the actor goes around initial access, which leaves no window at all.
   */
  reactionTimeExceededShare: doublePrecision('reaction_time_exceeded_share'),
}, (table) => [
  index('crq_indicator_group_scores_run_idx').on(table.runId),
]);

defineSecurityPolicies(crqIndicatorGroupScores, crqIndicatorRunTenantIsolationPolicy);

/**
 * Which of the two reach gaps a pair fell into. `estate`: a playable pair the tenant's declared
 * posture contests with nothing, a fact about the tenant. `catalogue`: a pair no capability of the
 * catalogue reaches at all, excluded from the run, a fact about the model.
 */
export type CrqReachGapKind = 'estate' | 'catalogue';

export const crqIndicatorRunReachGaps = pgTable('crq_indicator_run_reach_gaps', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  family: text('family').notNull().$type<AssetCategory>(),
  gap: text('gap').notNull().$type<CrqReachGapKind>(),
}, (table) => [
  index('crq_indicator_run_reach_gaps_run_idx').on(table.runId),
]);

defineSecurityPolicies(crqIndicatorRunReachGaps, crqIndicatorRunTenantIsolationPolicy);

/**
 * One obstacle an attacker's repertoire could not play at all, per attacker. An attack run stops
 * there rather than scoring zero, so the surface names the obstacle instead of showing a silent
 * zero. `groupKey` follows the same no-foreign-key rule as the group scores.
 */
export const crqIndicatorRunUnplayableObstacles = pgTable('crq_indicator_run_unplayable_obstacles', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  groupKey: uuid('group_key'),
  obstacleKey: text('obstacle_key').notNull(),
}, (table) => [
  index('crq_indicator_run_unplayable_obstacles_run_idx').on(table.runId),
]);

defineSecurityPolicies(crqIndicatorRunUnplayableObstacles, crqIndicatorRunTenantIsolationPolicy);

export type CrqControlWhatIfKind = 'capability';

/**
 * Which move a what-if row prices:
 * - `strength`: one rung up, coverage held;
 * - `coverage`: one bucket wider, strength held;
 * - `deploy`: the anchor step from `L0`/`L0` to the first deployed state, which necessarily moves
 *   both axes because a control deployed nowhere or with no strength instantiates no edge.
 */
export type CrqControlWhatIfDimension = 'strength' | 'coverage' | 'deploy';

/**
 * Why a lever is worth exactly zero, when it is. A zero with no reason beside it reads as a defect
 * of the engine; each of these reads as a fact about the actor, the estate or the declaration.
 */
export type CrqControlWhatIfZeroReason = 'actor-repertoire' | 'estate-families' | 'already-maximal';

/**
 * One lever of one control, priced exactly on the run's own worlds: the mean delta ALE and its
 * spread. Only the levers that can move the answer are written, so a row's absence is the shape of
 * a declaration rather than a gap.
 *
 * No baseline column: the baseline of every what-if is the run's own `ale_mean`, functionally
 * dependent on `run_id` alone.
 */
export const crqControlWhatIfResults = pgTable('crq_control_what_if_results', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  controlId: uuid('control_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  controlKind: text('control_kind').notNull().$type<CrqControlWhatIfKind>(),
  dimension: text('dimension').notNull().$type<CrqControlWhatIfDimension>(),
  currentStrength: text('current_strength').notNull().$type<StrengthRung>(),
  upgradedStrength: text('upgraded_strength').notNull().$type<StrengthRung>(),
  currentCoverage: text('current_coverage').notNull().$type<CoverageBucket>(),
  upgradedCoverage: text('upgraded_coverage').notNull().$type<CoverageBucket>(),
  aleReductionMean: doublePrecision('ale_reduction_mean'),
  /**
   * The spread of the delta across the run's worlds. It is the tenant's declarative uncertainty
   * about its own estate rather than simulation noise, which is what makes a wide delta a test
   * recommendation instead of a figure to average away.
   */
  aleReductionP10: doublePrecision('ale_reduction_p10'),
  aleReductionP90: doublePrecision('ale_reduction_p90'),
  zeroReason: text('zero_reason').$type<CrqControlWhatIfZeroReason>(),
}, (table) => [
  index('crq_control_what_if_results_run_idx').on(table.runId),
]);

defineSecurityPolicies(crqControlWhatIfResults, crqIndicatorRunTenantIsolationPolicy);

export const CRQ_PLAN_WHAT_IF_RUN_PLAN_UNIQUE = 'crq_plan_what_if_results_run_plan_uniq';

/**
 * What one treatment plan's whole posture removes from one run's annualised loss: the run's own
 * worlds priced a second time with every control the plan moves raised to what the plan asks of
 * it. One evaluation of the basket rather than a sum of its controls, because two controls on the
 * same technique each quieten what is left after the other.
 *
 * No baseline column, as on the per-control table: the baseline is the run's own `ale_mean`.
 *
 * **A row whose `planScopeVersion` differs from its plan's current `scopeVersion` is stale, and
 * every reader treats it as absent.** Deleting the rows when a plan's moves change would not be
 * enough on its own: a run that read the targets before the edit still writes its row after it, and
 * that row would be indistinguishable from a current projection while pricing a posture the plan no
 * longer asks for.
 */
export const crqPlanWhatIfResults = pgTable('crq_plan_what_if_results', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => treatmentPlans.id, { onDelete: 'cascade' }),
  /** The plan's `scopeVersion` as the run read it, never as it stands now. */
  planScopeVersion: integer('plan_scope_version').notNull(),
  aleReductionMean: doublePrecision('ale_reduction_mean'),
  aleReductionP10: doublePrecision('ale_reduction_p10'),
  aleReductionP90: doublePrecision('ale_reduction_p90'),
}, (table) => [
  unique(CRQ_PLAN_WHAT_IF_RUN_PLAN_UNIQUE).on(table.runId, table.planId),
  index('crq_plan_what_if_results_plan_idx').on(table.planId),
]);

defineSecurityPolicies(crqPlanWhatIfResults, treatmentPlanTenantIsolationPolicy);

/**
 * What one figure of a budget review is worth on one run: a paired difference between two postures
 * priced on the run's own worlds, so its p10 and p90 are those of the difference and never of two
 * independent estimates. `basket` names the figure; `line_id` is set on a `line` figure alone, and
 * `step_on` on the risk curve's `step` and `step-level` figures alone, the day they price.
 *
 * As on the plan table, **a row whose `reviewVersion` differs from its review's current `version` is
 * expired**: a run that read the lines before an edit still writes its rows after it.
 */
export const crqBudgetReviewResults = pgTable('crq_budget_review_results', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  reviewId: uuid('review_id').notNull().references(() => budgetReviews.id, { onDelete: 'cascade' }),
  /** The review's `version` as the run read it, never as it stands now. */
  reviewVersion: integer('review_version').notNull(),
  basket: text('basket').notNull().$type<BudgetReviewStoredBasket>(),
  lineId: uuid('line_id').references(() => budgetReviewLines.id, { onDelete: 'cascade' }),
  stepOn: date('step_on', { mode: 'string' }),
  aleReductionMean: doublePrecision('ale_reduction_mean'),
  aleReductionP10: doublePrecision('ale_reduction_p10'),
  aleReductionP90: doublePrecision('ale_reduction_p90'),
}, (table) => [
  unique('crq_budget_review_results_run_basket_uniq').on(table.runId, table.reviewId, table.basket, table.lineId, table.stepOn).nullsNotDistinct(),
  index('crq_budget_review_results_review_idx').on(table.reviewId),
  index('crq_budget_review_results_line_idx').on(table.lineId),
]);

defineSecurityPolicies(crqBudgetReviewResults, budgetReviewTenantIsolationPolicy);

/**
 * The annual loss of one run at each posture a budget review's risk tolerance is read at, in the shape
 * of `crq_indicator_run_annual_losses` and drawn on the same seeds as the run's own. Expired as
 * `crq_budget_review_results` is, by `reviewVersion`, and written only for a priced run.
 */
export const crqBudgetReviewAnnualLosses = pgTable('crq_budget_review_annual_losses', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  reviewId: uuid('review_id').notNull().references(() => budgetReviews.id, { onDelete: 'cascade' }),
  reviewVersion: integer('review_version').notNull(),
  posture: text('posture').notNull().$type<BudgetReviewTolerancePosture>(),
  years: integer('years').notNull(),
  mean: doublePrecision('mean').notNull(),
  lossYearShare: doublePrecision('loss_year_share').notNull(),
  lossEventYearShare: doublePrecision('loss_event_year_share').notNull(),
  probabilities: doublePrecision('probabilities').array().notNull(),
  losses: doublePrecision('losses').array().notNull(),
}, (table) => [
  unique('crq_budget_review_annual_losses_run_posture_uniq').on(table.runId, table.reviewId, table.posture),
  index('crq_budget_review_annual_losses_review_idx').on(table.reviewId),
  check('crq_budget_review_annual_losses_posture_ck', sql`${table.posture} IN ('reference', 'without-build')`),
]);

defineSecurityPolicies(crqBudgetReviewAnnualLosses, budgetReviewTenantIsolationPolicy);

/**
 * What interdicting one technique is worth, one row per technique the run scored, summed over the
 * actors that hold it: the euros the run's own `ale_mean` drops by when that technique never
 * succeeds, and when its detection is fully covered.
 *
 * Each is measured one technique at a time against the same baseline, so rows overlap across
 * techniques: a set of them is a ranking and a ceiling, never a decomposition of the ALE.
 */
export const crqTechniqueWhatIfResults = pgTable('crq_technique_what_if_results', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  mitreTechniqueId: uuid('mitre_technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  preventValueMean: doublePrecision('prevent_value_mean'),
  detectValueMean: doublePrecision('detect_value_mean'),
}, (table) => [
  index('crq_technique_what_if_results_run_idx').on(table.runId),
]);

defineSecurityPolicies(crqTechniqueWhatIfResults, crqIndicatorRunTenantIsolationPolicy);

/**
 * What fixing one flaw is worth, one row per CVE of the run's door whose threat rises above a
 * silent flaw's (`SILENT_FLAW_THREAT`), the others being worth too little to price unless an admitted
 * actor cites them and some asset's floor depends on them, and one per CVE an admitted actor cites
 * that the estate carries and the door lists no opening of: the euros the run's
 * own `ale_mean` drops by when that exploit is not in circulation, summed over the actors world by
 * world on the run's own worlds, like the control and plan what-ifs.
 *
 * Each is measured one flaw at a time against the same baseline, so rows overlap across flaws: a
 * set of them is a ranking and a ceiling, never a decomposition of the ALE. The figure covers the
 * exploit at initial access, in the worlds where it circulates, and the exploited-CVE floor an
 * admitted actor citing the CVE holds after the door, in every world; a flaw the door lists no opening
 * of has the floor alone. A flaw never drawn and floored by no actor is worth exactly zero.
 */
export const crqCveWhatIfResults = pgTable('crq_cve_what_if_results', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => crqIndicatorRuns.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  aleReductionMean: doublePrecision('ale_reduction_mean'),
  aleReductionP10: doublePrecision('ale_reduction_p10'),
  aleReductionP90: doublePrecision('ale_reduction_p90'),
}, (table) => [
  // Serves the join of a run's rows to a list of CVEs.
  index('crq_cve_what_if_results_run_cve_idx').on(table.runId, table.cveId),
]);

defineSecurityPolicies(crqCveWhatIfResults, crqIndicatorRunTenantIsolationPolicy);

/**
 * The distribution of one run's annual loss, one row per run, its `id` reusing the run's. The
 * losses are the quantiles at `probabilities`, paired by position, and the levels are stored with
 * them so a row reads alike whatever grid the engine samples on later.
 *
 * Written only for a priced run. A run without one, older than this table or carrying no TEF or no
 * loss estimate, has no distribution, which a reader says rather than draws as a zero.
 */
export const crqIndicatorRunAnnualLosses = pgTable('crq_indicator_run_annual_losses', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull(),
  years: integer('years').notNull(),
  mean: doublePrecision('mean').notNull(),
  lossYearShare: doublePrecision('loss_year_share').notNull(),
  lossEventYearShare: doublePrecision('loss_event_year_share').notNull(),
  probabilities: doublePrecision('probabilities').array().notNull(),
  losses: doublePrecision('losses').array().notNull(),
}, (table) => [
  unique('crq_indicator_run_annual_losses_run_unique').on(table.runId),
  foreignKey({ name: 'crq_indicator_run_annual_losses_run_fk', columns: [table.runId], foreignColumns: [crqIndicatorRuns.id] }).onDelete('cascade'),
]);

defineSecurityPolicies(crqIndicatorRunAnnualLosses, crqIndicatorRunTenantIsolationPolicy);

export const crqIndicatorTefInputs = pgTable('crq_indicator_tef_inputs', {
  riskScenarioId: uuid('risk_scenario_id').primaryKey().references(() => riskScenarios.id, { onDelete: 'cascade' }),
  min: doublePrecision('min').notNull(),
  likely: doublePrecision('likely').notNull(),
  max: doublePrecision('max').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

defineSecurityPolicies(crqIndicatorTefInputs, riskScenarioTenantIsolationPolicy);

export const TEF_FALLBACK_REASONS = ['incomplete_firmography', 'unmapped_sector', 'unmapped_country'] as const;
export type TefFallbackReason = typeof TEF_FALLBACK_REASONS[number];

/**
 * One row per `resolveAutoTef` computation, forward-only (never updated). A row read from a catalogue
 * package names it by `catalog_id` and `catalog_version`, and records the profile and the row it read,
 * the size weights paired with the size classes by position. A row stored from a multiplier vintage
 * names its `catalog_vintage` and leaves the read null; it stays as the scenario's history.
 */
export const tefEstimates = pgTable('tef_estimates', {
  id: uuid('id').primaryKey(),
  riskScenarioId: uuid('risk_scenario_id').notNull().references(() => riskScenarios.id, { onDelete: 'cascade' }),
  catalogVintage: integer('catalog_vintage'),
  catalogId: text('catalog_id'),
  catalogVersion: text('catalog_version'),
  min: doublePrecision('min').notNull(),
  likely: doublePrecision('likely').notNull(),
  max: doublePrecision('max').notNull(),
  positioned: boolean('positioned').notNull(),
  fallbackReason: text('fallback_reason').$type<TefFallbackReason | null>(),
  countryIsoAlpha3: text('country_iso_alpha3'),
  sectorName: text('sector_name'),
  sizeSource: text('size_source').$type<TefSizeSource | null>(),
  /** ISO alpha-2, or `*` for the row of every country. */
  readCountry: text('read_country'),
  /** `null` on a row read for every sector. */
  readSector: text('read_sector'),
  readSizeClasses: text('read_size_classes').array(),
  readSizeWeights: doublePrecision('read_size_weights').array(),
  notMeasured: text('not_measured').array().$type<Array<TefNotMeasured>>(),
  sourceIds: text('source_ids').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // `id` breaks a `created_at` tie: estimates written in one transaction share the timestamp.
  index('tef_estimates_risk_scenario_created_idx').on(table.riskScenarioId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
  check('tef_estimates_catalogue_read_ck', sql`(${table.catalogVintage} IS NOT NULL AND ${table.catalogId} IS NULL AND ${table.catalogVersion} IS NULL) OR (
    ${table.catalogVintage} IS NULL
    AND ${table.catalogId} IS NOT NULL
    AND ${table.catalogVersion} IS NOT NULL
    AND ${table.sizeSource} IN (${sql.raw(TEF_SIZE_SOURCES.map((value) => `'${value}'`).join(', '))})
    AND ${table.readCountry} IS NOT NULL
    AND ${table.readSizeClasses} IS NOT NULL
    AND ${table.readSizeWeights} IS NOT NULL
    AND cardinality(${table.readSizeClasses}) = cardinality(${table.readSizeWeights})
    AND ${table.notMeasured} IS NOT NULL
    AND ${table.sourceIds} IS NOT NULL
  )`),
]);

defineSecurityPolicies(tefEstimates, riskScenarioTenantIsolationPolicy);
