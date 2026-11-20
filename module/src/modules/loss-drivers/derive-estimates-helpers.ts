import type {
  CoefficientConfidence,
  CountRange,
  FinancialProfileInput,
  KernelContractedRevenueBand,
  KernelContractualLiabilityCapBand,
  KernelCostliestIncidentBand,
  KernelCustomerCountBand,
  KernelFullRestoreBand,
  KernelOperatingDaysBand,
  KernelRegulatoryRegime,
  KernelRevenueRecaptureBand,
  KernelTimeToRevenueImpactBand,
  KernelWorstOutageBand,
  MagnitudeBand,
  OrganizationInput,
  SanityWarning,
  SizeClass,
} from './derive-estimates-types';
import { loadedDailyLabourCostBenchmark } from '../financial-profiles/labour-cost-benchmark';
import { revenueBandMidpoint } from '../organizations/constants';

export const SIZE_CLASS_SMALL_MAX_USD = 50_000_000;
export const SIZE_CLASS_MEDIUM_MAX_USD = 1_000_000_000;

/** S under 50M, M 50M-1B, L over 1B; edges clamp, no interpolation. */
export const deriveSizeClass = (annualRevenueUsd: number): SizeClass => {
  if (annualRevenueUsd < SIZE_CLASS_SMALL_MAX_USD) {
    return 'S';
  }
  if (annualRevenueUsd < SIZE_CLASS_MEDIUM_MAX_USD) {
    return 'M';
  }
  return 'L';
};

export interface ResolvedRevenue {
  annualRevenueUsd: number | null,
  /** True when the exact Q1 answer was missing and the organization's revenue band midpoint was used. */
  lowConfidence: boolean,
}

/**
 * Without Q1, every revenue-scaled driver is flagged low-confidence, never silently treated as if
 * the exact figure were known.
 */
export const resolveAnnualRevenueUsd = (profile: Pick<FinancialProfileInput, 'annualRevenueUsd'>, organization: OrganizationInput): ResolvedRevenue => {
  if (profile.annualRevenueUsd != null) {
    return { annualRevenueUsd: profile.annualRevenueUsd, lowConfidence: false };
  }
  if (organization.revenueBand != null) {
    return { annualRevenueUsd: revenueBandMidpoint(organization.revenueBand), lowConfidence: true };
  }
  return { annualRevenueUsd: null, lowConfidence: false };
};

export interface ResolvedLabourCost {
  loadedDailyLabourCostUsd: number,
  /** True when the organization left the rate blank and its country's benchmark was used. */
  lowConfidence: boolean,
}

/**
 * The labour-cost counterpart of {@link resolveAnnualRevenueUsd}: the organization's answer at full
 * confidence, else the country benchmark flagged low-confidence, so a blank rate neither leaves D1.4
 * underived nor passes a proxy off as an answer.
 */
export const resolveLoadedDailyLabourCostUsd = (profile: FinancialProfileInput, organization: OrganizationInput): ResolvedLabourCost => {
  if (profile.loadedDailyLabourCostUsd != null) {
    return { loadedDailyLabourCostUsd: profile.loadedDailyLabourCostUsd, lowConfidence: false };
  }
  return { loadedDailyLabourCostUsd: loadedDailyLabourCostBenchmark(organization.countryIsoAlpha3), lowConfidence: true };
};

export interface CountSpread {
  low: number,
  mid: number,
  high: number,
}

export interface SystemsInScope {
  endpoints: CountSpread,
  servers: CountSpread,
  /** True when either side is still proxy-derived; a declaration of both sides, however wide, drops it. */
  proxied: boolean,
}

/**
 * The declared bands each run about five times the one before, so a range is read on a log scale.
 * A range starting at 0 has no log and is read linearly.
 */
export const countRangeMidpoint = ({ low, high }: CountRange): number => (low === 0 ? (low + high) / 2 : Math.sqrt(low * high));

const countSpreadOf = (declared: CountRange | null, proxy: number): CountSpread => (declared === null
  ? { low: proxy, mid: proxy, high: proxy }
  : { low: declared.low, mid: countRangeMidpoint(declared), high: declared.high });

const ENDPOINTS_PER_EMPLOYEE = 0.9;
const SERVERS_BY_SIZE_CLASS: Record<SizeClass, number> = { S: 5, M: 40, L: 300 };

/**
 * Workstation and server counts, each from its declaration or, undeclared, from its proxy alone.
 * Implemented once; D1.1 and D2.1 both call it rather than diverging.
 */
export const deriveSystemsInScope = (
  employeeCount: number,
  sizeClass: SizeClass,
  declaredWorkstations: CountRange | null,
  declaredServers: CountRange | null,
): SystemsInScope => ({
  endpoints: countSpreadOf(declaredWorkstations, employeeCount * ENDPOINTS_PER_EMPLOYEE),
  servers: countSpreadOf(declaredServers, SERVERS_BY_SIZE_CLASS[sizeClass]),
  proxied: declaredWorkstations == null || declaredServers == null,
});

export type SpreadClass = 'labour' | 'heavyTailed';

const SPREAD_RATIOS: Record<SpreadClass, { min: number, max: number }> = {
  labour: { min: 0.7, max: 1.6 },
  heavyTailed: { min: 0.3, max: 3.5 },
};

export interface Triplet {
  min: number,
  likely: number,
  max: number,
}

/**
 * Opens a central value into a triplet: narrower for labour-like drivers, wider for heavy-tailed
 * ones, per the roughly ten-to-one p95-to-median ratio published for cyber loss distributions.
 * `forceMinZero` is for contingent drivers; the resulting min-0 spread still carries the loss
 * model's disclosed PERT mean-floor bias and this helper does not compensate for it.
 */
export const openBaselineSpread = (central: number, spreadClass: SpreadClass, forceMinZero = false): Triplet =>
  openBoundedSpread(central, central, spreadClass, forceMinZero);

/**
 * Like `openBaselineSpread`, but opens the likely and max legs off two different central values —
 * Q20 bounds only the likely population feeding D6.1/D6.2/D7.2, while the max keeps reading the
 * full estate, so the two legs can no longer share one central value.
 */
export const openBoundedSpread = (likelyCentral: number, maxCentral: number, spreadClass: SpreadClass, forceMinZero = false): Triplet =>
  openRangeSpread(likelyCentral, likelyCentral, maxCentral, spreadClass, forceMinZero);

/** Opens each leg off its own central value: an amount priced at a count's low, middle and high points. */
export const openRangeSpread = (
  minCentral: number,
  likelyCentral: number,
  maxCentral: number,
  spreadClass: SpreadClass,
  forceMinZero = false,
): Triplet => {
  const ratios = SPREAD_RATIOS[spreadClass];
  return {
    min: forceMinZero ? 0 : minCentral * ratios.min,
    likely: likelyCentral,
    max: maxCentral * ratios.max,
  };
};

export const HEAVY_TAILED_MIN_RATIO = SPREAD_RATIOS.heavyTailed.min;

export const OPERATING_DAYS_BY_BAND: Record<KernelOperatingDaysBand, number> = {
  five_of_seven: 250,
  six_of_seven: 300,
  continuous: 365,
};

/** Geometric midpoints on the card's own decade breakpoints, so no count is priced through a coarser ladder. */
export const CUSTOMER_COUNT_MIDPOINT: Record<KernelCustomerCountBand, number> = {
  under_1k: 500,
  '1k_10k': 3_162,
  '10k_100k': 31_623,
  '100k_1m': 316_228,
  over_1m: 1_500_000,
};

export const TIME_TO_IMPACT_HOURS_BY_BAND: Record<KernelTimeToRevenueImpactBand, number> = {
  under_6h: 3,
  '6_to_12h': 9,
  '12_to_24h': 18,
  '24_to_48h': 36,
  over_48h: 60,
};

export const RESTORE_DAYS_BY_BAND: Record<Exclude<KernelFullRestoreBand, 'unknown'>, number> = {
  under_1d: 0.5,
  '1_to_3d': 2,
  '3_to_7d': 5,
  '1_to_2w': 10.5,
  over_2w: 21,
};

const UNKNOWN_RESTORE_DAYS_BY_SIZE_CLASS: Record<SizeClass, number> = { S: 7, M: 10.5, L: 14 };

/** The two cards band the same durations, so the revealed outage reads off the restore table. */
export const KERNEL_WORST_OUTAGE_DAYS: Record<KernelWorstOutageBand, number> = { none: 0, ...RESTORE_DAYS_BY_BAND };

/**
 * How far the revealed worst outage overran the duration the downtime drivers trust, as a
 * multiple floored at 1.
 *
 * The restore band is a target and the outage a fact, so a fact above the target is not a
 * contradiction to flag — it is evidence the duration those drivers are built on is optimistic.
 * A history that stayed inside the target is not evidence the target is pessimistic, which is why
 * the floor is 1 and a revealed outage can only ever widen.
 */
export const revealedOutageOverrun = (band: KernelWorstOutageBand | null, trustedRestoreDays: number): number => {
  if (band == null || band === 'none' || trustedRestoreDays <= 0) {
    return 1;
  }
  return Math.max(1, KERNEL_WORST_OUTAGE_DAYS[band] / trustedRestoreDays);
};

export interface ResolvedRestoreDays {
  days: number,
  /** True when the band answered "unknown" and a size-class default had to stand in. */
  lowConfidence: boolean,
}

export const resolveRestoreDays = (band: KernelFullRestoreBand, sizeClass: SizeClass): ResolvedRestoreDays => {
  if (band === 'unknown') {
    return { days: UNKNOWN_RESTORE_DAYS_BY_SIZE_CLASS[sizeClass], lowConfidence: true };
  }
  return { days: RESTORE_DAYS_BY_BAND[band], lowConfidence: false };
};

export const REVENUE_RECAPTURE_FRACTION_BY_BAND: Record<KernelRevenueRecaptureBand, number> = {
  mostly_lost: 0.05,
  partly_deferred: 0.35,
  mostly_deferred: 0.7,
};

export const MAGNITUDE_BAND_MIDPOINT: Record<MagnitudeBand, number> = {
  none: 0,
  under_100k: 50_000,
  '100k_to_500k': 223_607,
  '500k_to_1m': 707_107,
  '1m_to_5m': 2_236_068,
  over_5m: 7_500_000,
};

export const CONTRACTED_REVENUE_FRACTION_BY_BAND: Record<KernelContractedRevenueBand, number> = {
  none: 0,
  under_25: 0.125,
  '25_to_75': 0.5,
  over_75: 0.875,
};

export const LOSS_TO_REVENUE_ANCHOR_FRACTION_BY_SIZE_CLASS: Record<SizeClass, number> = {
  S: 0.15,
  M: 0.08,
  L: 0.03,
};

export const SANITY_WARNING_MULTIPLE = 3;

/**
 * Q19's cap as a multiple of contracted revenue, on the band midpoint convention. `no_cap`
 * has no fraction — it means no ceiling at all, and is resolved outside this table.
 */
export const LIABILITY_CAP_FRACTION_BY_BAND: Record<Exclude<KernelContractualLiabilityCapBand, 'no_cap'>, number> = {
  under_25: 0.125,
  '25_100': 0.5,
  '100_200': 1.41,
  over_200: 3.0,
};

/**
 * Resolves Q19 into the fraction of contracted revenue a liability cap represents: `null` when the
 * band is `no_cap` (no ceiling to bound against), `fallbackFraction` when Q19 is blank — the
 * platform's own weak default, unchanged from before the card existed.
 */
export const resolveLiabilityCapFraction = (band: KernelContractualLiabilityCapBand | null, fallbackFraction: number): number => {
  if (band == null) {
    return fallbackFraction;
  }
  if (band === 'no_cap') {
    // An uncapped contract is exposed at least as far as the highest ceiling this card can band, so
    // it reads as that top fraction. Its true exposure is unbounded and cannot be emitted; falling
    // back to a driver's own spread instead would make "no ceiling at all" the *cheapest* answer on
    // the card, which is the one thing the ordering must never do.
    return LIABILITY_CAP_FRACTION_BY_BAND.over_200;
  }
  return LIABILITY_CAP_FRACTION_BY_BAND[band];
};

/** Q18's costliest-incident band, on the band midpoint convention. Feeds the sanity gate only, never a driver formula. */
export const COSTLIEST_INCIDENT_MIDPOINT: Record<KernelCostliestIncidentBand, number> = {
  none: 0,
  under_25k: 12_500,
  '25k_100k': 50_000,
  '100k_500k': 223_607,
  '500k_2m': 1_000_000,
  over_2m: 3_000_000,
};

/**
 * The plausibility verdict on a total, and the one definition of it: the kernel judges the total
 * it derives, and the scenario page judges the total it displays, which is the same total plus
 * whatever an analyst typed by hand. Two rules would eventually disagree about the same figure.
 *
 * The anchor is the higher of a published loss-to-revenue fraction and a loss the organization
 * reports having already suffered — an organization that genuinely lost millions stops being
 * warned at hundreds of thousands. Nothing here clamps: it emits warnings.
 */
export const evaluateSanityWarnings = (
  expectedTotalUsd: number,
  { annualRevenueUsd, sizeClass, costliestIncidentBand }: {
    annualRevenueUsd: number | null,
    sizeClass: SizeClass,
    costliestIncidentBand: KernelCostliestIncidentBand | null,
  },
): ReadonlyArray<SanityWarning> => {
  if (annualRevenueUsd == null) {
    return [];
  }
  const warnings: Array<SanityWarning> = [];
  const lossToRevenueAnchorUsd = annualRevenueUsd * LOSS_TO_REVENUE_ANCHOR_FRACTION_BY_SIZE_CLASS[sizeClass];
  const costliestIncidentMidpointUsd = costliestIncidentBand != null ? COSTLIEST_INCIDENT_MIDPOINT[costliestIncidentBand] : 0;
  const anchorUsd = Math.max(lossToRevenueAnchorUsd, costliestIncidentMidpointUsd);

  if (anchorUsd > 0 && expectedTotalUsd > SANITY_WARNING_MULTIPLE * anchorUsd) {
    warnings.push({
      kind: 'over_pricing',
      expectedTotalUsd: expectedTotalUsd,
      anchorUsd,
      ratio: expectedTotalUsd / anchorUsd,
    });
  }
  // The symmetric reading: a total below an incident the organization reports having already
  // suffered says this scenario is under-priced. Never fires on a blank Q18.
  if (costliestIncidentMidpointUsd > 0 && expectedTotalUsd < costliestIncidentMidpointUsd) {
    warnings.push({
      kind: 'under_pricing',
      expectedTotalUsd: expectedTotalUsd,
      anchorUsd: costliestIncidentMidpointUsd,
      ratio: expectedTotalUsd / costliestIncidentMidpointUsd,
    });
  }
  return warnings;
};

/**
 * Q20 bounds the likely population, never the max, of D6.1, D6.2 and D7.2's per-record leg: a
 * breach reaching every system at once is the bad case, not the central one. A blank band returns
 * the full estate unchanged.
 */
export const boundIndividualsByRepository = (individuals: number, largestRepositoryBand: MagnitudeBand | null): number =>
  largestRepositoryBand == null ? individuals : Math.min(individuals, MAGNITUDE_BAND_MIDPOINT[largestRepositoryBand]);

/**
 * A row is low-confidence when its selected coefficient is not `anchored`, or the caller found an
 * additional input/proxy reason to distrust it (a band-estimated revenue, an "unknown" restore
 * band, a headcount-based proxy for asset counts). Reading the coefficient here — rather than
 * hardcoding a driver-by-driver literal — keeps a driver's flag following its coefficient set
 * instead of silently disagreeing with a re-tuned or alternate one.
 */
export const isLowConfidence = (coeffConfidence: CoefficientConfidence, proxyLowConfidence = false): boolean =>
  coeffConfidence !== 'anchored' || proxyLowConfidence;

/**
 * Any named regime carries supervision; `none` and an unanswered card do not. D7.3 reads each
 * regime's own statutory cap rather than this flat check; D1.2's legal-counsel lift is the
 * one driver left applying a single interim multiplier for any named regime.
 */
export const isRegulated = (regime: KernelRegulatoryRegime | null): boolean => regime != null && regime !== 'none';
