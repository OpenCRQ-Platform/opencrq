import { z } from 'zod';
import {
  CARD_TRANSACTIONS_BAND_VALUES,
  CONTRACTED_REVENUE_BAND_VALUES,
  CONTRACTUAL_LIABILITY_CAP_BAND_VALUES,
  COSTLIEST_INCIDENT_BAND_VALUES,
  CUSTOMER_COUNT_BAND_VALUES,
  FULL_RESTORE_BAND_VALUES,
  INDIVIDUALS_BAND_VALUES,
  LARGEST_REPOSITORY_BAND_VALUES,
  OPERATING_DAYS_BAND_VALUES,
  PAYMENT_FLOW_BAND_VALUES,
  RD_IP_VALUE_BAND_VALUES,
  REGULATORY_REGIME_VALUES,
  RESTORE_TEST_RECENCY_VALUES,
  REVENUE_RECAPTURE_BAND_VALUES,
  SENSITIVE_RECORDS_BAND_VALUES,
  TIME_TO_REVENUE_IMPACT_BAND_VALUES,
  WORST_OUTAGE_BAND_VALUES,
} from './constants';

/**
 * The ceiling of every amount the questionnaire asks, in USD: above any organization's figures, and
 * under the 48-bit bound drizzle-zod gives a double precision column when the profile is read back,
 * so an amount that saves can always be read.
 */
export const MAX_FINANCIAL_AMOUNT_USD = 10_000_000_000_000;

/**
 * The questionnaire's answers with their bounds, declared once. Both surfaces validate through
 * this: the tRPC input on the way in, and the form on the way to it, so a bound cannot hold on one
 * side of the wire and not the other. Zod and the band tuples only — no Drizzle — so the browser
 * bundle can import it through `@app/module/client`.
 */
export const financialProfileAnswersSchema = z.object({
  loadedDailyLabourCost: z.number().nonnegative().max(MAX_FINANCIAL_AMOUNT_USD).nullable(),
  annualRevenue: z.number().positive().max(MAX_FINANCIAL_AMOUNT_USD).nullable(),
  grossMarginPct: z.number().min(0).max(100).nullable(),
  operatingDaysBand: z.enum(OPERATING_DAYS_BAND_VALUES).nullable(),
  seasonalPeakPct: z.number().min(0).max(100).nullable(),
  itDependentRevenuePct: z.number().min(0).max(100).nullable(),
  timeToRevenueImpactBand: z.enum(TIME_TO_REVENUE_IMPACT_BAND_VALUES).nullable(),
  fullRestoreBand: z.enum(FULL_RESTORE_BAND_VALUES).nullable(),
  revenueRecaptureBand: z.enum(REVENUE_RECAPTURE_BAND_VALUES).nullable(),
  restoreTestRecency: z.enum(RESTORE_TEST_RECENCY_VALUES).nullable(),
  recordsHeldGate: z.boolean().nullable(),
  individualsBand: z.enum(INDIVIDUALS_BAND_VALUES).nullable(),
  cardTransactionsBand: z.enum(CARD_TRANSACTIONS_BAND_VALUES).nullable(),
  sensitiveRecordsBand: z.enum(SENSITIVE_RECORDS_BAND_VALUES).nullable(),
  largestRepositoryBand: z.enum(LARGEST_REPOSITORY_BAND_VALUES).nullable(),
  regulatoryRegime: z.enum(REGULATORY_REGIME_VALUES).nullable(),
  customerCountBand: z.enum(CUSTOMER_COUNT_BAND_VALUES).nullable(),
  b2cRevenuePct: z.number().min(0).max(100).nullable(),
  recurringRevenuePct: z.number().min(0).max(100).nullable(),
  contractedRevenueBand: z.enum(CONTRACTED_REVENUE_BAND_VALUES).nullable(),
  contractualLiabilityCapBand: z.enum(CONTRACTUAL_LIABILITY_CAP_BAND_VALUES).nullable(),
  paymentFlowDailyValueBand: z.enum(PAYMENT_FLOW_BAND_VALUES).nullable(),
  outOfBandVerificationGate: z.boolean().nullable(),
  outOfBandThreshold: z.number().positive().max(MAX_FINANCIAL_AMOUNT_USD).nullable(),
  rdIpValueBand: z.enum(RD_IP_VALUE_BAND_VALUES).nullable(),
  ransomPaymentPosture: z.boolean().nullable(),
  ransomPaymentCeiling: z.number().positive().max(MAX_FINANCIAL_AMOUNT_USD).nullable(),
  worstOutageBand: z.enum(WORST_OUTAGE_BAND_VALUES).nullable(),
  costliestIncidentBand: z.enum(COSTLIEST_INCIDENT_BAND_VALUES).nullable(),
});

export type FinancialProfileAnswers = z.infer<typeof financialProfileAnswersSchema>;

export const FINANCIAL_PROFILE_ANSWER_FIELDS = financialProfileAnswersSchema.keyof().options;

export type FinancialProfileAnswerField = typeof FINANCIAL_PROFILE_ANSWER_FIELDS[number];

/** Every answer blank: the shape a save expects, and what an unanswered questionnaire starts from. */
export const EMPTY_FINANCIAL_PROFILE_ANSWERS: FinancialProfileAnswers = {
  loadedDailyLabourCost: null,
  annualRevenue: null,
  grossMarginPct: null,
  operatingDaysBand: null,
  seasonalPeakPct: null,
  itDependentRevenuePct: null,
  timeToRevenueImpactBand: null,
  fullRestoreBand: null,
  revenueRecaptureBand: null,
  restoreTestRecency: null,
  recordsHeldGate: null,
  individualsBand: null,
  cardTransactionsBand: null,
  sensitiveRecordsBand: null,
  largestRepositoryBand: null,
  regulatoryRegime: null,
  customerCountBand: null,
  b2cRevenuePct: null,
  recurringRevenuePct: null,
  contractedRevenueBand: null,
  contractualLiabilityCapBand: null,
  paymentFlowDailyValueBand: null,
  outOfBandVerificationGate: null,
  outOfBandThreshold: null,
  rdIpValueBand: null,
  ransomPaymentPosture: null,
  ransomPaymentCeiling: null,
  worstOutageBand: null,
  costliestIncidentBand: null,
};
