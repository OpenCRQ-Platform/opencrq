import { date, doublePrecision, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ToleranceSource } from '../dashboard/loss-exceedance';
import type { BudgetLineNature, BudgetReviewBasket, BudgetReviewFigureState, BudgetReviewStatus } from './constants';
import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import { budgetReviewTenantIsolationPolicy, defineSecurityPolicies, organizationTenantIsolationPolicy } from '../../security';
import { controlCapabilities } from '../controls/capability/schema';
import { organizations } from '../organizations/schema';
import { riskScenarios } from '../risk-scenarios/schema';
import { users } from '../users';

export const budgetReviews = pgTable('budget_reviews', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  /**
   * The first day of a month: the review covers the twelve months from it, in UTC, its end derived
   * and never stored. Every figure is priced against the period, so moving it bumps `version`.
   */
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  context: text('context'),
  status: text('status').notNull().default('open').$type<BudgetReviewStatus>(),
  /**
   * Bumped by the service on every change to what a run prices (the lines, their controls, the
   * period) and on reopening. A stored figure records the version it was priced under, and a reader
   * treats one carrying another version as expired.
   */
  version: integer('version').notNull().default(1),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('budget_reviews_organization_idx').on(table.organizationId),
]);

defineSecurityPolicies(budgetReviews, organizationTenantIsolationPolicy);

export const budgetReviewLines = pgTable('budget_review_lines', {
  id: uuid('id').primaryKey(),
  reviewId: uuid('review_id').notNull().references(() => budgetReviews.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  nature: text('nature').notNull().$type<BudgetLineNature>(),
  amountSpent: doublePrecision('amount_spent').notNull(),
  /**
   * The years a build line's spend is spread over, for a return read against what the work costs a
   * year rather than against the year it was paid. Null on a run line, whose spend recurs every year,
   * and on a build line read against its full spend.
   */
  amortizationYears: integer('amortization_years'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('budget_review_lines_id_review_uniq').on(table.id, table.reviewId),
  index('budget_review_lines_review_idx').on(table.reviewId),
]);

defineSecurityPolicies(budgetReviewLines, budgetReviewTenantIsolationPolicy);

/**
 * The controls a line funds, and never their moves: the posture a control held at the period's start
 * and at its end is read from the history whenever the review is priced, a running period moving on.
 * The review id serves the policy, and the composite key keeps it equal to the line's own.
 */
export const budgetReviewLineControls = pgTable('budget_review_line_controls', {
  id: uuid('id').primaryKey(),
  lineId: uuid('line_id').notNull(),
  reviewId: uuid('review_id').notNull().references(() => budgetReviews.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
}, (table) => [
  unique('budget_review_line_controls_line_capability_uniq').on(table.lineId, table.capabilityId),
  index('budget_review_line_controls_review_idx').on(table.reviewId),
  foreignKey({
    name: 'budget_review_line_controls_line_fk',
    columns: [table.lineId, table.reviewId],
    foreignColumns: [budgetReviewLines.id, budgetReviewLines.reviewId],
  }).onDelete('cascade'),
]);

defineSecurityPolicies(budgetReviewLineControls, budgetReviewTenantIsolationPolicy);

/** The figures of a review as they stood when it was closed, written once by the closing. */
export const budgetReviewClosedFigures = pgTable('budget_review_closed_figures', {
  id: uuid('id').primaryKey(),
  reviewId: uuid('review_id').notNull().references(() => budgetReviews.id, { onDelete: 'cascade' }),
  basket: text('basket').notNull().$type<BudgetReviewBasket>(),
  /** Set on a `line` figure alone. */
  lineId: uuid('line_id').references(() => budgetReviewLines.id, { onDelete: 'cascade' }),
  state: text('state').notNull().$type<BudgetReviewFigureState>(),
  aleReductionMean: doublePrecision('ale_reduction_mean'),
  aleReductionP10: doublePrecision('ale_reduction_p10'),
  aleReductionP90: doublePrecision('ale_reduction_p90'),
  pricedScenarioCount: integer('priced_scenario_count').notNull(),
  scopeScenarioCount: integer('scope_scenario_count').notNull(),
  pricedAt: timestamp('priced_at', { withTimezone: true }),
}, (table) => [
  unique('budget_review_closed_figures_review_basket_uniq').on(table.reviewId, table.basket, table.lineId).nullsNotDistinct(),
  index('budget_review_closed_figures_line_idx').on(table.lineId),
]);

defineSecurityPolicies(budgetReviewClosedFigures, budgetReviewTenantIsolationPolicy);

/** Each control's posture at the start and at the end of the review's period, as read at the closing. */
export const budgetReviewClosedPostures = pgTable('budget_review_closed_postures', {
  id: uuid('id').primaryKey(),
  reviewId: uuid('review_id').notNull().references(() => budgetReviews.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  startStrengthRung: text('start_strength_rung').notNull().$type<StrengthRung>(),
  startCoverageBucket: text('start_coverage_bucket').notNull().$type<CoverageBucket>(),
  endStrengthRung: text('end_strength_rung').notNull().$type<StrengthRung>(),
  endCoverageBucket: text('end_coverage_bucket').notNull().$type<CoverageBucket>(),
}, (table) => [
  unique('budget_review_closed_postures_review_capability_uniq').on(table.reviewId, table.capabilityId),
]);

defineSecurityPolicies(budgetReviewClosedPostures, budgetReviewTenantIsolationPolicy);

/**
 * Each scenario of the scope as the closing read it against its risk tolerance: the tolerance applied
 * then, null when none was, and both exceedance curves as losses paired by position with their
 * probabilities, null for a scenario the closing found unpriced. A scenario deleted afterwards keeps
 * its row, its name as it was then and a null id, since the review's frozen figures still count it.
 */
export const budgetReviewClosedTolerances = pgTable('budget_review_closed_tolerances', {
  id: uuid('id').primaryKey(),
  reviewId: uuid('review_id').notNull().references(() => budgetReviews.id, { onDelete: 'cascade' }),
  riskScenarioId: uuid('risk_scenario_id').references(() => riskScenarios.id, { onDelete: 'set null' }),
  scenarioName: text('scenario_name').notNull(),
  toleranceAnnualLoss: doublePrecision('tolerance_annual_loss'),
  toleranceMaxExceedanceProbability: doublePrecision('tolerance_max_exceedance_probability'),
  toleranceSource: text('tolerance_source').$type<ToleranceSource>(),
  referenceLosses: doublePrecision('reference_losses').array(),
  referenceProbabilities: doublePrecision('reference_probabilities').array(),
  withoutBuildLosses: doublePrecision('without_build_losses').array(),
  withoutBuildProbabilities: doublePrecision('without_build_probabilities').array(),
}, (table) => [
  unique('budget_review_closed_tolerances_review_scenario_uniq').on(table.reviewId, table.riskScenarioId),
  index('budget_review_closed_tolerances_risk_scenario_idx').on(table.riskScenarioId),
]);

defineSecurityPolicies(budgetReviewClosedTolerances, budgetReviewTenantIsolationPolicy);
