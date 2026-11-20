/** Q3 — operating days per year. */
export const OPERATING_DAYS_BAND_VALUES = ['about_250', 'about_300', 'continuous_365'] as const;
export type OperatingDaysBand = typeof OPERATING_DAYS_BAND_VALUES[number];

/** Q6 — delay before an outage starts costing money. */
export const TIME_TO_REVENUE_IMPACT_BAND_VALUES = ['under_6h', '6_12h', '12_24h', '24_48h', 'over_48h'] as const;
export type TimeToRevenueImpactBand = typeof TIME_TO_REVENUE_IMPACT_BAND_VALUES[number];

/** Q7 — time to full restore, assuming backups are intact. */
export const FULL_RESTORE_BAND_VALUES = ['under_1d', '1_3d', '3_7d', '1_2w', 'over_2w', 'unknown'] as const;
export type FullRestoreBand = typeof FULL_RESTORE_BAND_VALUES[number];

/** Q8 — revenue recapture after the outage. */
export const REVENUE_RECAPTURE_BAND_VALUES = ['mostly_lost', 'partly_deferred', 'mostly_deferred'] as const;
export type RevenueRecaptureBand = typeof REVENUE_RECAPTURE_BAND_VALUES[number];

/** Q16 — restore test recency. */
export const RESTORE_TEST_RECENCY_VALUES = ['within_12m', 'over_12m', 'never'] as const;
export type RestoreTestRecency = typeof RESTORE_TEST_RECENCY_VALUES[number];

/** Q9a — individuals whose personal data is held. */
export const INDIVIDUALS_BAND_VALUES = ['under_100k', '100k_500k', '500k_1m', '1m_5m', 'over_5m'] as const;
export type IndividualsBand = typeof INDIVIDUALS_BAND_VALUES[number];

/** Q9b — card transactions per year. */
export const CARD_TRANSACTIONS_BAND_VALUES = ['none', 'under_500k', '500k_5m', 'over_5m'] as const;
export type CardTransactionsBand = typeof CARD_TRANSACTIONS_BAND_VALUES[number];

/** Q9c — sensitive records (health, biometric, financial identifiers). */
export const SENSITIVE_RECORDS_BAND_VALUES = ['none', 'under_100k', '100k_1m', 'over_1m'] as const;
export type SensitiveRecordsBand = typeof SENSITIVE_RECORDS_BAND_VALUES[number];

/** Q20 — individuals held in the largest single system. */
export const LARGEST_REPOSITORY_BAND_VALUES = ['under_100k', '100k_500k', '500k_1m', '1m_5m', 'over_5m'] as const;
export type LargestRepositoryBand = typeof LARGEST_REPOSITORY_BAND_VALUES[number];

/** Q10 — regulatory regime, pick the strictest that applies. */
export const REGULATORY_REGIME_VALUES = ['none', 'nis2_essential', 'nis2_important', 'dora', 'other_sectoral'] as const;
export type RegulatoryRegime = typeof REGULATORY_REGIME_VALUES[number];

/** Q11 — customer count. */
export const CUSTOMER_COUNT_BAND_VALUES = ['under_1k', '1k_10k', '10k_100k', '100k_1m', 'over_1m'] as const;
export type CustomerCountBand = typeof CUSTOMER_COUNT_BAND_VALUES[number];

/** Q12 — revenue under SLA / breach-liability clauses. */
export const CONTRACTED_REVENUE_BAND_VALUES = ['none', 'under_25', '25_75', 'over_75'] as const;
export type ContractedRevenueBand = typeof CONTRACTED_REVENUE_BAND_VALUES[number];

/** Q19 — aggregate contractual liability cap, as a multiple of Q12's contracted revenue. */
export const CONTRACTUAL_LIABILITY_CAP_BAND_VALUES = ['under_25', '25_100', '100_200', 'over_200', 'no_cap'] as const;
export type ContractualLiabilityCapBand = typeof CONTRACTUAL_LIABILITY_CAP_BAND_VALUES[number];

/** Q13 — outbound electronic payment daily value. */
export const PAYMENT_FLOW_BAND_VALUES = ['under_100k', '100k_500k', '500k_1m', '1m_5m', 'over_5m'] as const;
export type PaymentFlowBand = typeof PAYMENT_FLOW_BAND_VALUES[number];

/** Q14 — R&D / IP value as a share of revenue, or replacement-cost band. */
export const RD_IP_VALUE_BAND_VALUES = ['none', 'under_2', '2_8', 'over_8'] as const;
export type RdIpValueBand = typeof RD_IP_VALUE_BAND_VALUES[number];

/** Q18 — worst outage in the past three years, on the Q7 restore band values. */
export const WORST_OUTAGE_BAND_VALUES = ['none', 'under_1d', '1_3d', '3_7d', '1_2w', 'over_2w'] as const;
export type WorstOutageBand = typeof WORST_OUTAGE_BAND_VALUES[number];

/** Q18 — costliest incident in the past three years. */
export const COSTLIEST_INCIDENT_BAND_VALUES = ['none', 'under_25k', '25k_100k', '100k_500k', '500k_2m', 'over_2m'] as const;
export type CostliestIncidentBand = typeof COSTLIEST_INCIDENT_BAND_VALUES[number];

/** Q6 — MTD band midpoints in days, read by the MTD/RTO consistency check. */
export const TIME_TO_REVENUE_IMPACT_DAYS: Record<TimeToRevenueImpactBand, number> = {
  under_6h: 0.125,
  '6_12h': 0.375,
  '12_24h': 0.75,
  '24_48h': 1.5,
  over_48h: 2.5,
};

/** Q7 — RTO band midpoints in days, read by both consistency checks. An unknown RTO is a compile-time non-participant. */
export const FULL_RESTORE_DAYS: Record<Exclude<FullRestoreBand, 'unknown'>, number> = {
  under_1d: 0.5,
  '1_3d': 2,
  '3_7d': 5,
  '1_2w': 10.5,
  over_2w: 21,
};

/** Q18 — revealed worst-outage band midpoints in days, read by the revealed-outage consistency check. */
export const WORST_OUTAGE_DAYS: Record<WorstOutageBand, number> = {
  none: 0,
  under_1d: 0.5,
  '1_3d': 2,
  '3_7d': 5,
  '1_2w': 10.5,
  over_2w: 21,
};
