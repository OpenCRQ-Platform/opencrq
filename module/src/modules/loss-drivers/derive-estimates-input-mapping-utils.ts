import type {
  CardTransactionsBand,
  ContractedRevenueBand as ProfileContractedRevenueBand,
  FullRestoreBand as ProfileFullRestoreBand,
  IndividualsBand,
  LargestRepositoryBand,
  OperatingDaysBand as ProfileOperatingDaysBand,
  PaymentFlowBand,
  RdIpValueBand as ProfileRdIpValueBand,
  RevenueRecaptureBand as ProfileRevenueRecaptureBand,
  SensitiveRecordsBand,
  TimeToRevenueImpactBand as ProfileTimeToRevenueImpactBand,
  WorstOutageBand as ProfileWorstOutageBand,
} from '../financial-profiles/constants';
import type { DeclaredEstateKind, DeclaredEstateLossKind } from '../declared-estate/constants';
import type { financialProfiles } from '../financial-profiles/schema';
import type { organizations } from '../organizations/schema';
import type {
  CountRange,
  FinancialProfileInput,
  KernelContractedRevenueBand,
  KernelFullRestoreBand,
  KernelOperatingDaysBand,
  KernelRevenueRecaptureBand,
  KernelTimeToRevenueImpactBand,
  KernelWorstOutageBand,
  MagnitudeBand,
  OrganizationInput,
} from './derive-estimates-types';

type FinancialProfileRow = typeof financialProfiles.$inferSelect;
type DeclaredEstateRow = { kind: DeclaredEstateKind, low: number, high: number };
type OrganizationRow = Pick<typeof organizations.$inferSelect, 'revenueBand' | 'employeeCount'> & { countryIsoAlpha3?: string | null };

const mapNullable = <TFrom extends string, TTo>(value: TFrom | null, table: Record<TFrom, TTo>): TTo | null =>
  value === null ? null : table[value];

const OPERATING_DAYS_BAND_MAP: Record<ProfileOperatingDaysBand, KernelOperatingDaysBand> = {
  about_250: 'five_of_seven',
  about_300: 'six_of_seven',
  continuous_365: 'continuous',
};

export const TIME_TO_REVENUE_IMPACT_BAND_MAP: Record<ProfileTimeToRevenueImpactBand, KernelTimeToRevenueImpactBand> = {
  under_6h: 'under_6h',
  '6_12h': '6_to_12h',
  '12_24h': '12_to_24h',
  '24_48h': '24_to_48h',
  over_48h: 'over_48h',
};

export const FULL_RESTORE_BAND_MAP: Record<ProfileFullRestoreBand, KernelFullRestoreBand> = {
  under_1d: 'under_1d',
  '1_3d': '1_to_3d',
  '3_7d': '3_to_7d',
  '1_2w': '1_to_2w',
  over_2w: 'over_2w',
  unknown: 'unknown',
};

/** The same durations as the restore band, plus the `none` the restore band has no use for. */
export const WORST_OUTAGE_BAND_MAP: Record<ProfileWorstOutageBand, KernelWorstOutageBand> = {
  none: 'none',
  under_1d: 'under_1d',
  '1_3d': '1_to_3d',
  '3_7d': '3_to_7d',
  '1_2w': '1_to_2w',
  over_2w: 'over_2w',
};

const REVENUE_RECAPTURE_BAND_MAP: Record<ProfileRevenueRecaptureBand, KernelRevenueRecaptureBand> = {
  mostly_lost: 'mostly_lost',
  partly_deferred: 'partly_deferred',
  mostly_deferred: 'mostly_deferred',
};

const CONTRACTED_REVENUE_BAND_MAP: Record<ProfileContractedRevenueBand, KernelContractedRevenueBand> = {
  none: 'none',
  under_25: 'under_25',
  '25_75': '25_to_75',
  over_75: 'over_75',
};

/**
 * `individualsBand` is the one profile magnitude band whose buckets already line up 1:1 with the
 * kernel's `MagnitudeBand` (it never carries a `none` value; a blank answer is `null`, not a band).
 */
const INDIVIDUALS_BAND_MAP: Record<IndividualsBand, MagnitudeBand> = {
  under_100k: 'under_100k',
  '100k_500k': '100k_to_500k',
  '500k_1m': '500k_to_1m',
  '1m_5m': '1m_to_5m',
  over_5m: 'over_5m',
};

const PAYMENT_FLOW_BAND_MAP: Record<PaymentFlowBand, MagnitudeBand> = {
  under_100k: 'under_100k',
  '100k_500k': '100k_to_500k',
  '500k_1m': '500k_to_1m',
  '1m_5m': '1m_to_5m',
  over_5m: 'over_5m',
};

const RD_IP_VALUE_BAND_MAP: Record<ProfileRdIpValueBand, 'none' | 'under_2' | '2_to_8' | 'over_8'> = {
  none: 'none',
  under_2: 'under_2',
  '2_8': '2_to_8',
  over_8: 'over_8',
};

/**
 * `cardTransactionsBand` and `sensitiveRecordsBand` are coarser than the kernel's six-bucket
 * `MagnitudeBand` (four buckets each). Each bounded coarse bucket is mapped onto the kernel bucket
 * whose own `MAGNITUDE_BAND_MIDPOINT` is closest to that bucket's representative value — the same
 * geometric-midpoint convention the kernel already uses for its own bands — so a driver reading the
 * translated value scales it the way an honest read of the coarse answer would.
 */
const CARD_TRANSACTIONS_BAND_MAP: Record<CardTransactionsBand, MagnitudeBand> = {
  none: 'none',
  under_500k: '100k_to_500k',
  '500k_5m': '1m_to_5m',
  over_5m: 'over_5m',
};

const SENSITIVE_RECORDS_BAND_MAP: Record<SensitiveRecordsBand, MagnitudeBand> = {
  none: 'none',
  under_100k: 'under_100k',
  '100k_1m': '100k_to_500k',
  over_1m: '1m_to_5m',
};

/** Q20's band already lines up 1:1 with the kernel's `MagnitudeBand` — the same five buckets `individualsBand` uses, minus its own `none`, which Q20 never offers. */
const LARGEST_REPOSITORY_BAND_MAP: Record<LargestRepositoryBand, MagnitudeBand> = {
  under_100k: 'under_100k',
  '100k_500k': '100k_to_500k',
  '500k_1m': '500k_to_1m',
  '1m_5m': '1m_to_5m',
  over_5m: 'over_5m',
};

/** Only the loss kinds, so a kind the derivation starts reading also moves the answers version. */
const declaredCountOf = (declaredEstate: ReadonlyArray<DeclaredEstateRow>, kind: DeclaredEstateLossKind): CountRange | null => {
  const row = declaredEstate.find((declared) => declared.kind === kind);
  return row === undefined ? null : { low: row.low, high: row.high };
};

/**
 * Turns a `financial_profiles` row into the kernel's `FinancialProfileInput`: the two shapes were
 * built independently and differ in nesting, band spellings and, for several bands, granularity.
 * `customerCountBand` passes straight through, the two band sets now being the same decade ladder.
 * `rdIpValueBand` only ever produces a `revenue_fraction` kernel input — the stored column has no
 * `kind` discriminant and its values are exactly the `revenue_fraction` band set.
 * `restoreTestRecency` and `contractualLiabilityCapBand` also pass straight through: both were
 * defined on the kernel's own band values from the start (see the v2 frozen-values decision
 * record), so there is no separate profile-side vocabulary to translate. `costliestIncidentBand`
 * passes straight through for the same reason, while `worstOutageBand` needs the same
 * `1_3d`/`1_to_3d` translation as the restore band its overrun is measured against. The workstation
 * and server counts are read from the scope's declared estate rows.
 */
export const financialProfileToKernelInput = (profile: FinancialProfileRow, declaredEstate: ReadonlyArray<DeclaredEstateRow>): FinancialProfileInput => ({
  annualRevenueUsd: profile.annualRevenue,
  grossMarginPct: profile.grossMarginPct,
  operatingDaysBand: mapNullable(profile.operatingDaysBand, OPERATING_DAYS_BAND_MAP),
  seasonalPeakPct: profile.seasonalPeakPct,
  itDependentRevenuePct: profile.itDependentRevenuePct,
  timeToRevenueImpactBand: mapNullable(profile.timeToRevenueImpactBand, TIME_TO_REVENUE_IMPACT_BAND_MAP),
  fullRestoreBand: mapNullable(profile.fullRestoreBand, FULL_RESTORE_BAND_MAP),
  revenueRecaptureBand: mapNullable(profile.revenueRecaptureBand, REVENUE_RECAPTURE_BAND_MAP),
  restoreTestRecency: profile.restoreTestRecency,
  declaredWorkstations: declaredCountOf(declaredEstate, 'workstations'),
  declaredServers: declaredCountOf(declaredEstate, 'servers'),
  recordsHeld: {
    holdsPersonalDataBeyondEmployees: profile.recordsHeldGate,
    individualsBand: mapNullable(profile.individualsBand, INDIVIDUALS_BAND_MAP),
    paymentCardTransactionsBand: mapNullable(profile.cardTransactionsBand, CARD_TRANSACTIONS_BAND_MAP),
    sensitiveRecordsBand: mapNullable(profile.sensitiveRecordsBand, SENSITIVE_RECORDS_BAND_MAP),
  },
  regulatoryRegime: profile.regulatoryRegime,
  customerBase: {
    customerCountBand: profile.customerCountBand,
    b2cRevenuePct: profile.b2cRevenuePct,
    recurringRevenuePct: profile.recurringRevenuePct,
  },
  contractedRevenueUnderClausesBand: mapNullable(profile.contractedRevenueBand, CONTRACTED_REVENUE_BAND_MAP),
  contractualLiabilityCapBand: profile.contractualLiabilityCapBand,
  largestRepositoryBand: mapNullable(profile.largestRepositoryBand, LARGEST_REPOSITORY_BAND_MAP),
  paymentFlows: {
    dailyValueBand: mapNullable(profile.paymentFlowDailyValueBand, PAYMENT_FLOW_BAND_MAP),
    outOfBandVerification: profile.outOfBandVerificationGate,
    outOfBandThresholdUsd: profile.outOfBandThreshold,
  },
  rdIpValue: profile.rdIpValueBand === null
    ? null
    : { kind: 'revenue_fraction', band: RD_IP_VALUE_BAND_MAP[profile.rdIpValueBand] },
  ransomPaymentPosture: profile.ransomPaymentPosture,
  ransomPaymentCeilingUsd: profile.ransomPaymentCeiling,
  costliestIncidentBand: profile.costliestIncidentBand,
  worstOutageBand: mapNullable(profile.worstOutageBand, WORST_OUTAGE_BAND_MAP),
  loadedDailyLabourCostUsd: profile.loadedDailyLabourCost,
});

/**
 * The organization row's shape already matches `OrganizationInput` field-for-field. The country code
 * is not a column of the row: the caller resolves it from `countryId` when it has one.
 */
export const organizationToKernelInput = (organization: OrganizationRow): OrganizationInput => ({
  revenueBand: organization.revenueBand,
  employeeCount: organization.employeeCount,
  countryIsoAlpha3: organization.countryIsoAlpha3,
});
