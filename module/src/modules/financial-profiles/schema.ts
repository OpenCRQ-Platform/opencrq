import { boolean, doublePrecision, foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  CardTransactionsBand,
  ContractedRevenueBand,
  ContractualLiabilityCapBand,
  CostliestIncidentBand,
  CustomerCountBand,
  FullRestoreBand,
  IndividualsBand,
  LargestRepositoryBand,
  OperatingDaysBand,
  PaymentFlowBand,
  RdIpValueBand,
  RegulatoryRegime,
  RestoreTestRecency,
  RevenueRecaptureBand,
  SensitiveRecordsBand,
  TimeToRevenueImpactBand,
  WorstOutageBand,
} from './constants';
import type { FinancialProfileAnswerField } from './validation';
import { journalCreatedAt } from '../../db/journal-value';
import { defineSecurityPolicies, organizationTenantIsolationPolicy, tenantIsolationPolicy } from '../../security';
import { organizations } from '../organizations/schema';
import { tenants } from '../tenants';
import { users } from '../users/schema';

/**
 * One row per organization: every answer column is nullable so an organization can save a
 * partially-answered questionnaire. `coefficientSetVersion` stays null until the derivation
 * kernel first writes it.
 */
export const financialProfiles = pgTable('financial_profiles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  // Header — the one editable platform default, alongside the read-only organization fields.
  loadedDailyLabourCost: doublePrecision('loaded_daily_labour_cost'),

  // A. Revenue and margin
  annualRevenue: doublePrecision('annual_revenue'),
  grossMarginPct: doublePrecision('gross_margin_pct'),
  operatingDaysBand: text('operating_days_band').$type<OperatingDaysBand>(),
  seasonalPeakPct: doublePrecision('seasonal_peak_pct'),

  // B. Digital dependency
  itDependentRevenuePct: doublePrecision('it_dependent_revenue_pct'),
  timeToRevenueImpactBand: text('time_to_revenue_impact_band').$type<TimeToRevenueImpactBand>(),
  fullRestoreBand: text('full_restore_band').$type<FullRestoreBand>(),
  revenueRecaptureBand: text('revenue_recapture_band').$type<RevenueRecaptureBand>(),
  restoreTestRecency: text('restore_test_recency').$type<RestoreTestRecency>(),

  // C. Data held
  recordsHeldGate: boolean('records_held_gate'),
  individualsBand: text('individuals_band').$type<IndividualsBand>(),
  cardTransactionsBand: text('card_transactions_band').$type<CardTransactionsBand>(),
  sensitiveRecordsBand: text('sensitive_records_band').$type<SensitiveRecordsBand>(),
  largestRepositoryBand: text('largest_repository_band').$type<LargestRepositoryBand>(),

  // D. Regulatory
  regulatoryRegime: text('regulatory_regime').$type<RegulatoryRegime>(),

  // E. Customers and contracts
  customerCountBand: text('customer_count_band').$type<CustomerCountBand>(),
  b2cRevenuePct: doublePrecision('b2c_revenue_pct'),
  recurringRevenuePct: doublePrecision('recurring_revenue_pct'),
  contractedRevenueBand: text('contracted_revenue_band').$type<ContractedRevenueBand>(),
  contractualLiabilityCapBand: text('contractual_liability_cap_band').$type<ContractualLiabilityCapBand>(),

  // F. Funds and IP
  paymentFlowDailyValueBand: text('payment_flow_daily_value_band').$type<PaymentFlowBand>(),
  outOfBandVerificationGate: boolean('out_of_band_verification_gate'),
  outOfBandThreshold: doublePrecision('out_of_band_threshold'),
  rdIpValueBand: text('rd_ip_value_band').$type<RdIpValueBand>(),

  // G. Extortion
  ransomPaymentPosture: boolean('ransom_payment_posture'),
  ransomPaymentCeiling: doublePrecision('ransom_payment_ceiling'),

  // H. Loss history
  worstOutageBand: text('worst_outage_band').$type<WorstOutageBand>(),
  costliestIncidentBand: text('costliest_incident_band').$type<CostliestIncidentBand>(),

  coefficientSetVersion: text('coefficient_set_version'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * When a recompute last derived this scope's scenarios, stamped inside that recompute's own
   * transaction. Read against `updatedAt` to tell answers that have moved on from answers the
   * derived amounts already reflect — which is how the Financial Impact page knows the figures in
   * front of the reader are about to be rewritten. Null until the first recompute.
   *
   * Not inferred from the rows' own timestamps: a recompute that finds every derived value
   * unchanged writes no row, and that comparison would then read stale for good.
   */
}, (table) => [
  unique('financial_profiles_organization_id_unique').on(table.organizationId),
]);

defineSecurityPolicies(financialProfiles, tenantIsolationPolicy, organizationTenantIsolationPolicy);

/** One answer changed by one save, its value before and after as `encodeJournalValue` writes it; null is no answer. */
export const financialProfileEvents = pgTable('financial_profile_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
  field: text('field').notNull().$type<FinancialProfileAnswerField>(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: journalCreatedAt(),
}, (table) => [
  foreignKey({
    name: 'financial_profile_events_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
  index('financial_profile_events_organization_date_idx').on(table.organizationId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
]);

defineSecurityPolicies(financialProfileEvents, tenantIsolationPolicy);
