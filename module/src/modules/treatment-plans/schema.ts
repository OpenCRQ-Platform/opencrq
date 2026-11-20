import { date, doublePrecision, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { TreatmentPlanStatus } from './constants';
import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import { defineSecurityPolicies, organizationTenantIsolationPolicy, treatmentPlanTenantIsolationPolicy } from '../../security';
import { controlCapabilities } from '../controls/capability/schema';
import { organizations } from '../organizations/schema';
import { users } from '../users';

export const TREATMENT_PLAN_MOVE_PLAN_CAPABILITY_UNIQUE = 'treatment_plan_moves_plan_capability_uniq';

/**
 * A set of control upgrades one risk scope decided to make. Whether it is overdue is read from
 * `endDate`, never stored: a stored copy goes stale the day after it is written.
 * `promisedAleReduction` and `promisedAt` are stamped once, when the plan is activated, and never
 * re-stamped afterwards: the claim has to stay comparable to a reality that moved under it.
 */
export const treatmentPlans = pgTable('treatment_plans', {
  id: uuid('id').primaryKey(),
  /**
   * The plan's only route to a tenant. A rung and a bucket are declared per
   * scope, so a target and the figures priced against it describe one scope and nothing wider.
   */
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft').$type<TreatmentPlanStatus>(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  rationale: text('rationale'),
  costOneOff: doublePrecision('cost_one_off'),
  costRecurringAnnual: doublePrecision('cost_recurring_annual'),
  promisedAleReduction: doublePrecision('promised_ale_reduction'),
  promisedAt: timestamp('promised_at', { withTimezone: true }),
  /**
   * Bumped by the service on every change to the set of moves. A figure is priced against one
   * posture, so anything storing a figure for this plan records the version it read and a reader
   * treats a stored figure carrying another version as absent rather than as a current projection.
   */
  scopeVersion: integer('scope_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('treatment_plans_organization_idx').on(table.organizationId),
]);

defineSecurityPolicies(treatmentPlans, organizationTenantIsolationPolicy);

/**
 * One row per control the plan moves. It carries no `tenant_id`: it reaches its tenant through its
 * plan, and a column of its own would be a second answer nothing keeps equal to the first.
 * Every target is nullable so a move can name a strength, a coverage or both, a null axis leaving
 * the declaration where it is. The service refuses a row that names none. A target is the posture
 * the plan commits the control to and not a floor, so one below the declaration is a reduction and
 * is priced as one.
 */
export const treatmentPlanMoves = pgTable('treatment_plan_moves', {
  id: uuid('id').primaryKey(),
  planId: uuid('plan_id').notNull().references(() => treatmentPlans.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => controlCapabilities.id, { onDelete: 'cascade' }),
  targetStrengthRung: text('target_strength_rung').$type<StrengthRung>(),
  targetCoverageBucket: text('target_coverage_bucket').$type<CoverageBucket>(),
}, (table) => [
  unique(TREATMENT_PLAN_MOVE_PLAN_CAPABILITY_UNIQUE).on(table.planId, table.capabilityId),
]);

defineSecurityPolicies(treatmentPlanMoves, treatmentPlanTenantIsolationPolicy);
