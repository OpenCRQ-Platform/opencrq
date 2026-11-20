import type {
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
} from '@app/module/client';
import { t } from '@lingui/core/macro';

interface BandOption<T extends string> {
  value: T,
  label: string,
}

/**
 * The one label set every band control and the read-only summary both read, evaluated at call time
 * (never at module scope) so each label resolves after locale activation.
 */
export const operatingDaysBandOptions = (): Array<BandOption<typeof OPERATING_DAYS_BAND_VALUES[number]>> => [
  { value: 'about_250', label: t`~250 (5 days / 7)` },
  { value: 'about_300', label: t`~300 (6 days / 7)` },
  { value: 'continuous_365', label: t`365 (continuous)` },
];

export const timeToRevenueImpactBandOptions = (): Array<BandOption<typeof TIME_TO_REVENUE_IMPACT_BAND_VALUES[number]>> => [
  { value: 'under_6h', label: t`< 6h` },
  { value: '6_12h', label: t`6 – 12h` },
  { value: '12_24h', label: t`12 – 24h` },
  { value: '24_48h', label: t`24 – 48h` },
  { value: 'over_48h', label: t`> 48h` },
];

export const fullRestoreBandOptions = (): Array<BandOption<typeof FULL_RESTORE_BAND_VALUES[number]>> => [
  { value: 'under_1d', label: t`< 1 day` },
  { value: '1_3d', label: t`1 – 3 days` },
  { value: '3_7d', label: t`3 – 7 days` },
  { value: '1_2w', label: t`1 – 2 weeks` },
  { value: 'over_2w', label: t`> 2 weeks` },
  { value: 'unknown', label: t`Unknown` },
];

export const revenueRecaptureBandOptions = (): Array<BandOption<typeof REVENUE_RECAPTURE_BAND_VALUES[number]>> => [
  { value: 'mostly_lost', label: t`Mostly lost` },
  { value: 'partly_deferred', label: t`Partly deferred` },
  { value: 'mostly_deferred', label: t`Mostly deferred` },
];

export const individualsBandOptions = (): Array<BandOption<typeof INDIVIDUALS_BAND_VALUES[number]>> => [
  { value: 'under_100k', label: t`< 100k` },
  { value: '100k_500k', label: t`100k – 500k` },
  { value: '500k_1m', label: t`500k – 1M` },
  { value: '1m_5m', label: t`1M – 5M` },
  { value: 'over_5m', label: t`> 5M` },
];

export const cardTransactionsBandOptions = (): Array<BandOption<typeof CARD_TRANSACTIONS_BAND_VALUES[number]>> => [
  { value: 'none', label: t`None` },
  { value: 'under_500k', label: t`< 500k` },
  { value: '500k_5m', label: t`500k – 5M` },
  { value: 'over_5m', label: t`> 5M` },
];

export const sensitiveRecordsBandOptions = (): Array<BandOption<typeof SENSITIVE_RECORDS_BAND_VALUES[number]>> => [
  { value: 'none', label: t`None` },
  { value: 'under_100k', label: t`< 100k` },
  { value: '100k_1m', label: t`100k – 1M` },
  { value: 'over_1m', label: t`> 1M` },
];

export const customerCountBandOptions = (): Array<BandOption<typeof CUSTOMER_COUNT_BAND_VALUES[number]>> => [
  { value: 'under_1k', label: t`< 1k` },
  { value: '1k_10k', label: t`1k – 10k` },
  { value: '10k_100k', label: t`10k – 100k` },
  { value: '100k_1m', label: t`100k – 1M` },
  { value: 'over_1m', label: t`> 1M` },
];

export const contractedRevenueBandOptions = (): Array<BandOption<typeof CONTRACTED_REVENUE_BAND_VALUES[number]>> => [
  { value: 'none', label: t`None` },
  { value: 'under_25', label: t`< 25%` },
  { value: '25_75', label: t`25 – 75%` },
  { value: 'over_75', label: t`> 75%` },
];

export const paymentFlowBandOptions = (): Array<BandOption<typeof PAYMENT_FLOW_BAND_VALUES[number]>> => [
  { value: 'under_100k', label: t`< $100k` },
  { value: '100k_500k', label: t`$100k – $500k` },
  { value: '500k_1m', label: t`$500k – $1M` },
  { value: '1m_5m', label: t`$1M – $5M` },
  { value: 'over_5m', label: t`> $5M` },
];

export const rdIpValueBandOptions = (): Array<BandOption<typeof RD_IP_VALUE_BAND_VALUES[number]>> => [
  { value: 'none', label: t`None` },
  { value: 'under_2', label: t`< 2% of revenue` },
  { value: '2_8', label: t`2 – 8% of revenue` },
  { value: 'over_8', label: t`> 8% of revenue` },
];

export const restoreTestRecencyOptions = (): Array<BandOption<typeof RESTORE_TEST_RECENCY_VALUES[number]>> => [
  { value: 'within_12m', label: t`Tested within 12 months` },
  { value: 'over_12m', label: t`Tested over 12 months ago` },
  { value: 'never', label: t`Never tested` },
];

export const regulatoryRegimeOptions = (): Array<BandOption<typeof REGULATORY_REGIME_VALUES[number]>> => [
  { value: 'none', label: t`None` },
  { value: 'nis2_essential', label: t`NIS2 essential` },
  { value: 'nis2_important', label: t`NIS2 important` },
  { value: 'dora', label: t`DORA` },
  { value: 'other_sectoral', label: t`Other sectoral supervision` },
];

export const largestRepositoryBandOptions = (): Array<BandOption<typeof LARGEST_REPOSITORY_BAND_VALUES[number]>> => [
  { value: 'under_100k', label: t`< 100k` },
  { value: '100k_500k', label: t`100k – 500k` },
  { value: '500k_1m', label: t`500k – 1M` },
  { value: '1m_5m', label: t`1M – 5M` },
  { value: 'over_5m', label: t`> 5M` },
];

export const contractualLiabilityCapBandOptions = (): Array<BandOption<typeof CONTRACTUAL_LIABILITY_CAP_BAND_VALUES[number]>> => [
  { value: 'under_25', label: t`< 25% of contracted revenue` },
  { value: '25_100', label: t`25 – 100% of contracted revenue` },
  { value: '100_200', label: t`100 – 200% of contracted revenue` },
  { value: 'over_200', label: t`> 200% of contracted revenue` },
  { value: 'no_cap', label: t`No cap` },
];

export const worstOutageBandOptions = (): Array<BandOption<typeof WORST_OUTAGE_BAND_VALUES[number]>> => [
  { value: 'none', label: t`None` },
  { value: 'under_1d', label: t`< 1 day` },
  { value: '1_3d', label: t`1 – 3 days` },
  { value: '3_7d', label: t`3 – 7 days` },
  { value: '1_2w', label: t`1 – 2 weeks` },
  { value: 'over_2w', label: t`> 2 weeks` },
];

export const costliestIncidentBandOptions = (): Array<BandOption<typeof COSTLIEST_INCIDENT_BAND_VALUES[number]>> => [
  { value: 'none', label: t`None` },
  { value: 'under_25k', label: t`< $25k` },
  { value: '25k_100k', label: t`$25k – $100k` },
  { value: '100k_500k', label: t`$100k – $500k` },
  { value: '500k_2m', label: t`$500k – $2M` },
  { value: 'over_2m', label: t`> $2M` },
];

const labelFromOptions = <T extends string>(options: ReadonlyArray<BandOption<T>>, value: T | null): string | null => {
  if (value === null) {
    return null;
  }
  return options.find((option) => option.value === value)?.label ?? null;
};

export const operatingDaysBandLabel = (value: typeof OPERATING_DAYS_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(operatingDaysBandOptions(), value);
export const timeToRevenueImpactBandLabel = (value: typeof TIME_TO_REVENUE_IMPACT_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(timeToRevenueImpactBandOptions(), value);
export const fullRestoreBandLabel = (value: typeof FULL_RESTORE_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(fullRestoreBandOptions(), value);
export const revenueRecaptureBandLabel = (value: typeof REVENUE_RECAPTURE_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(revenueRecaptureBandOptions(), value);
export const individualsBandLabel = (value: typeof INDIVIDUALS_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(individualsBandOptions(), value);
export const cardTransactionsBandLabel = (value: typeof CARD_TRANSACTIONS_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(cardTransactionsBandOptions(), value);
export const sensitiveRecordsBandLabel = (value: typeof SENSITIVE_RECORDS_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(sensitiveRecordsBandOptions(), value);
export const customerCountBandLabel = (value: typeof CUSTOMER_COUNT_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(customerCountBandOptions(), value);
export const contractedRevenueBandLabel = (value: typeof CONTRACTED_REVENUE_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(contractedRevenueBandOptions(), value);
export const paymentFlowBandLabel = (value: typeof PAYMENT_FLOW_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(paymentFlowBandOptions(), value);
export const rdIpValueBandLabel = (value: typeof RD_IP_VALUE_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(rdIpValueBandOptions(), value);
export const restoreTestRecencyLabel = (value: typeof RESTORE_TEST_RECENCY_VALUES[number] | null): string | null =>
  labelFromOptions(restoreTestRecencyOptions(), value);
export const regulatoryRegimeLabel = (value: typeof REGULATORY_REGIME_VALUES[number] | null): string | null =>
  labelFromOptions(regulatoryRegimeOptions(), value);
export const largestRepositoryBandLabel = (value: typeof LARGEST_REPOSITORY_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(largestRepositoryBandOptions(), value);
export const contractualLiabilityCapBandLabel = (value: typeof CONTRACTUAL_LIABILITY_CAP_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(contractualLiabilityCapBandOptions(), value);
export const worstOutageBandLabel = (value: typeof WORST_OUTAGE_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(worstOutageBandOptions(), value);
export const costliestIncidentBandLabel = (value: typeof COSTLIEST_INCIDENT_BAND_VALUES[number] | null): string | null =>
  labelFromOptions(costliestIncidentBandOptions(), value);
