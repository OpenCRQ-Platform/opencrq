import type { financialProfiles } from '../../modules/financial-profiles/schema';
import { FinancialProfile_AcmeCorp, Organization_AcmeCorp, Tenant_Acme } from './ids';

/**
 * The select row rather than the insert one, minus the columns the seeder stamps: a reference
 * profile that answers the whole question set cannot let a card go missing by omission.
 */
type SeedFinancialProfile = Omit<typeof financialProfiles.$inferSelect, 'updatedAt'>;

/**
 * A fully-answered profile for Acme Bank (revenue band `1b_10b`, USA): exercises the whole
 * question set — including both severity gates open — in manual e2e testing.
 * The six-hour tolerance against a one-to-three-day restore trips the MTD/RTO warning on
 * purpose: it is a real continuity gap for a bank, and the reference profile should show it.
 *
 * The contracted-revenue and R&D bands are a bank's, not a software vendor's: a retail bank
 * earns most of its revenue outside SLA-backed contracts and spends little of it on research.
 * Answered a tier higher, each fed a driver whose likely alone reached 5% of turnover, and the
 * reference profile tripped the platform's own plausibility warning out of the box.
 */
export const acmeCorpFinancialProfile: SeedFinancialProfile = {
  id: FinancialProfile_AcmeCorp,
  tenantId: Tenant_Acme,
  organizationId: Organization_AcmeCorp,
  loadedDailyLabourCost: 520,
  annualRevenue: 3_200_000_000,
  grossMarginPct: 42,
  operatingDaysBand: 'continuous_365',
  seasonalPeakPct: 15,
  itDependentRevenuePct: 85,
  timeToRevenueImpactBand: 'under_6h',
  fullRestoreBand: '1_3d',
  revenueRecaptureBand: 'partly_deferred',
  restoreTestRecency: 'within_12m',
  recordsHeldGate: true,
  individualsBand: '1m_5m',
  cardTransactionsBand: '500k_5m',
  sensitiveRecordsBand: '100k_1m',
  largestRepositoryBand: '500k_1m',
  regulatoryRegime: 'dora',
  customerCountBand: 'over_1m',
  b2cRevenuePct: 60,
  recurringRevenuePct: 35,
  contractedRevenueBand: 'under_25',
  contractualLiabilityCapBand: '100_200',
  paymentFlowDailyValueBand: '1m_5m',
  outOfBandVerificationGate: true,
  outOfBandThreshold: 50_000,
  rdIpValueBand: 'under_2',
  ransomPaymentPosture: true,
  ransomPaymentCeiling: 1_900_000,
  worstOutageBand: '1_3d',
  costliestIncidentBand: '500k_2m',
  coefficientSetVersion: null,
};
