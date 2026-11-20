import type { CoefficientSet } from './derive-estimates-coefficients';
import type { CountSpread, Triplet } from './derive-estimates-helpers';
import type { CoefficientConfidence, FinancialProfileInput, SizeClass } from './derive-estimates-types';
import { BusinessValueCategory_DataEntrustedByOthers, BusinessValueCategory_PaymentCardData, BusinessValueCategory_PersonalData } from '../business-value-categories/data/business-value-categories-ids';
import {
  boundIndividualsByRepository,
  CONTRACTED_REVENUE_FRACTION_BY_BAND,
  CUSTOMER_COUNT_MIDPOINT,
  deriveSystemsInScope,
  HEAVY_TAILED_MIN_RATIO,
  isLowConfidence,
  isRegulated,
  MAGNITUDE_BAND_MIDPOINT,
  openBaselineSpread,
  openBoundedSpread,
  openRangeSpread,
  OPERATING_DAYS_BY_BAND,
  resolveLiabilityCapFraction,
  resolveRestoreDays,
  revealedOutageOverrun,
  REVENUE_RECAPTURE_FRACTION_BY_BAND,
  TIME_TO_IMPACT_HOURS_BY_BAND,
} from './derive-estimates-helpers';

/** Per-driver output before the orchestrator stamps the driver id. */
export type DriverOutput = {
  min: number,
  likely: number,
  max: number,
  lowConfidence: boolean,
  isPosture?: boolean,
} | null;

export interface DriverContext {
  profile: FinancialProfileInput,
  coefficients: CoefficientSet,
  sizeClass: SizeClass,
  annualRevenueUsd: number | null,
  revenueLowConfidence: boolean,
  /** The profile's answer, else the country benchmark (see `resolveLoadedDailyLabourCostUsd`). */
  loadedDailyLabourCostUsd: number,
  labourCostLowConfidence: boolean,
  employeeCount: number | null,
  activatedCategoryIds: ReadonlySet<string>,
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A blank Q16 answer never widens an estimate, so it reads as the same 1.0 multiplier as `within_12m`. */
const restoreRecencyMaxMultiplier = (ctx: DriverContext): number => {
  const recency = ctx.profile.restoreTestRecency;
  return recency == null ? 1 : ctx.coefficients.restoreTestRecency.maxMultiplierByBand[recency];
};

/** The organization's own overrun of its restore target, capped so one bad week cannot swamp the estimate. */
const revealedOutageMaxMultiplier = (ctx: DriverContext): number => {
  if (ctx.profile.fullRestoreBand == null) {
    return 1;
  }
  const trusted = resolveRestoreDays(ctx.profile.fullRestoreBand, ctx.sizeClass);
  const overrun = revealedOutageOverrun(ctx.profile.worstOutageBand, trusted.days);
  return Math.min(overrun, ctx.coefficients.revealedOutage.maxOverrunMultiplier);
};

/**
 * How much doubt the profile casts on the restore duration these drivers are built on, as a
 * max-only multiplier.
 *
 * The two signals are the stronger of the pair, never their product: "the restore was never
 * tested" and "the restore demonstrably overran" are the same claim about the same duration, from
 * a proxy and from evidence, and compounding them would charge an organization twice for
 * admitting one weakness — which is what makes evidence dominate rather than accumulate.
 */
const restoreDoubt = (ctx: DriverContext): { multiplier: number, weak: boolean } => {
  const multiplier = Math.max(restoreRecencyMaxMultiplier(ctx), revealedOutageMaxMultiplier(ctx));
  // Both signals are weak coefficients, so a max they actually moved is a max the row cannot
  // vouch for. A multiplier of exactly 1 moved nothing and must not cost the row its confidence.
  return { multiplier, weak: multiplier > 1 };
};

/** Applies the max-only widening to an already-opened triplet, leaving min and likely untouched. */
const widenMaxForRestoreDoubt = (triplet: Triplet, ctx: DriverContext): Triplet => ({
  ...triplet,
  max: triplet.max * restoreDoubt(ctx).multiplier,
});

/** D1.1 Forensics & incident management. */
export const deriveD1_1 = (ctx: DriverContext): DriverOutput => {
  if (ctx.employeeCount == null || ctx.annualRevenueUsd == null || ctx.profile.fullRestoreBand == null) {
    return null;
  }
  const coeff = ctx.coefficients.d1_1;
  const systems = deriveSystemsInScope(ctx.employeeCount, ctx.sizeClass, ctx.profile.declaredWorkstations, ctx.profile.declaredServers);
  const restore = resolveRestoreDays(ctx.profile.fullRestoreBand, ctx.sizeClass);
  const restoreMultiplier = clamp(restore.days / 5, 0.5, 2.5);
  const engagementCost = (endpoints: number) => {
    const engagementDays = coeff.engagementDaysBySizeClass[ctx.sizeClass] * restoreMultiplier * clamp(endpoints / 1_000, 0.2, 3);
    return engagementDays * coeff.dailyRateUsd;
  };
  const triplet = openRangeSpread(engagementCost(systems.endpoints.low), engagementCost(systems.endpoints.mid), engagementCost(systems.endpoints.high), 'labour');
  // The coefficient's own weak mark is the proxy's weakness: declaring both counts lifts it to
  // anchored.
  return {
    ...widenMaxForRestoreDoubt(triplet, ctx),
    lowConfidence: isLowConfidence(systems.proxied ? coeff.confidence : 'anchored', restore.lowConfidence || restoreDoubt(ctx).weak),
  };
};

/** D1.2 Incident legal counsel. */
export const deriveD1_2 = (ctx: DriverContext): DriverOutput => {
  if (ctx.annualRevenueUsd == null) {
    return null;
  }
  const coeff = ctx.coefficients.d1_2;
  const dataTypeMultiplier = ctx.profile.recordsHeld.holdsPersonalDataBeyondEmployees === true ? 1.3 : 1.0;
  const regulatedMultiplier = isRegulated(ctx.profile.regulatoryRegime) ? coeff.regulatedMultiplier : 1.0;
  const hours = coeff.baseHoursBySizeClass[ctx.sizeClass] * dataTypeMultiplier * regulatedMultiplier;
  const likely = hours * coeff.hourlyRateUsd;
  return { ...openBaselineSpread(likely, 'labour'), lowConfidence: isLowConfidence(coeff.confidence, ctx.revenueLowConfidence) };
};

/** D1.3 Crisis communications & PR. */
export const deriveD1_3 = (ctx: DriverContext): DriverOutput => {
  const b2c = ctx.profile.customerBase.b2cRevenuePct;
  if (b2c == null) {
    return null;
  }
  const coeff = ctx.coefficients.d1_3;
  const holdsData = ctx.profile.recordsHeld.holdsPersonalDataBeyondEmployees === true;
  let tier: 'none' | 'low' | 'medium' | 'high';
  if (b2c >= 50 && holdsData) {
    tier = 'high';
  } else if (b2c >= 50 || (b2c >= 20 && holdsData)) {
    tier = 'medium';
  } else if (b2c > 0) {
    tier = 'low';
  } else {
    tier = 'none';
  }
  const likely = coeff.flatAmountByTierUsd[tier];
  return { ...openBaselineSpread(likely, 'labour'), lowConfidence: isLowConfidence(coeff.confidence) };
};

/** D1.4 Internal response surge labour. `sizeClass` is revenue-derived, so no resolved revenue means no honest size class either. */
export const deriveD1_4 = (ctx: DriverContext): DriverOutput => {
  if (
    ctx.employeeCount == null
    || ctx.profile.fullRestoreBand == null
    || ctx.annualRevenueUsd == null
  ) {
    return null;
  }
  const coeff = ctx.coefficients.d1_4;
  const restore = resolveRestoreDays(ctx.profile.fullRestoreBand, ctx.sizeClass);
  const responseDays = Math.min(restore.days, 10);
  const engagedHeadcount = ctx.employeeCount * coeff.engagedHeadcountFractionBySizeClass[ctx.sizeClass];
  const likely = engagedHeadcount * ctx.loadedDailyLabourCostUsd * responseDays;
  return {
    ...widenMaxForRestoreDoubt(openBaselineSpread(likely, 'labour'), ctx),
    lowConfidence: isLowConfidence(coeff.confidence, restore.lowConfidence || ctx.labourCostLowConfidence || restoreDoubt(ctx).weak),
  };
};

/** D2.1 System & data restoration. Shares `deriveSystemsInScope` with D1.1. */
export const deriveD2_1 = (ctx: DriverContext): DriverOutput => {
  if (ctx.employeeCount == null || ctx.annualRevenueUsd == null || ctx.profile.fullRestoreBand == null) {
    return null;
  }
  const coeff = ctx.coefficients.d2_1;
  const systems = deriveSystemsInScope(ctx.employeeCount, ctx.sizeClass, ctx.profile.declaredWorkstations, ctx.profile.declaredServers);
  const restore = resolveRestoreDays(ctx.profile.fullRestoreBand, ctx.sizeClass);
  const restoreMultiplier = clamp(restore.days / 5, 0.5, 2.5);
  const restorationCost = (point: keyof CountSpread) =>
    (systems.endpoints[point] * coeff.reimageUnitCostUsd + systems.servers[point] * coeff.serverRebuildUnitCostUsd) * restoreMultiplier;
  const triplet = openRangeSpread(restorationCost('low'), restorationCost('mid'), restorationCost('high'), 'labour');
  // Same lift as D1.1: the weak mark is the proxy's weakness, not a permanent one.
  return {
    ...widenMaxForRestoreDoubt(triplet, ctx),
    lowConfidence: isLowConfidence(systems.proxied ? coeff.confidence : 'anchored', restore.lowConfidence || restoreDoubt(ctx).weak),
  };
};

/** D3.1 Lost margin from downtime. D3.2 is a fraction of it, so it is derived once and shared. */
export const deriveD3_1 = (ctx: DriverContext): DriverOutput => {
  const p = ctx.profile;
  if (
    ctx.annualRevenueUsd == null
    || p.grossMarginPct == null
    || p.operatingDaysBand == null
    || p.itDependentRevenuePct == null
    || p.timeToRevenueImpactBand == null
    || p.fullRestoreBand == null
  ) {
    return null;
  }
  const coeff = ctx.coefficients.d3_1;
  const operatingDays = OPERATING_DAYS_BY_BAND[p.operatingDaysBand];
  const dailyGrossProfit = (ctx.annualRevenueUsd * (p.grossMarginPct / 100)) / operatingDays;
  const restore = resolveRestoreDays(p.fullRestoreBand, ctx.sizeClass);
  const timeToImpactDays = TIME_TO_IMPACT_HOURS_BY_BAND[p.timeToRevenueImpactBand] / 24;
  const likelyOutageDays = restore.days * coeff.likelyOutageFractionOfRestoreBand;
  const effectiveOutageLikely = Math.max(0, likelyOutageDays - timeToImpactDays);
  const effectiveOutageMax = Math.max(0, restore.days - timeToImpactDays);
  const recaptureFraction = p.revenueRecaptureBand != null ? REVENUE_RECAPTURE_FRACTION_BY_BAND[p.revenueRecaptureBand] : 0;
  const itDependentFraction = p.itDependentRevenuePct / 100;

  const rawLikely = dailyGrossProfit * itDependentFraction * effectiveOutageLikely * coeff.capacityLossFactor * (1 - recaptureFraction);
  const rawMax = dailyGrossProfit * itDependentFraction * effectiveOutageMax * (1 - recaptureFraction);
  // Seasonal peak and restore-test recency widen the max leg only, before the revenue cap has the final word.
  const peakMultiple = Math.min(1 + (p.seasonalPeakPct ?? 0) / 100, ctx.coefficients.seasonalPeak.capMultiple);
  const doubt = restoreDoubt(ctx);
  const widenedRawMax = rawMax * peakMultiple * doubt.multiplier;
  const cap = ctx.annualRevenueUsd * coeff.revenueCapFractionBySizeClass[ctx.sizeClass];
  const max = Math.min(widenedRawMax, cap);
  const likely = Math.min(rawLikely, max);
  const min = likely * HEAVY_TAILED_MIN_RATIO;

  return {
    min,
    likely,
    max,
    lowConfidence: isLowConfidence(coeff.confidence, restore.lowConfidence || ctx.revenueLowConfidence || doubt.weak || peakMultiple > 1),
  };
};

/** D3.2 Incremental operating cost during disruption. A fraction of D3.1, never derived standalone. */
export const deriveD3_2 = (ctx: DriverContext): DriverOutput => {
  const d3_1 = deriveD3_1(ctx);
  if (d3_1 == null) {
    return null;
  }
  const coeff = ctx.coefficients.d3_2;
  return {
    min: d3_1.min * coeff.fractionOfD3_1,
    likely: d3_1.likely * coeff.fractionOfD3_1,
    max: d3_1.max * coeff.fractionOfD3_1,
    lowConfidence: isLowConfidence(coeff.confidence, d3_1.lowConfidence),
  };
};

/** D4.1 Extortion payment. Q15 = no emits the explicit posture triplet, distinguishable via `isPosture`. */
export const deriveD4_1 = (ctx: DriverContext): DriverOutput => {
  if (ctx.profile.ransomPaymentPosture == null) {
    return null;
  }
  if (ctx.profile.ransomPaymentPosture === false) {
    return { min: 0, likely: 0, max: 0, lowConfidence: false, isPosture: true };
  }
  if (ctx.annualRevenueUsd == null) {
    return null;
  }
  const coeff = ctx.coefficients.d4_1;
  const demand = Math.max(coeff.floorUsd, ctx.annualRevenueUsd * coeff.demandRateFractionOfRevenueBySizeClass[ctx.sizeClass]);
  const likely = demand * coeff.paymentRatio;
  const triplet = openBaselineSpread(likely, 'heavyTailed');
  // Q15's ceiling caps the triplet rather than replacing it, so a generous board ceiling never widens the platform's own estimate.
  const ceiling = ctx.profile.ransomPaymentCeilingUsd;
  const max = ceiling != null ? Math.min(triplet.max, ceiling) : triplet.max;
  const clampedLikely = Math.min(triplet.likely, max);
  const min = Math.min(triplet.min, clampedLikely);
  return { min, likely: clampedLikely, max, lowConfidence: isLowConfidence(coeff.confidence, ctx.revenueLowConfidence) };
};

/** D5.1 Stolen funds, net of recovery. */
export const deriveD5_1 = (ctx: DriverContext): DriverOutput => {
  const band = ctx.profile.paymentFlows.dailyValueBand;
  if (band == null) {
    return null;
  }
  const coeff = ctx.coefficients.d5_1;
  const dailyValue = MAGNITUDE_BAND_MIDPOINT[band];
  let likely = dailyValue * coeff.exposureDaysSaturation * coeff.nonRecoveryRate;
  if (ctx.profile.paymentFlows.outOfBandVerification === true) {
    likely *= coeff.outOfBandVerificationMitigation;
  }
  const threshold = ctx.profile.paymentFlows.outOfBandThresholdUsd;
  const cap = threshold != null ? threshold * coeff.exposureDaysSaturation : null;
  if (cap != null) {
    likely = Math.min(likely, cap);
  }
  const triplet = openBaselineSpread(likely, 'heavyTailed');
  return {
    min: triplet.min,
    likely: triplet.likely,
    max: cap != null ? Math.min(triplet.max, cap) : triplet.max,
    lowConfidence: isLowConfidence(coeff.confidence),
  };
};

/** D6.1 Notification & call handling. Q20 bounds the likely population; max keeps the full estate. */
export const deriveD6_1 = (ctx: DriverContext): DriverOutput => {
  const band = ctx.profile.recordsHeld.individualsBand;
  if (band == null) {
    return null;
  }
  const coeff = ctx.coefficients.d6_1;
  const individuals = MAGNITUDE_BAND_MIDPOINT[band];
  const sensitiveBand = ctx.profile.recordsHeld.sensitiveRecordsBand ?? 'none';
  const sensitiveMidpoint = MAGNITUDE_BAND_MIDPOINT[sensitiveBand];
  const costForPopulation = (population: number): number => {
    const sensitivePopulation = Math.min(sensitiveMidpoint, population);
    return (population - sensitivePopulation) * coeff.perIndividualCostUsd
      + sensitivePopulation * coeff.perIndividualCostUsd * coeff.sensitiveRecordMultiplier;
  };
  const boundedIndividuals = boundIndividualsByRepository(individuals, ctx.profile.largestRepositoryBand);
  return {
    ...openBoundedSpread(costForPopulation(boundedIndividuals), costForPopulation(individuals), 'labour'),
    lowConfidence: isLowConfidence(coeff.confidence),
  };
};

/** D6.2 Identity & credit protection. Q20 bounds the likely population; max keeps the full estate. */
export const deriveD6_2 = (ctx: DriverContext): DriverOutput => {
  const band = ctx.profile.recordsHeld.individualsBand;
  if (band == null) {
    return null;
  }
  const coeff = ctx.coefficients.d6_2;
  const individuals = MAGNITUDE_BAND_MIDPOINT[band];
  const boundedIndividuals = boundIndividualsByRepository(individuals, ctx.profile.largestRepositoryBand);
  const perPopulationCost = coeff.takeUpRate * coeff.perEnrolleeYearCostUsd * coeff.yearsOffered;
  return {
    ...openBoundedSpread(boundedIndividuals * perPopulationCost, individuals * perPopulationCost, 'labour'),
    lowConfidence: isLowConfidence(coeff.confidence),
  };
};

interface PopulationLeg {
  likely: number,
  max: number,
}

const isPerRecordActive = (ctx: DriverContext): boolean =>
  ctx.activatedCategoryIds.has(BusinessValueCategory_PersonalData) || ctx.activatedCategoryIds.has(BusinessValueCategory_PaymentCardData);

const isB2bContractActive = (ctx: DriverContext): boolean =>
  ctx.activatedCategoryIds.has(BusinessValueCategory_DataEntrustedByOthers);

/**
 * Which population legs D7.1 and D7.2 may price. A leg its own category activates is always in;
 * when neither category is activated the scenario names no population at all, so both are allowed
 * rather than none, and the estate answers alone decide. Shared so the membership rule cannot land
 * in one of the two drivers only.
 */
const resolvePopulationLegs = (ctx: DriverContext): { canUsePerRecord: boolean, canUseB2b: boolean } => {
  const perRecord = isPerRecordActive(ctx);
  const b2b = isB2bContractActive(ctx);
  return { canUsePerRecord: perRecord || !b2b, canUseB2b: b2b || !perRecord };
};

/**
 * Combines the per-record and B2B-contract legs of the D7.1/D7.2 multi-population rule: min and
 * likely from the dominant (larger-likely) leg, max as the sum of both maxima.
 */
const combinePopulationLegs = (perRecord: PopulationLeg | null, b2b: PopulationLeg | null, coeffConfidence: CoefficientConfidence): DriverOutput => {
  const lowConfidence = isLowConfidence(coeffConfidence);
  if (perRecord != null && b2b != null) {
    const dominant = perRecord.likely >= b2b.likely ? perRecord : b2b;
    return { min: 0, likely: dominant.likely, max: perRecord.max + b2b.max, lowConfidence };
  }
  if (perRecord != null) {
    return { min: 0, likely: perRecord.likely, max: perRecord.max, lowConfidence };
  }
  if (b2b != null) {
    return { min: 0, likely: b2b.likely, max: b2b.max, lowConfidence };
  }
  return null;
};

/** D7.1 Litigation & proceedings defence. Population membership is keyed on the activation-set union. */
export const deriveD7_1 = (ctx: DriverContext): DriverOutput => {
  const coeff = ctx.coefficients.d7_1;

  const { canUsePerRecord, canUseB2b } = resolvePopulationLegs(ctx);

  const perRecord = canUsePerRecord && ctx.profile.recordsHeld.individualsBand != null
    ? (() => {
      const individuals = MAGNITUDE_BAND_MIDPOINT[ctx.profile.recordsHeld.individualsBand];
      const proceedings = (individuals / 100_000) * coeff.proceedingsPer100kRecords;
      const likely = proceedings * coeff.defenceCostPerProceedingUsd;
      return { likely, max: likely * 2 };
    })()
    : null;

  const b2b = canUseB2b && ctx.profile.customerBase.customerCountBand != null
    ? (() => {
      const customers = CUSTOMER_COUNT_MIDPOINT[ctx.profile.customerBase.customerCountBand];
      const proceedings = (customers / 100_000) * coeff.b2bProceedingsPer100kCustomers;
      const likely = proceedings * coeff.defenceCostPerProceedingUsd;
      return { likely, max: likely * 2 };
    })()
    : null;

  return combinePopulationLegs(perRecord, b2b, coeff.confidence);
};

/** D7.2 Settlements & damages. Population membership is keyed on the activation-set union. Q20 bounds the per-record leg's likely population; Q19 sets the B2B leg's cap. */
export const deriveD7_2 = (ctx: DriverContext): DriverOutput => {
  const coeff = ctx.coefficients.d7_2;

  const { canUsePerRecord, canUseB2b } = resolvePopulationLegs(ctx);

  const perRecord = canUsePerRecord && ctx.profile.recordsHeld.individualsBand != null
    ? (() => {
      const individuals = MAGNITUDE_BAND_MIDPOINT[ctx.profile.recordsHeld.individualsBand];
      const boundedIndividuals = boundIndividualsByRepository(individuals, ctx.profile.largestRepositoryBand);
      const fullMax = individuals * coeff.perRecordSettlementUsd * 2.5;
      return { likely: boundedIndividuals * coeff.perRecordSettlementUsd, max: fullMax };
    })()
    : null;

  const b2bBand = ctx.profile.contractedRevenueUnderClausesBand;
  const b2b = canUseB2b && b2bBand != null && b2bBand !== 'none' && ctx.annualRevenueUsd != null
    ? (() => {
      const contractedRevenue = ctx.annualRevenueUsd * CONTRACTED_REVENUE_FRACTION_BY_BAND[b2bBand];
      const raw = contractedRevenue * coeff.b2bSettlementRate;
      // Q19's liability cap replaces the flat b2bContractCapFraction as this leg's ceiling, and
      // bounds the leg's own spread rather than standing in for it — the same reason as D7.5's.
      // The 2.5 is the sibling per-record leg's, so one driver opens both legs the same width.
      const capFraction = resolveLiabilityCapFraction(ctx.profile.contractualLiabilityCapBand, ctx.coefficients.contractualLiabilityCapFallback.fraction);
      const cap = contractedRevenue * capFraction;
      return { likely: Math.min(raw, cap), max: Math.min(raw * 2.5, cap) };
    })()
    : null;

  return combinePopulationLegs(perRecord, b2b, coeff.confidence);
};

/**
 * D7.3 Regulatory fines. Two additive legs, each capped on its own statutory maximum, then
 * summed: a data-protection leg gated on Q9a and lifted by Q9c's sensitivity, and a sectoral
 * leg gated on Q10's named regime and capped per-regime. Independent regimes add; they never
 * multiply, so each leg's cap is checked on its own before the two maxima are summed.
 */
export const deriveD7_3 = (ctx: DriverContext): DriverOutput => {
  if (ctx.annualRevenueUsd == null) {
    return null;
  }
  const gate = ctx.profile.recordsHeld.holdsPersonalDataBeyondEmployees;
  const regime = ctx.profile.regulatoryRegime;
  if (gate == null && regime == null) {
    return null;
  }
  const revenue = ctx.annualRevenueUsd;
  const coeff = ctx.coefficients.d7_3;

  let dpLikely = 0;
  let dpMax = 0;
  if (gate === true) {
    const dp = coeff.dataProtection;
    const sensitiveBand = ctx.profile.recordsHeld.sensitiveRecordsBand;
    const lift = sensitiveBand != null && sensitiveBand !== 'none' ? dp.sensitivityLiftFactor : 1;
    const cap = Math.max(dp.capFlatUsd, revenue * dp.capRevenueFraction);
    dpMax = Math.min(revenue * dp.maxFractionOfRevenue * lift, cap);
    dpLikely = Math.min(Math.max(revenue * dp.likelyFractionOfRevenue * lift, dp.likelyFloorUsd), dpMax);
  }

  const sectoralActive = isRegulated(regime);
  let sectoralLikely = 0;
  let sectoralMax = 0;
  if (sectoralActive && regime !== null && regime !== 'none') {
    const sectoral = coeff.sectoral;
    const regimeCap = coeff.regimeCaps[regime];
    const cap = regimeCap.capFlatUsd != null ? Math.max(regimeCap.capFlatUsd, revenue * regimeCap.capRevenueFraction) : revenue * regimeCap.capRevenueFraction;
    sectoralMax = Math.min(revenue * sectoral.maxFractionOfRevenue, cap);
    sectoralLikely = Math.min(Math.max(revenue * sectoral.likelyFractionOfRevenue, sectoral.likelyFloorUsd), sectoralMax);
  }

  const likely = dpLikely + sectoralLikely;
  const max = dpMax + sectoralMax;
  const confidence: CoefficientConfidence = sectoralActive ? coeff.sectoral.confidence : coeff.dataProtection.confidence;

  // Both legs at zero means the answers declared no exposure — no personal data held and no
  // regulated sector — not that nobody priced the row. Same kind of zero as the refusal posture,
  // so it carries the same marker rather than reaching the page as three editable zeroes.
  return {
    min: 0,
    likely,
    max,
    lowConfidence: isLowConfidence(confidence, ctx.revenueLowConfidence),
    isPosture: likely === 0 && max === 0,
  };
};

/** D7.4 Payment-card ecosystem assessments. */
export const deriveD7_4 = (ctx: DriverContext): DriverOutput => {
  const band = ctx.profile.recordsHeld.paymentCardTransactionsBand;
  if (band == null) {
    return null;
  }
  const coeff = ctx.coefficients.d7_4;
  const cards = MAGNITUDE_BAND_MIDPOINT[band];
  const likely = cards * coeff.perCardAssessmentUsd;
  return { min: 0, likely, max: likely * 2, lowConfidence: isLowConfidence(coeff.confidence) };
};

/** D7.5 Contractual penalties & service credits. Q19's liability cap bounds the max, falling back to the platform default when blank; restore doubt widens the spread under that ceiling. */
export const deriveD7_5 = (ctx: DriverContext): DriverOutput => {
  const band = ctx.profile.contractedRevenueUnderClausesBand;
  if (band == null || band === 'none' || ctx.annualRevenueUsd == null) {
    return null;
  }
  const coeff = ctx.coefficients.d7_5;
  const contractedRevenue = ctx.annualRevenueUsd * CONTRACTED_REVENUE_FRACTION_BY_BAND[band];
  const restore = ctx.profile.fullRestoreBand != null ? resolveRestoreDays(ctx.profile.fullRestoreBand, ctx.sizeClass) : null;
  const outageTierMultiplier = restore != null ? clamp(restore.days / 5, 0.5, 2) : 1;
  const likely = contractedRevenue * coeff.penaltyRateOfContractedRevenue * outageTierMultiplier;

  // The aggregate cap is a ceiling on what a whole contract book could ever owe, not the bad case
  // of one incident. Spending it as the max leg puts a contract clause in five sixths of the PERT
  // mean, so the max is this driver's own heavy-tailed spread, widened by restore doubt, and the
  // cap only bounds it. A cap below that spread still binds, which is the case the card exists for.
  const capFraction = resolveLiabilityCapFraction(ctx.profile.contractualLiabilityCapBand, ctx.coefficients.contractualLiabilityCapFallback.fraction);
  const cap = contractedRevenue * capFraction;
  const doubt = restoreDoubt(ctx);
  const max = Math.min(openBaselineSpread(likely, 'heavyTailed', true).max * doubt.multiplier, cap);

  return {
    min: 0,
    likely: Math.min(likely, max),
    max,
    lowConfidence: isLowConfidence(coeff.confidence, (restore?.lowConfidence ?? false) || doubt.weak),
  };
};

/** D8.1 Customer attrition & win-back. */
export const deriveD8_1 = (ctx: DriverContext): DriverOutput => {
  const p = ctx.profile;
  if (ctx.annualRevenueUsd == null || p.grossMarginPct == null || p.customerBase.recurringRevenuePct == null) {
    return null;
  }
  const coeff = ctx.coefficients.d8_1;
  const recurringRevenue = ctx.annualRevenueUsd * (p.customerBase.recurringRevenuePct / 100);
  const restore = p.fullRestoreBand != null ? resolveRestoreDays(p.fullRestoreBand, ctx.sizeClass) : null;
  const severityMultiplier = restore != null ? clamp(restore.days / 5, 0.5, 2) : 1;
  const years = coeff.yearsBySizeClass[ctx.sizeClass];
  const marginFraction = p.grossMarginPct / 100;

  let likely = recurringRevenue * coeff.churnUpliftFraction * severityMultiplier * marginFraction * years;
  if (ctx.sizeClass === 'L') {
    likely = Math.min(likely, ctx.annualRevenueUsd * coeff.capFractionOfRevenueForL);
  }

  return {
    ...widenMaxForRestoreDoubt(openBaselineSpread(likely, 'heavyTailed', true), ctx),
    lowConfidence: isLowConfidence(coeff.confidence, (restore?.lowConfidence ?? false) || ctx.revenueLowConfidence || restoreDoubt(ctx).weak),
  };
};

/** D8.2 Competitive-advantage erosion. Emits no row when Q14 is unanswered — an early return, never a near-zero. */
export const deriveD8_2 = (ctx: DriverContext): DriverOutput => {
  const rd = ctx.profile.rdIpValue;
  if (rd == null) {
    return null;
  }
  const coeff = ctx.coefficients.d8_2;

  let rdBase: number;
  if (rd.kind === 'replacement_cost') {
    rdBase = MAGNITUDE_BAND_MIDPOINT[rd.band];
  } else {
    if (ctx.annualRevenueUsd == null) {
      return null;
    }
    rdBase = ctx.annualRevenueUsd * coeff.rdPctOfRevenueMidpoint[rd.band];
  }

  const erosion = (ctx.annualRevenueUsd ?? 0) * coeff.revenueFractionErosionPerYear * coeff.erosionYears;
  const max = rdBase + erosion;

  // What a competitor's access costs is the advantage eroded while they hold it, not the price of
  // the research itself: copying it destroys nothing. The erosion window therefore caps the central
  // estimate, and the value of what was taken caps it in turn -- no advantage is lost beyond what
  // the thing was worth. Min 0 because the honesty rules put contingent drivers at zero, and a min
  // of the whole R&D value said the best case was losing every dollar of it.
  // Without a revenue figure there is no erosion to compute, and the replacement cost is all the
  // row knows; that path is only reachable on a replacement-cost answer.
  const likely = ctx.annualRevenueUsd == null ? rdBase : Math.min(erosion, rdBase);

  return { min: 0, likely, max, lowConfidence: isLowConfidence(coeff.confidence) };
};
