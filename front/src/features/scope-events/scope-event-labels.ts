import type { EstateMode, FinancialProfileAnswerField, OrganizationIdentityField } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { ScopeEventSource } from './scope-events-utils';
import { EMPTY_VALUE } from '../../utils/empty-value';
import { formatNumber, formatPointsAsPercentAtMost } from '../../utils/format-number';
import {
  cardTransactionsBandOptions,
  contractedRevenueBandOptions,
  contractualLiabilityCapBandOptions,
  costliestIncidentBandOptions,
  customerCountBandOptions,
  fullRestoreBandOptions,
  individualsBandOptions,
  largestRepositoryBandOptions,
  operatingDaysBandOptions,
  paymentFlowBandOptions,
  rdIpValueBandOptions,
  regulatoryRegimeOptions,
  restoreTestRecencyOptions,
  revenueRecaptureBandOptions,
  sensitiveRecordsBandOptions,
  timeToRevenueImpactBandOptions,
  worstOutageBandOptions,
} from '../financial-profiles/financial-profile-band-labels';
import { QUESTION_LABELS } from '../financial-profiles/financial-profile-questions';

export type JournalValue = string | number | boolean | ReadonlyArray<number | null> | null;

export const scopeEventSourceLabel = (source: ScopeEventSource): string => {
  switch (source) {
    case 'identity': return t`Identity`;
    case 'financialProfile': return t`Financial profile`;
    case 'declaredEstate': return t`Declared estate`;
    case 'assets': return t`Assets`;
    default: return source;
  }
};

export const noAnswerLabel = (): string => t`No answer`;

const FINANCIAL_FIELD_LABELS: Record<FinancialProfileAnswerField, () => string> = {
  loadedDailyLabourCost: () => t`Loaded daily labour cost`,
  annualRevenue: QUESTION_LABELS.Q1,
  grossMarginPct: QUESTION_LABELS.Q2,
  operatingDaysBand: QUESTION_LABELS.Q3,
  seasonalPeakPct: () => t`Seasonal peak uplift`,
  itDependentRevenuePct: QUESTION_LABELS.Q5,
  timeToRevenueImpactBand: QUESTION_LABELS.Q6,
  fullRestoreBand: QUESTION_LABELS.Q7,
  revenueRecaptureBand: QUESTION_LABELS.Q8,
  restoreTestRecency: QUESTION_LABELS.Q16,
  recordsHeldGate: () => t`Do you hold personal data beyond your own employees?`,
  individualsBand: () => t`Individuals whose data you hold`,
  cardTransactionsBand: QUESTION_LABELS.Q9b,
  sensitiveRecordsBand: QUESTION_LABELS.Q9c,
  largestRepositoryBand: QUESTION_LABELS.Q20,
  regulatoryRegime: QUESTION_LABELS.Q10,
  customerCountBand: () => t`Customer count`,
  b2cRevenuePct: () => t`B2C share`,
  recurringRevenuePct: QUESTION_LABELS.Q11b,
  contractedRevenueBand: QUESTION_LABELS.Q12,
  contractualLiabilityCapBand: QUESTION_LABELS.Q19,
  paymentFlowDailyValueBand: () => t`Daily value of outbound electronic payments`,
  outOfBandVerificationGate: () => t`Approval ceiling above which out-of-band verification is required?`,
  outOfBandThreshold: () => t`Approval ceiling`,
  rdIpValueBand: QUESTION_LABELS.Q14,
  ransomPaymentPosture: () => t`Would your organization pay a ransom?`,
  ransomPaymentCeiling: () => t`Payment ceiling`,
  worstOutageBand: () => t`Worst outage`,
  costliestIncidentBand: () => t`Costliest incident`,
};

export const financialFieldLabel = (field: FinancialProfileAnswerField): string => FINANCIAL_FIELD_LABELS[field]();

const amount = (value: number): string => {
  const formatted = formatNumber(value);
  return t`${formatted} USD`;
};
const yesNo = (value: boolean): string => (value ? t`Yes` : t`No`);

const PERCENT_FIELDS: ReadonlySet<FinancialProfileAnswerField> = new Set(['grossMarginPct', 'seasonalPeakPct', 'itDependentRevenuePct', 'b2cRevenuePct', 'recurringRevenuePct']);

const BAND_OPTIONS: Partial<Record<FinancialProfileAnswerField, () => ReadonlyArray<{ value: string, label: string }>>> = {
  operatingDaysBand: operatingDaysBandOptions,
  timeToRevenueImpactBand: timeToRevenueImpactBandOptions,
  fullRestoreBand: fullRestoreBandOptions,
  revenueRecaptureBand: revenueRecaptureBandOptions,
  restoreTestRecency: restoreTestRecencyOptions,
  individualsBand: individualsBandOptions,
  cardTransactionsBand: cardTransactionsBandOptions,
  sensitiveRecordsBand: sensitiveRecordsBandOptions,
  largestRepositoryBand: largestRepositoryBandOptions,
  regulatoryRegime: regulatoryRegimeOptions,
  customerCountBand: customerCountBandOptions,
  contractedRevenueBand: contractedRevenueBandOptions,
  contractualLiabilityCapBand: contractualLiabilityCapBandOptions,
  paymentFlowDailyValueBand: paymentFlowBandOptions,
  rdIpValueBand: rdIpValueBandOptions,
  worstOutageBand: worstOutageBandOptions,
  costliestIncidentBand: costliestIncidentBandOptions,
};

export const financialValueLabel = (field: FinancialProfileAnswerField, value: JournalValue): string => {
  if (value === null) {
    return noAnswerLabel();
  }
  if (typeof value === 'number') {
    return PERCENT_FIELDS.has(field) ? formatPointsAsPercentAtMost(value, 3) : amount(value);
  }
  if (typeof value === 'boolean') {
    return yesNo(value);
  }
  if (typeof value === 'string') {
    return BAND_OPTIONS[field]?.().find((option) => option.value === value)?.label ?? value;
  }
  return value.join(' / ');
};

const IDENTITY_FIELD_LABELS: Record<OrganizationIdentityField, () => string> = {
  name: () => t`Name`,
  description: () => t`Description`,
  legalEntityName: () => t`Legal Entity Name`,
  domain: () => t`Domain`,
  sectorId: () => t`Sector`,
  countryId: () => t`Country`,
  employeeCount: () => t`Employee Count`,
  reactionTime: () => t`Containment time (MTTC)`,
};

export const identityFieldLabel = (field: OrganizationIdentityField): string => IDENTITY_FIELD_LABELS[field]();

const hours = (value: number | null | undefined): string => (value === null || value === undefined ? EMPTY_VALUE : formatNumber(value));

/** A sector or a country is journaled by id, so its name is looked up now and may be gone. */
export const identityValueLabel = (
  field: OrganizationIdentityField,
  value: JournalValue,
  namesById: ReadonlyMap<string, string>,
): string => {
  if (value === null) {
    return noAnswerLabel();
  }
  if (Array.isArray(value)) {
    const [best, typical, worst] = value;
    const range = `${hours(best)} / ${hours(typical)} / ${hours(worst)}`;
    return t`${range} h`;
  }
  if (field === 'sectorId' || field === 'countryId') {
    return namesById.get(String(value)) ?? (field === 'sectorId' ? t`Deleted sector` : t`Deleted country`);
  }
  return typeof value === 'number' ? formatNumber(value) : String(value);
};

export const estateModeLabel = (mode: EstateMode): string => (mode === 'open' ? t`Whole estate` : t`Mapped assets only`);
