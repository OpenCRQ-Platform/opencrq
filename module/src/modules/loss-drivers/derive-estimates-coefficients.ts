import type { CoefficientConfidence, KernelRestoreTestRecency, SizeClass } from './derive-estimates-types';

/**
 * Versioned coefficient set for the derivation kernel, independent of the loss-model versioning.
 * Numeric values are not frozen — only the provenance and confidence marks are. These are the
 * platform's own working anchors, validated against the three synthetic fixture organizations in
 * `derive-estimates.test.ts`; revisit them as real benchmark research lands.
 */

export const COEFFICIENT_SET_VERSION = 'financial-onboarding-coefficients-v3';

const bySizeClass = <T>(s: T, m: T, l: T): Record<SizeClass, T> => ({ S: s, M: m, L: l });

export interface D1_1Coefficients {
  confidence: CoefficientConfidence,
  engagementDaysBySizeClass: Record<SizeClass, number>,
  dailyRateUsd: number,
}

export interface D1_2Coefficients {
  confidence: CoefficientConfidence,
  baseHoursBySizeClass: Record<SizeClass, number>,
  hourlyRateUsd: number,
  regulatedMultiplier: number,
}

export interface D1_3Coefficients {
  confidence: CoefficientConfidence,
  flatAmountByTierUsd: { none: number, low: number, medium: number, high: number },
}

export interface D1_4Coefficients {
  confidence: CoefficientConfidence,
  engagedHeadcountFractionBySizeClass: Record<SizeClass, number>,
}

export interface D2_1Coefficients {
  confidence: CoefficientConfidence,
  reimageUnitCostUsd: number,
  serverRebuildUnitCostUsd: number,
}

export interface D3_1Coefficients {
  confidence: CoefficientConfidence,
  capacityLossFactor: number,
  likelyOutageFractionOfRestoreBand: number,
  revenueCapFractionBySizeClass: Record<SizeClass, number>,
}

/** `peakMultiple = 1 + seasonalPeakPct / 100`, capped here. Widens the max leg of D3.1/D3.2 only. */
export interface SeasonalPeakCoefficients {
  confidence: CoefficientConfidence,
  capMultiple: number,
}

/** Max-leg-only multiplier read by every driver scaled on the restore band (D1.1, D1.4, D2.1, D3.1, D3.2, D7.5, D8.1). A blank profile answer reads as 1.0, never widening. */
export interface RestoreTestRecencyCoefficients {
  confidence: CoefficientConfidence,
  maxMultiplierByBand: Record<KernelRestoreTestRecency, number>,
}

/**
 * How far a revealed outage may widen the max of the drivers built on the restore band.
 * The multiple itself is the organization's own overrun, so only the ceiling is a coefficient —
 * and it is weak: a noise bound chosen so one bad week in three years cannot swamp the estimate,
 * not a finding from continuity data. It sits at twice what a never-tested restore does, since a
 * demonstrated failure is stronger evidence than an untested plan.
 */
export interface RevealedOutageCoefficients {
  confidence: CoefficientConfidence,
  maxOverrunMultiplier: number,
}

/** The fraction of contracted revenue Q19's cap represents when the card is blank. */
export interface ContractualLiabilityCapFallbackCoefficients {
  confidence: CoefficientConfidence,
  fraction: number,
}

export interface D3_2Coefficients {
  confidence: CoefficientConfidence,
  fractionOfD3_1: number,
}

export interface D4_1Coefficients {
  confidence: CoefficientConfidence,
  demandRateFractionOfRevenueBySizeClass: Record<SizeClass, number>,
  floorUsd: number,
  paymentRatio: number,
}

export interface D5_1Coefficients {
  confidence: CoefficientConfidence,
  nonRecoveryRate: number,
  outOfBandVerificationMitigation: number,
  exposureDaysSaturation: number,
}

export interface D6_1Coefficients {
  confidence: CoefficientConfidence,
  perIndividualCostUsd: number,
  sensitiveRecordMultiplier: number,
}

export interface D6_2Coefficients {
  confidence: CoefficientConfidence,
  takeUpRate: number,
  perEnrolleeYearCostUsd: number,
  yearsOffered: number,
}

export interface D7_1Coefficients {
  confidence: CoefficientConfidence,
  defenceCostPerProceedingUsd: number,
  proceedingsPer100kRecords: number,
  b2bProceedingsPer100kCustomers: number,
}

export interface D7_2Coefficients {
  confidence: CoefficientConfidence,
  perRecordSettlementUsd: number,
  b2bSettlementRate: number,
}

/** The data-protection leg, gated on Q9a and lifted by Q9c's sensitivity. Anchored on GDPR article 83(5). */
export interface D7_3DataProtectionLegCoefficients {
  confidence: CoefficientConfidence,
  likelyFractionOfRevenue: number,
  likelyFloorUsd: number,
  maxFractionOfRevenue: number,
  /** GDPR article 83(5): €20M or 4% of turnover, whichever is higher, carried here at the 2025-06 ECB rate. */
  capFlatUsd: number,
  capRevenueFraction: number,
  sensitivityLiftFactor: number,
}

/** The sectoral leg, gated on Q10 naming a regime. Rates are weak: two-thirds of the data-protection rates. */
export interface D7_3SectoralLegCoefficients {
  confidence: CoefficientConfidence,
  likelyFractionOfRevenue: number,
  likelyFloorUsd: number,
  maxFractionOfRevenue: number,
}

/**
 * One statutory cap per named regime, the NIS2 pair carrying its directive's euro figure at the
 * 2025-06 ECB rate. `capFlatUsd` is null for `dora`, whose cap is a pure revenue fraction with no
 * flat floor.
 */
export interface RegulatoryRegimeCapCoefficients {
  confidence: CoefficientConfidence,
  capFlatUsd: number | null,
  capRevenueFraction: number,
}

export interface D7_3Coefficients {
  dataProtection: D7_3DataProtectionLegCoefficients,
  sectoral: D7_3SectoralLegCoefficients,
  regimeCaps: Record<'nis2_essential' | 'nis2_important' | 'dora' | 'other_sectoral', RegulatoryRegimeCapCoefficients>,
}

export interface D7_4Coefficients {
  confidence: CoefficientConfidence,
  perCardAssessmentUsd: number,
}

export interface D7_5Coefficients {
  confidence: CoefficientConfidence,
  penaltyRateOfContractedRevenue: number,
}

export interface D8_1Coefficients {
  confidence: CoefficientConfidence,
  churnUpliftFraction: number,
  yearsBySizeClass: Record<SizeClass, number>,
  capFractionOfRevenueForL: number,
}

export interface D8_2Coefficients {
  confidence: CoefficientConfidence,
  erosionYears: number,
  revenueFractionErosionPerYear: number,
  rdPctOfRevenueMidpoint: { none: number, under_2: number, '2_to_8': number, over_8: number },
}

export interface CoefficientSet {
  version: string,
  seasonalPeak: SeasonalPeakCoefficients,
  restoreTestRecency: RestoreTestRecencyCoefficients,
  revealedOutage: RevealedOutageCoefficients,
  contractualLiabilityCapFallback: ContractualLiabilityCapFallbackCoefficients,
  d1_1: D1_1Coefficients,
  d1_2: D1_2Coefficients,
  d1_3: D1_3Coefficients,
  d1_4: D1_4Coefficients,
  d2_1: D2_1Coefficients,
  d3_1: D3_1Coefficients,
  d3_2: D3_2Coefficients,
  d4_1: D4_1Coefficients,
  d5_1: D5_1Coefficients,
  d6_1: D6_1Coefficients,
  d6_2: D6_2Coefficients,
  d7_1: D7_1Coefficients,
  d7_2: D7_2Coefficients,
  d7_3: D7_3Coefficients,
  d7_4: D7_4Coefficients,
  d7_5: D7_5Coefficients,
  d8_1: D8_1Coefficients,
  d8_2: D8_2Coefficients,
}

export const COEFFICIENT_SET_V3: CoefficientSet = {
  version: COEFFICIENT_SET_VERSION,
  seasonalPeak: {
    confidence: 'weak',
    capMultiple: 3.0,
  },
  restoreTestRecency: {
    confidence: 'weak',
    maxMultiplierByBand: { within_12m: 1.0, over_12m: 1.25, never: 1.5 },
  },
  revealedOutage: {
    confidence: 'weak',
    maxOverrunMultiplier: 3.0,
  },
  contractualLiabilityCapFallback: {
    confidence: 'weak',
    fraction: 0.3,
  },
  d1_1: {
    confidence: 'weak',
    engagementDaysBySizeClass: bySizeClass(10, 20, 35),
    dailyRateUsd: 1_200,
  },
  d1_2: {
    confidence: 'anchored',
    baseHoursBySizeClass: bySizeClass(40, 100, 250),
    hourlyRateUsd: 450,
    regulatedMultiplier: 1.5,
  },
  d1_3: {
    confidence: 'weak',
    flatAmountByTierUsd: { none: 0, low: 15_000, medium: 60_000, high: 200_000 },
  },
  d1_4: {
    confidence: 'anchored',
    engagedHeadcountFractionBySizeClass: bySizeClass(0.08, 0.05, 0.03),
  },
  d2_1: {
    confidence: 'weak',
    reimageUnitCostUsd: 180,
    serverRebuildUnitCostUsd: 2_500,
  },
  d3_1: {
    confidence: 'anchored',
    capacityLossFactor: 0.7,
    likelyOutageFractionOfRestoreBand: 0.6,
    revenueCapFractionBySizeClass: bySizeClass(0.25, 0.15, 0.08),
  },
  d3_2: {
    confidence: 'weak',
    fractionOfD3_1: 0.25,
  },
  d4_1: {
    confidence: 'anchored',
    demandRateFractionOfRevenueBySizeClass: bySizeClass(0.015, 0.008, 0.003),
    floorUsd: 25_000,
    paymentRatio: 0.6,
  },
  d5_1: {
    confidence: 'weak',
    nonRecoveryRate: 0.6,
    outOfBandVerificationMitigation: 0.5,
    exposureDaysSaturation: 5,
  },
  d6_1: {
    confidence: 'anchored',
    perIndividualCostUsd: 5,
    sensitiveRecordMultiplier: 3,
  },
  d6_2: {
    confidence: 'unanchored',
    takeUpRate: 0.1,
    perEnrolleeYearCostUsd: 30,
    yearsOffered: 2,
  },
  d7_1: {
    confidence: 'weak',
    defenceCostPerProceedingUsd: 45_000,
    proceedingsPer100kRecords: 0.4,
    b2bProceedingsPer100kCustomers: 1.2,
  },
  d7_2: {
    confidence: 'weak',
    perRecordSettlementUsd: 8,
    // One incident settles this share of the whole contract book. At 0.1 the leg's likely alone
    // reached 1.67x the largest loss the same kernel calls plausible for the organization.
    b2bSettlementRate: 0.06,
  },
  d7_3: {
    dataProtection: {
      confidence: 'anchored',
      likelyFractionOfRevenue: 0.003,
      likelyFloorUsd: 10_000,
      maxFractionOfRevenue: 0.02,
      capFlatUsd: 23_000_000,
      capRevenueFraction: 0.04,
      sensitivityLiftFactor: 1.5,
    },
    sectoral: {
      confidence: 'weak',
      likelyFractionOfRevenue: 0.002,
      likelyFloorUsd: 10_000,
      maxFractionOfRevenue: 0.01,
    },
    regimeCaps: {
      nis2_essential: { confidence: 'anchored', capFlatUsd: 11_500_000, capRevenueFraction: 0.02 },
      nis2_important: { confidence: 'anchored', capFlatUsd: 8_100_000, capRevenueFraction: 0.014 },
      dora: { confidence: 'weak', capFlatUsd: null, capRevenueFraction: 0.02 },
      other_sectoral: { confidence: 'weak', capFlatUsd: 5_000_000, capRevenueFraction: 0.01 },
    },
  },
  d7_4: {
    confidence: 'weak',
    perCardAssessmentUsd: 12,
  },
  d7_5: {
    confidence: 'weak',
    penaltyRateOfContractedRevenue: 0.02,
  },
  d8_1: {
    confidence: 'anchored',
    churnUpliftFraction: 0.03,
    yearsBySizeClass: bySizeClass(2, 2, 1.5),
    capFractionOfRevenueForL: 0.05,
  },
  d8_2: {
    confidence: 'weak',
    erosionYears: 3,
    revenueFractionErosionPerYear: 0.01,
    // Band midpoints on the questionnaire's own convention, which is the honest one here: R&D
    // intensity is right-skewed across firms, so more of them sit near 2-3% than near 7-8%.
    rdPctOfRevenueMidpoint: { none: 0, under_2: 0.01, '2_to_8': 0.04, over_8: 0.12 },
  },
};
