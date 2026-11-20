import { EMPTY_FINANCIAL_PROFILE_ANSWERS } from '@app/module';

/** Every questionnaire answer blank: the shape a save expects, for a test to override one field of. */
export const EMPTY_ANSWERS = EMPTY_FINANCIAL_PROFILE_ANSWERS;

/** A profile with every band answered, so the always-activated D1.1 driver has the inputs its
 * formula needs and a run genuinely derives at least one estimate. */
export const FULLY_ANSWERED_PROFILE_ANSWERS = {
  loadedDailyLabourCost: 350,
  annualRevenue: 30_000_000,
  grossMarginPct: 40,
  operatingDaysBand: 'about_250' as const,
  seasonalPeakPct: 20,
  itDependentRevenuePct: 80,
  timeToRevenueImpactBand: '12_24h' as const,
  fullRestoreBand: '3_7d' as const,
  revenueRecaptureBand: 'partly_deferred' as const,
  recordsHeldGate: true,
  individualsBand: '100k_500k' as const,
  cardTransactionsBand: 'under_500k' as const,
  sensitiveRecordsBand: 'under_100k' as const,
  regulatoryRegime: 'none' as const,
  customerCountBand: '1k_10k' as const,
  b2cRevenuePct: 40,
  recurringRevenuePct: 30,
  contractedRevenueBand: '25_75' as const,
  paymentFlowDailyValueBand: '100k_500k' as const,
  outOfBandVerificationGate: false,
  outOfBandThreshold: 100_000,
  rdIpValueBand: '2_8' as const,
  ransomPaymentPosture: true,
  ransomPaymentCeiling: 500_000,
  restoreTestRecency: null,
  largestRepositoryBand: null,
  contractualLiabilityCapBand: null,
  worstOutageBand: null,
  costliestIncidentBand: null,
};
