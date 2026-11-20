import { boolean, doublePrecision, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, riskScenarioTenantIsolationPolicy } from '../../security';
import { lossDrivers } from '../loss-drivers/schema';
import { riskScenarios } from '../risk-scenarios/schema';

/** `manual`: a person typed this value. `questionnaire`: the derivation kernel produced it. */
export const PROVENANCE_VALUES = ['manual', 'questionnaire'] as const;
export type Provenance = typeof PROVENANCE_VALUES[number];

export const scenarioLossEstimates = pgTable('scenario_loss_estimates', {
  id: uuid('id').primaryKey(),
  riskScenarioId: uuid('risk_scenario_id').notNull().references(() => riskScenarios.id, { onDelete: 'cascade' }),
  lossDriverId: uuid('loss_driver_id').notNull().references(() => lossDrivers.id, { onDelete: 'cascade' }),
  minValue: doublePrecision('min_value'),
  likelyValue: doublePrecision('likely_value'),
  maxValue: doublePrecision('max_value'),
  provenance: text('provenance').notNull().default('manual').$type<Provenance>(),
  /** The coefficient-set version that produced this row; null on a manual row. */
  modelVersion: text('model_version'),
  /** The kernel's own verdict at derivation time, carried onto the row; always false on a manual row. */
  lowConfidence: boolean('low_confidence').notNull().default(false),
  /** The explicit ransom-refusal `(0, 0, 0)` triplet the kernel emits; always false outside that one case. */
  isPosture: boolean('is_posture').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique().on(table.riskScenarioId, table.lossDriverId),
]);

defineSecurityPolicies(scenarioLossEstimates, riskScenarioTenantIsolationPolicy);
