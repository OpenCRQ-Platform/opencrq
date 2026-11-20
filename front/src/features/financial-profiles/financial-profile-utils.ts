import { t } from '@lingui/core/macro';
import type { QuestionId, RevenueBand } from '@app/module/client';
import { deriveRevenueBand, FULL_RESTORE_DAYS, TIME_TO_REVENUE_IMPACT_DAYS } from '@app/module/client';
import type { FinancialProfileAnswers } from './financial-profile-schema';
import { formatAtMost, formatNumber, formatPointsAsPercentAtMost } from '../../utils/format-number';
import {
  cardTransactionsBandLabel,
  contractedRevenueBandLabel,
  contractualLiabilityCapBandLabel,
  costliestIncidentBandLabel,
  customerCountBandLabel,
  fullRestoreBandLabel,
  individualsBandLabel,
  largestRepositoryBandLabel,
  operatingDaysBandLabel,
  paymentFlowBandLabel,
  rdIpValueBandLabel,
  regulatoryRegimeLabel,
  restoreTestRecencyLabel,
  revenueRecaptureBandLabel,
  sensitiveRecordsBandLabel,
  timeToRevenueImpactBandLabel,
  worstOutageBandLabel,
} from './financial-profile-band-labels';

/** Q1: an entered amount rewrites the displayed band. */
export const bandFromRevenueAmount = (amountUsd: number): RevenueBand => deriveRevenueBand(amountUsd);

const yesNoLabel = (value: boolean | null): string | null => (value === null ? null : (value ? t`Yes` : t`No`));

/** The read summary of one question's answer, shared by the questionnaire card and the read-only tab. */
export const answerSummary = (id: QuestionId, values: FinancialProfileAnswers): string => {
  switch (id) {
    case 'Q1': return values.annualRevenue !== null ? `${formatNumber(values.annualRevenue)} USD` : '';
    case 'Q2': return values.grossMarginPct !== null ? formatPointsAsPercentAtMost(values.grossMarginPct, 3) : '';
    case 'Q3': {
      const operatingDays = operatingDaysBandLabel(values.operatingDaysBand);
      const peakPct = values.seasonalPeakPct === null ? null : formatAtMost(values.seasonalPeakPct, 3);
      const seasonalPeak = peakPct !== null ? t`${peakPct}% seasonal peak` : null;
      return [operatingDays, seasonalPeak].filter((part) => part !== null).join(' · ');
    }
    case 'Q5': return values.itDependentRevenuePct !== null ? formatPointsAsPercentAtMost(values.itDependentRevenuePct, 3) : '';
    case 'Q6': return timeToRevenueImpactBandLabel(values.timeToRevenueImpactBand) ?? '';
    case 'Q7': return fullRestoreBandLabel(values.fullRestoreBand) ?? '';
    case 'Q8': return revenueRecaptureBandLabel(values.revenueRecaptureBand) ?? '';
    case 'Q16': return restoreTestRecencyLabel(values.restoreTestRecency) ?? '';
    case 'Q9a': return [
      yesNoLabel(values.recordsHeldGate),
      individualsBandLabel(values.individualsBand),
    ].filter((part): part is string => Boolean(part)).join(' · ');
    case 'Q9b': return cardTransactionsBandLabel(values.cardTransactionsBand) ?? '';
    case 'Q9c': return sensitiveRecordsBandLabel(values.sensitiveRecordsBand) ?? '';
    case 'Q20': return largestRepositoryBandLabel(values.largestRepositoryBand) ?? '';
    case 'Q10': return regulatoryRegimeLabel(values.regulatoryRegime) ?? '';
    case 'Q11a': return [
      customerCountBandLabel(values.customerCountBand),
      values.b2cRevenuePct !== null ? formatPointsAsPercentAtMost(values.b2cRevenuePct, 3) : null,
    ].filter((part): part is string => Boolean(part)).join(' · ');
    case 'Q11b': return values.recurringRevenuePct !== null ? formatPointsAsPercentAtMost(values.recurringRevenuePct, 3) : '';
    case 'Q12': return contractedRevenueBandLabel(values.contractedRevenueBand) ?? '';
    case 'Q19': return contractualLiabilityCapBandLabel(values.contractualLiabilityCapBand) ?? '';
    case 'Q13': return [
      paymentFlowBandLabel(values.paymentFlowDailyValueBand),
      yesNoLabel(values.outOfBandVerificationGate),
      values.outOfBandThreshold !== null ? `${formatNumber(values.outOfBandThreshold)} USD` : null,
    ].filter((part): part is string => Boolean(part)).join(' · ');
    case 'Q14': return rdIpValueBandLabel(values.rdIpValueBand) ?? '';
    case 'Q15': return [
      yesNoLabel(values.ransomPaymentPosture),
      values.ransomPaymentCeiling !== null ? `${formatNumber(values.ransomPaymentCeiling)} USD` : null,
    ].filter((part): part is string => Boolean(part)).join(' · ');
    case 'Q18': return [
      worstOutageBandLabel(values.worstOutageBand),
      costliestIncidentBandLabel(values.costliestIncidentBand),
    ].filter((part): part is string => Boolean(part)).join(' · ');
    default: return '';
  }
};

/**
 * The questionnaire's only pair check: both bands are targets the organization sets, and a plan that
 * restores later than the business can bear contradicts itself. Four times spares the mildest
 * plausible mismatch and still catches "impact from six hours, restore in two weeks". An unknown
 * RTO, or either band blank, fires nothing — a blank is a legitimate end state.
 */
export const isMtdRtoInconsistent = (
  values: Pick<FinancialProfileAnswers, 'timeToRevenueImpactBand' | 'fullRestoreBand'>,
): boolean => {
  const { timeToRevenueImpactBand: mtd, fullRestoreBand: rto } = values;
  if (mtd === null || rto === null || rto === 'unknown') {
    return false;
  }
  return FULL_RESTORE_DAYS[rto] > 4 * TIME_TO_REVENUE_IMPACT_DAYS[mtd];
};
