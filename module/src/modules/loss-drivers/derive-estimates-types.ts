import type { RevenueBand } from '../organizations/constants';

/**
 * Local mirror of the questionnaire cards, kept in sync by field name only. It is not
 * guaranteed to match a persisted questionnaire-answer shape as-is: naming, band breakpoints and
 * variant discriminants are free to diverge from whatever the persistence layer ships. A caller
 * must not cast or pass a persisted shape through directly — closing the gap needs a deliberate
 * per-field mapping decision, not a typed passthrough.
 */

export type KernelOperatingDaysBand = 'five_of_seven' | 'six_of_seven' | 'continuous';
export type KernelTimeToRevenueImpactBand = 'under_6h' | '6_to_12h' | '12_to_24h' | '24_to_48h' | 'over_48h';
export type KernelFullRestoreBand = 'under_1d' | '1_to_3d' | '3_to_7d' | '1_to_2w' | 'over_2w' | 'unknown';
export type KernelRevenueRecaptureBand = 'mostly_lost' | 'partly_deferred' | 'mostly_deferred';
export type KernelContractedRevenueBand = 'none' | 'under_25' | '25_to_75' | 'over_75';
export type KernelRegulatoryRegime = 'none' | 'nis2_essential' | 'nis2_important' | 'dora' | 'other_sectoral';
/** Banded on its own decade breakpoints: the magnitude ladder is coarser than the counts it priced. */
export type KernelCustomerCountBand = 'under_1k' | '1k_10k' | '10k_100k' | '100k_1m' | 'over_1m';
/** Q16 — restore-test recency; a blank multiplier is 1.0, same as `within_12m`, since a blank never widens an estimate. */
export type KernelRestoreTestRecency = 'within_12m' | 'over_12m' | 'never';
/** Q19 — aggregate contractual liability cap, as a multiple of Q12's contracted revenue. `no_cap` means no ceiling at all. */
export type KernelContractualLiabilityCapBand = 'under_25' | '25_100' | '100_200' | 'over_200' | 'no_cap';
/** Q18 — costliest incident in the past three years; feeds the sanity gate as a second anchor. */
export type KernelCostliestIncidentBand = 'none' | 'under_25k' | '25k_100k' | '100k_500k' | '500k_2m' | 'over_2m';
/** Q18 — the worst outage actually suffered, banded on the same durations the restore band uses. */
export type KernelWorstOutageBand = 'none' | 'under_1d' | '1_to_3d' | '3_to_7d' | '1_to_2w' | 'over_2w';

/** A magnitude band with a market breakpoint (100k/500k/1M/5M) and a geometric midpoint. */
export type MagnitudeBand = 'none' | 'under_100k' | '100k_to_500k' | '500k_to_1m' | '1m_to_5m' | 'over_5m';

export type RdIpValueInput =
  | { kind: 'revenue_fraction', band: 'none' | 'under_2' | '2_to_8' | 'over_8' }
  | { kind: 'replacement_cost', band: MagnitudeBand };

export interface RecordsHeldInput {
  holdsPersonalDataBeyondEmployees: boolean | null,
  individualsBand: MagnitudeBand | null,
  paymentCardTransactionsBand: MagnitudeBand | null,
  sensitiveRecordsBand: MagnitudeBand | null,
}

export interface CustomerBaseInput {
  customerCountBand: KernelCustomerCountBand | null,
  b2cRevenuePct: number | null,
  recurringRevenuePct: number | null,
}

/** A count between two bounds; an exact number has two equal bounds. */
export interface CountRange {
  low: number,
  high: number,
}

export interface PaymentFlowsInput {
  dailyValueBand: MagnitudeBand | null,
  outOfBandVerification: boolean | null,
  outOfBandThresholdUsd: number | null,
}

export interface FinancialProfileInput {
  annualRevenueUsd: number | null, // Q1
  grossMarginPct: number | null, // Q2
  operatingDaysBand: KernelOperatingDaysBand | null, // Q3
  /** Q3 — seasonal peak uplift, a percentage; widens the max leg of D3.1/D3.2 only. */
  seasonalPeakPct: number | null,
  itDependentRevenuePct: number | null, // Q5
  timeToRevenueImpactBand: KernelTimeToRevenueImpactBand | null, // Q6
  fullRestoreBand: KernelFullRestoreBand | null, // Q7
  revenueRecaptureBand: KernelRevenueRecaptureBand | null, // Q8
  /** Q16 — null (blank) never widens an estimate; only an explicit "never" does. */
  restoreTestRecency: KernelRestoreTestRecency | null,
  /**
   * Read from the scope's declared estate. An undeclared side keeps its headcount or size-class
   * proxy, and the low-confidence flag stays until both sides are declared.
   */
  declaredWorkstations: CountRange | null,
  declaredServers: CountRange | null,
  recordsHeld: RecordsHeldInput, // Q9
  regulatoryRegime: KernelRegulatoryRegime | null, // Q10
  customerBase: CustomerBaseInput, // Q11
  contractedRevenueUnderClausesBand: KernelContractedRevenueBand | null, // Q12
  /** Q19 — bounds D7.2's B2B max and sets D7.5's max; blank falls back to the platform default. */
  contractualLiabilityCapBand: KernelContractualLiabilityCapBand | null,
  /** Q20 — bounds the likely (not max) population of D6.1, D6.2 and D7.2; blank reads the full estate. */
  largestRepositoryBand: MagnitudeBand | null,
  paymentFlows: PaymentFlowsInput, // Q13
  rdIpValue: RdIpValueInput | null, // Q14
  ransomPaymentPosture: boolean | null, // Q15
  /** Q15 — caps D4.1's triplet when given; min and likely clamp down to it. */
  ransomPaymentCeilingUsd: number | null,
  /** Q18 — a second sanity-gate anchor, and the symmetric under-pricing warning. */
  costliestIncidentBand: KernelCostliestIncidentBand | null,
  /**
   * Q18 — the worst outage suffered. Read as evidence about the restore band rather than as a
   * duration of its own: an outage that overran the target widens the max of every driver built
   * on that target, and never touches a min or a likely.
   */
  worstOutageBand: KernelWorstOutageBand | null,
  /** The organization's own answer, feeding D1.4 only. Blank falls back to the country benchmark at low confidence. */
  loadedDailyLabourCostUsd: number | null,
}

/** The minimal organization slice this kernel needs, never the full `organizations` row. */
export interface OrganizationInput {
  revenueBand: RevenueBand | null,
  employeeCount: number | null,
  /** Picks the labour-cost benchmark D1.4 falls back to when the profile leaves the rate blank. */
  countryIsoAlpha3?: string | null,
}

/**
 * One activated (attack outcome × business-value category) cell of a scenario. Both ids are the
 * catalogue ids from `attack-outcomes-ids.ts` / `business-value-categories-ids.ts` — the same ids
 * `LOSS_ACTIVATION_MATRIX` is keyed on — never the tenant-scoped row ids a `deriveSeedId(tenantId,
 * catalogId)` seeder produced. A caller working from persisted rows must resolve back to the
 * catalogue id before building this cell, or every cell fails to match and no driver is activated.
 */
export interface ActivationSetCell {
  attackOutcomeCatalogId: string,
  businessValueCategoryCatalogId: string,
}

export type ActivationSetInput = ReadonlyArray<ActivationSetCell>;

export type CoefficientConfidence = 'anchored' | 'weak' | 'unanchored';

export interface DriverEstimate {
  /** The catalogue loss-driver id from `loss-drivers-ids.ts`; translate via `deriveSeedId(tenantId, lossDriverCatalogId)` to reach that tenant's seeded row before persisting. */
  lossDriverCatalogId: string,
  min: number,
  likely: number,
  max: number,
  /** Proxy-derived or weak/unanchored-coefficient row; never manufactures confidence it lacks. */
  lowConfidence: boolean,
  /** Marks D4.1's explicit ransom-posture-no `(0, 0, 0)` triplet, distinguishing it from a no-row absence. */
  isPosture?: boolean,
}

/**
 * `over_pricing` fires above 3x the anchor, the greater of the loss-to-revenue curve figure and
 * Q18's revealed costliest-incident midpoint. `under_pricing` is the symmetric warning: a
 * derived total below an incident the organization reports having already suffered. Both are
 * informational only — nothing is ever clamped.
 */
export interface SanityWarning {
  kind: 'over_pricing' | 'under_pricing',
  expectedTotalUsd: number,
  anchorUsd: number,
  ratio: number,
}

export interface DerivationResult {
  estimates: ReadonlyArray<DriverEstimate>,
  coefficientSetVersion: string,
}

export type SizeClass = 'S' | 'M' | 'L';
