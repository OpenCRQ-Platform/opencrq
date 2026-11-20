import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ActivationSetInput, CountRange, DerivationResult, FinancialProfileInput, KernelContractualLiabilityCapBand, OrganizationInput } from './derive-estimates-types';
import { AttackOutcome_Ransomware } from '../attack-outcomes/data/attack-outcomes-ids';
import { LOSS_ACTIVATION_MATRIX } from './data/loss-activation-matrix';
import {
  LossDriver_ContractualPenalties,
  LossDriver_CustomerAttritionWinBack,
  LossDriver_ExtortionPayment,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_HardwareReplacement,
  LossDriver_IdentityCreditProtection,
  LossDriver_IncrementalOperatingCost,
  LossDriver_InternalResponseSurgeLabor,
  LossDriver_LostMarginFromDowntime,
  LossDriver_NotificationCallHandling,
  LossDriver_RegulatoryFines,
  LossDriver_SettlementsDamages,
  LossDriver_SystemDataRestoration,
} from './data/loss-drivers-ids';
import { deriveEstimates, evaluateTotalSanity } from './derive-estimates';
import { COEFFICIENT_SET_V3 } from './derive-estimates-coefficients';

/** Every cell of the matrix activated at once: the widest possible activation set, reaching all eighteen non-D2.2 drivers. */
const FULL_ACTIVATION_SET: ActivationSetInput = LOSS_ACTIVATION_MATRIX.map((cell) => ({
  attackOutcomeCatalogId: cell.attackOutcomeId,
  businessValueCategoryCatalogId: cell.businessValueCategoryId,
}));

const NARROW_ACTIVATION_SET: ActivationSetInput = [
  { attackOutcomeCatalogId: AttackOutcome_Ransomware, businessValueCategoryCatalogId: LOSS_ACTIVATION_MATRIX[0].businessValueCategoryId },
];

const exact = (count: number): CountRange => ({ low: count, high: count });

const fullyAnsweredProfile = (overrides: Partial<FinancialProfileInput> = {}): FinancialProfileInput => ({
  annualRevenueUsd: 30_000_000,
  grossMarginPct: 40,
  operatingDaysBand: 'five_of_seven',
  seasonalPeakPct: 20,
  itDependentRevenuePct: 80,
  timeToRevenueImpactBand: '12_to_24h',
  fullRestoreBand: '3_to_7d',
  revenueRecaptureBand: 'partly_deferred',
  restoreTestRecency: 'within_12m',
  declaredWorkstations: exact(500),
  declaredServers: exact(20),
  recordsHeld: {
    holdsPersonalDataBeyondEmployees: true,
    individualsBand: '100k_to_500k',
    paymentCardTransactionsBand: '100k_to_500k',
    sensitiveRecordsBand: 'under_100k',
  },
  regulatoryRegime: 'none',
  customerBase: {
    customerCountBand: '100k_1m',
    b2cRevenuePct: 40,
    recurringRevenuePct: 30,
  },
  contractedRevenueUnderClausesBand: '25_to_75',
  contractualLiabilityCapBand: '25_100',
  largestRepositoryBand: 'over_5m',
  paymentFlows: {
    dailyValueBand: 'under_100k',
    outOfBandVerification: false,
    outOfBandThresholdUsd: 100_000,
  },
  rdIpValue: { kind: 'revenue_fraction', band: '2_to_8' },
  ransomPaymentPosture: true,
  ransomPaymentCeilingUsd: 50_000_000,
  costliestIncidentBand: 'none',
  worstOutageBand: 'none',
  loadedDailyLabourCostUsd: 350,
  ...overrides,
});

const organizationFixture = (overrides: Partial<OrganizationInput> = {}): OrganizationInput => ({
  revenueBand: '10m_100m',
  employeeCount: 150,
  ...overrides,
});

describe('deriveEstimates — purity and determinism', () => {
  it('touches no database, i18n or clock import in its own source', () => {
    const source = readFileSync(new URL('./derive-estimates.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"].*\/(repository|schema|db)['"]/);
    expect(source).not.toMatch(/new Date\(/);
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/from ['"]@lingui/);
  });

  it('returns identical output for identical (deep-cloned) input on every call', () => {
    const profile = fullyAnsweredProfile();
    const organization = organizationFixture();
    const activationSet = structuredClone(FULL_ACTIVATION_SET);

    const first = deriveEstimates(structuredClone(profile), structuredClone(organization), structuredClone(activationSet));
    const second = deriveEstimates(structuredClone(profile), structuredClone(organization), structuredClone(activationSet));

    expect(second).toEqual(first);
  });
});

describe('deriveEstimates — D2.2 is never derived', () => {
  it('never emits a row for Hardware & equipment replacement, fully answered or not', () => {
    const withFullAnswers = deriveEstimates(fullyAnsweredProfile(), organizationFixture(), FULL_ACTIVATION_SET);
    const withPartialAnswers = deriveEstimates(fullyAnsweredProfile({ rdIpValue: null }), organizationFixture(), NARROW_ACTIVATION_SET);

    for (const result of [withFullAnswers, withPartialAnswers]) {
      expect(result.estimates.some((e) => e.lossDriverCatalogId === LossDriver_HardwareReplacement)).toBe(false);
    }
  });
});

describe('deriveEstimates — emitted-row properties', () => {
  // Hand-rolled seeded PRNG (mulberry32): no fast-check or similar dependency added per project
  // convention (adding one would require explicit user approval).
  const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const pick = <T>(rng: () => number, values: ReadonlyArray<T>): T => values[Math.floor(rng() * values.length)];
  const maybeNull = <T>(rng: () => number, value: T): T | null => (rng() < 0.3 ? null : value);
  const randomRange = (rng: () => number, ceiling: number): CountRange => {
    const low = Math.floor(rng() * ceiling);
    return { low, high: low + Math.floor(rng() * ceiling) };
  };

  it('holds min <= likely <= max, on whole dollars, on every emitted row across 300 randomized profiles', () => {
    const rng = mulberry32(20260902);
    const magnitudeBands = ['none', 'under_100k', '100k_to_500k', '500k_to_1m', '1m_to_5m', 'over_5m'] as const;

    for (let i = 0; i < 300; i++) {
      const profile: FinancialProfileInput = {
        annualRevenueUsd: maybeNull(rng, rng() * 10_000_000_000),
        grossMarginPct: maybeNull(rng, rng() * 90),
        operatingDaysBand: maybeNull(rng, pick(rng, ['five_of_seven', 'six_of_seven', 'continuous'] as const)),
        seasonalPeakPct: maybeNull(rng, rng() * 150),
        itDependentRevenuePct: maybeNull(rng, rng() * 100),
        timeToRevenueImpactBand: maybeNull(rng, pick(rng, ['under_6h', '6_to_12h', '12_to_24h', '24_to_48h', 'over_48h'] as const)),
        fullRestoreBand: maybeNull(rng, pick(rng, ['under_1d', '1_to_3d', '3_to_7d', '1_to_2w', 'over_2w', 'unknown'] as const)),
        revenueRecaptureBand: maybeNull(rng, pick(rng, ['mostly_lost', 'partly_deferred', 'mostly_deferred'] as const)),
        restoreTestRecency: maybeNull(rng, pick(rng, ['within_12m', 'over_12m', 'never'] as const)),
        declaredWorkstations: maybeNull(rng, randomRange(rng, 5_000)),
        declaredServers: maybeNull(rng, randomRange(rng, 500)),
        recordsHeld: {
          holdsPersonalDataBeyondEmployees: maybeNull(rng, rng() > 0.5),
          individualsBand: maybeNull(rng, pick(rng, magnitudeBands)),
          paymentCardTransactionsBand: maybeNull(rng, pick(rng, magnitudeBands)),
          sensitiveRecordsBand: maybeNull(rng, pick(rng, magnitudeBands)),
        },
        regulatoryRegime: maybeNull(rng, pick(rng, ['none', 'nis2_essential', 'nis2_important', 'dora', 'other_sectoral'] as const)),
        customerBase: {
          customerCountBand: maybeNull(rng, pick(rng, ['under_1k', '1k_10k', '10k_100k', '100k_1m', 'over_1m'] as const)),
          b2cRevenuePct: maybeNull(rng, rng() * 100),
          recurringRevenuePct: maybeNull(rng, rng() * 100),
        },
        contractedRevenueUnderClausesBand: maybeNull(rng, pick(rng, ['none', 'under_25', '25_to_75', 'over_75'] as const)),
        contractualLiabilityCapBand: maybeNull(rng, pick(rng, ['under_25', '25_100', '100_200', 'over_200', 'no_cap'] as const)),
        largestRepositoryBand: maybeNull(rng, pick(rng, magnitudeBands)),
        paymentFlows: {
          dailyValueBand: maybeNull(rng, pick(rng, magnitudeBands)),
          outOfBandVerification: maybeNull(rng, rng() > 0.5),
          outOfBandThresholdUsd: maybeNull(rng, rng() * 1_000_000),
        },
        rdIpValue: maybeNull(rng, rng() > 0.5
          ? { kind: 'revenue_fraction' as const, band: pick(rng, ['none', 'under_2', '2_to_8', 'over_8'] as const) }
          : { kind: 'replacement_cost' as const, band: pick(rng, magnitudeBands) }),
        ransomPaymentPosture: maybeNull(rng, rng() > 0.5),
        ransomPaymentCeilingUsd: maybeNull(rng, rng() * 10_000_000),
        costliestIncidentBand: maybeNull(rng, pick(rng, ['none', 'under_25k', '25k_100k', '100k_500k', '500k_2m', 'over_2m'] as const)),
        worstOutageBand: maybeNull(rng, pick(rng, ['none', 'under_1d', '1_to_3d', '3_to_7d', '1_to_2w', 'over_2w'] as const)),
        loadedDailyLabourCostUsd: maybeNull(rng, 200 + rng() * 500),
      };
      const organization: OrganizationInput = {
        revenueBand: pick(rng, ['under_10m', '10m_100m', '100m_1b', '1b_10b'] as const),
        employeeCount: maybeNull(rng, Math.floor(rng() * 50_000)),
      };

      const result = deriveEstimates(profile, organization, FULL_ACTIVATION_SET);
      for (const estimate of result.estimates) {
        const where = `iteration ${i}, driver ${estimate.lossDriverCatalogId}`;
        expect(estimate.min, where).toBeLessThanOrEqual(estimate.likely);
        expect(estimate.likely, where).toBeLessThanOrEqual(estimate.max);
        // Randomized coefficients land on fractions constantly, so this is where a leg escaping
        // the rounding shows up — the analyst edits these three numbers by hand.
        expect([estimate.min, estimate.likely, estimate.max].every(Number.isInteger), where).toBe(true);
      }
    }
  });
});

describe('deriveEstimates — three synthetic fixture organizations', () => {
  const scenarios = [
    { label: '30M services company', organization: organizationFixture({ revenueBand: '10m_100m', employeeCount: 150 }), profile: fullyAnsweredProfile({ annualRevenueUsd: 30_000_000 }) },
    { label: '500M manufacturer', organization: organizationFixture({ revenueBand: '100m_1b', employeeCount: 2_500 }), profile: fullyAnsweredProfile({ annualRevenueUsd: 500_000_000 }) },
    { label: '5B bank', organization: organizationFixture({ revenueBand: '1b_10b', employeeCount: 20_000 }), profile: fullyAnsweredProfile({ annualRevenueUsd: 5_000_000_000 }) },
  ];

  for (const { label, organization, profile } of scenarios) {
    it(`derives all eighteen non-D2.2 drivers with sane order-of-magnitude values for the ${label}`, () => {
      const result = deriveEstimates(profile, organization, FULL_ACTIVATION_SET);

      expect(result.estimates.length).toBe(18);
      expect(result.coefficientSetVersion).toBe(COEFFICIENT_SET_V3.version);
      for (const estimate of result.estimates) {
        expect(estimate.min).toBeGreaterThanOrEqual(0);
        expect(estimate.max).toBeLessThan(profile.annualRevenueUsd! * 2);
      }
    });
  }
});

describe('deriveEstimates — no-input, no-row honesty', () => {
  it('emits no row for a driver whose exclusive input is unanswered', () => {
    const profile = fullyAnsweredProfile({ recordsHeld: { holdsPersonalDataBeyondEmployees: null, individualsBand: null, paymentCardTransactionsBand: null, sensitiveRecordsBand: null } });
    const result = deriveEstimates(profile, organizationFixture(), FULL_ACTIVATION_SET);

    expect(result.estimates.some((e) => e.lossDriverCatalogId === LossDriver_NotificationCallHandling)).toBe(false);
  });
});

describe('deriveEstimates — D4.1 ransom posture', () => {
  it('emits an explicit (0, 0, 0) triplet marked isPosture when Q15 is "no"', () => {
    const result = deriveEstimates(fullyAnsweredProfile({ ransomPaymentPosture: false }), organizationFixture(), FULL_ACTIVATION_SET);
    const d4_1 = result.estimates.find((e) => e.isPosture === true);

    expect(d4_1).toBeDefined();
    expect(d4_1).toMatchObject({ min: 0, likely: 0, max: 0, isPosture: true });
  });

  it('emits no row at all (not a posture triplet) when Q15 is unanswered', () => {
    const withNarrowActivation = deriveEstimates(fullyAnsweredProfile({ ransomPaymentPosture: null }), organizationFixture(), NARROW_ACTIVATION_SET);
    expect(withNarrowActivation.estimates.some((e) => e.isPosture)).toBe(false);
  });

  it('derives a nonzero demand triplet with no posture marker when Q15 is "yes"', () => {
    const result = deriveEstimates(fullyAnsweredProfile({ ransomPaymentPosture: true }), organizationFixture(), FULL_ACTIVATION_SET);
    const extortion = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ExtortionPayment);

    expect(extortion).toBeDefined();
    expect(extortion!.isPosture).toBeUndefined();
    expect(extortion!.min).toBeGreaterThan(0);
    expect(extortion!.likely).toBeGreaterThan(0);
    expect(extortion!.max).toBeGreaterThan(0);
  });
});

describe('deriveEstimates — D8.2 conditional absence', () => {
  it('emits no row when Q14 is unanswered', () => {
    const result = deriveEstimates(fullyAnsweredProfile({ rdIpValue: null }), organizationFixture(), FULL_ACTIVATION_SET);
    expect(result.estimates.length).toBe(17);
  });

  it('emits a real triplet when Q14 is answered', () => {
    const result = deriveEstimates(fullyAnsweredProfile({ rdIpValue: { kind: 'replacement_cost', band: '1m_to_5m' } }), organizationFixture(), FULL_ACTIVATION_SET);
    expect(result.estimates.length).toBe(18);
  });
});

describe('deriveEstimates — low-confidence flagging', () => {
  it('flags D1.1 and D2.1, both derived through the systems_in_scope proxy, when nothing is declared', () => {
    const result = deriveEstimates(
      fullyAnsweredProfile({ declaredWorkstations: null, declaredServers: null }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const forensics = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ForensicsIncidentManagement);
    const restoration = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_SystemDataRestoration);

    expect(forensics?.lowConfidence).toBe(true);
    expect(restoration?.lowConfidence).toBe(true);
  });

  it('leaves an anchored, non-proxy driver (D6.1) not low-confidence when its inputs are exact', () => {
    const result = deriveEstimates(fullyAnsweredProfile(), organizationFixture(), FULL_ACTIVATION_SET);
    const notification = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_NotificationCallHandling);

    expect(notification?.lowConfidence).toBe(false);
  });

  it('flags D7.5 low-confidence even with exact revenue, since its coefficient is marked weak', () => {
    const result = deriveEstimates(fullyAnsweredProfile(), organizationFixture(), FULL_ACTIVATION_SET);
    const contractualPenalties = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ContractualPenalties);

    expect(contractualPenalties?.lowConfidence).toBe(true);
  });

  it('leaves D1.4 (anchored, no revenue dependency) not low-confidence when revenue is band-estimated', () => {
    const result = deriveEstimates(
      fullyAnsweredProfile({ annualRevenueUsd: null }),
      organizationFixture({ revenueBand: '10m_100m' }),
      FULL_ACTIVATION_SET,
    );
    const internalResponse = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_InternalResponseSurgeLabor);

    expect(internalResponse?.lowConfidence).toBe(false);
  });

  it('derives D1.4 from the country benchmark at low confidence when the labour cost is blank', () => {
    const organization = organizationFixture({ countryIsoAlpha3: 'FRA' });
    const blank = deriveEstimates(fullyAnsweredProfile({ loadedDailyLabourCostUsd: null }), organization, FULL_ACTIVATION_SET);
    const answeredAtBenchmark = deriveEstimates(fullyAnsweredProfile({ loadedDailyLabourCostUsd: 480 }), organization, FULL_ACTIVATION_SET);
    const fromBlank = blank.estimates.find((e) => e.lossDriverCatalogId === LossDriver_InternalResponseSurgeLabor);
    const fromAnswer = answeredAtBenchmark.estimates.find((e) => e.lossDriverCatalogId === LossDriver_InternalResponseSurgeLabor);

    expect(fromBlank).toBeDefined();
    expect(fromAnswer?.lowConfidence).toBe(false);
    expect(fromBlank?.lowConfidence).toBe(true);
    expect([fromBlank?.min, fromBlank?.likely, fromBlank?.max]).toEqual([fromAnswer?.min, fromAnswer?.likely, fromAnswer?.max]);
  });
});

/** The same PERT-mean total `evaluateTotalSanity`'s own caller (the scenario page's service) sums a derivation's estimates into. */
const pertMeanTotal = (estimates: ReadonlyArray<{ min: number, likely: number, max: number }>): number =>
  estimates.reduce((total, e) => total + (e.min + 4 * e.likely + e.max) / 6, 0);

describe('evaluateTotalSanity — judged on a real derivation\'s own total, never clamped', () => {
  it('raises a warning without adjusting any value when the derived total exceeds 3x the anchor', () => {
    const engineeredProfile = fullyAnsweredProfile({
      annualRevenueUsd: 5_000_000,
      recordsHeld: {
        holdsPersonalDataBeyondEmployees: true,
        individualsBand: 'over_5m',
        paymentCardTransactionsBand: 'over_5m',
        sensitiveRecordsBand: 'over_5m',
      },
    });
    const org = organizationFixture({ revenueBand: 'under_10m' });
    const withoutEngineeredAnswers = deriveEstimates(fullyAnsweredProfile({ annualRevenueUsd: 5_000_000 }), org, FULL_ACTIVATION_SET);
    const engineered = deriveEstimates(engineeredProfile, org, FULL_ACTIVATION_SET);

    const warnings = evaluateTotalSanity(engineeredProfile, org, pertMeanTotal(engineered.estimates));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].ratio).toBeGreaterThan(3);

    // The warning is additive information only: the notification driver's own triplet is the raw
    // formula output, unadjusted, whether or not a warning also fired.
    const notification = engineered.estimates.find((e) => e.lossDriverCatalogId === LossDriver_NotificationCallHandling);
    const baselineNotification = withoutEngineeredAnswers.estimates.find((e) => e.lossDriverCatalogId === LossDriver_NotificationCallHandling);
    expect(notification!.likely).toBeGreaterThan(baselineNotification!.likely);
  });

  it('raises the over-pricing threshold using the revealed costliest-incident midpoint as a second anchor', () => {
    const smallOrg = organizationFixture({ revenueBand: 'under_10m' });
    const profile = fullyAnsweredProfile({ annualRevenueUsd: 1_000_000 });
    const withIncidentProfile = { ...profile, costliestIncidentBand: 'over_2m' as const };

    const derived = deriveEstimates(profile, smallOrg, FULL_ACTIVATION_SET);
    const total = pertMeanTotal(derived.estimates);

    // over_2m midpoints at 3,000,000 — far above this org's own 150,000 curve anchor (S: 15% of 1M).
    const overPricingWithout = evaluateTotalSanity(profile, smallOrg, total).find((w) => w.kind === 'over_pricing');
    const overPricingWith = evaluateTotalSanity(withIncidentProfile, smallOrg, total).find((w) => w.kind === 'over_pricing');
    expect(overPricingWithout).toBeDefined();
    expect(overPricingWithout!.anchorUsd).toBe(150_000);
    // Same derived total, but the anchor the ratio is measured against is now the revealed 3,000,000$ incident.
    expect(overPricingWith === undefined || overPricingWith.anchorUsd).not.toBe(overPricingWithout!.anchorUsd);
    if (overPricingWith != null) {
      expect(overPricingWith.anchorUsd).toBe(3_000_000);
    }
  });

  it('warns under-pricing when the derived total is below an incident already suffered, and never on a blank Q18', () => {
    const org = organizationFixture({ revenueBand: 'under_10m' });
    // A narrow activation set keeps the derived total small and easy to stay under a 3M$ incident.
    const profile = fullyAnsweredProfile({ annualRevenueUsd: 1_000_000, costliestIncidentBand: 'over_2m' });
    const total = pertMeanTotal(deriveEstimates(profile, org, NARROW_ACTIVATION_SET).estimates);

    const underPricing = evaluateTotalSanity(profile, org, total).find((w) => w.kind === 'under_pricing');
    expect(underPricing).toBeDefined();
    expect(underPricing!.anchorUsd).toBe(3_000_000);
    expect(underPricing!.expectedTotalUsd).toBeLessThan(3_000_000);

    const blankQ18Profile = fullyAnsweredProfile({ annualRevenueUsd: 1_000_000, costliestIncidentBand: null });
    expect(evaluateTotalSanity(blankQ18Profile, org, total).some((w) => w.kind === 'under_pricing')).toBe(false);
  });
});

describe('deriveEstimates — A2 seasonal peak widens the max leg only, of D3.1 and D3.2 (D3.2 inherits D3.1s widened max)', () => {
  const withPeak = (seasonalPeakPct: number | null) =>
    deriveEstimates(fullyAnsweredProfile({ seasonalPeakPct, restoreTestRecency: 'within_12m' }), organizationFixture(), FULL_ACTIVATION_SET);

  it('widens D3.1 and D3.2 max, leaving their likely and min untouched', () => {
    const baseline = withPeak(0);
    const peaked = withPeak(50);

    const baseD3_1 = baseline.estimates.find((e) => e.lossDriverCatalogId === LossDriver_LostMarginFromDowntime)!;
    const peakedD3_1 = peaked.estimates.find((e) => e.lossDriverCatalogId === LossDriver_LostMarginFromDowntime)!;
    expect(peakedD3_1.max).toBeGreaterThan(baseD3_1.max);
    expect(peakedD3_1.likely).toBe(baseD3_1.likely);
    expect(peakedD3_1.min).toBe(baseD3_1.min);

    const baseD3_2 = baseline.estimates.find((e) => e.lossDriverCatalogId === LossDriver_IncrementalOperatingCost)!;
    const peakedD3_2 = peaked.estimates.find((e) => e.lossDriverCatalogId === LossDriver_IncrementalOperatingCost)!;
    expect(peakedD3_2.max).toBeGreaterThan(baseD3_2.max);
    expect(peakedD3_2.likely).toBe(baseD3_2.likely);
  });

  it('a blank seasonal-peak answer never widens the max — a blank never costs anything', () => {
    const blank = withPeak(null);
    const zero = withPeak(0);
    const blankD3_1 = blank.estimates.find((e) => e.lossDriverCatalogId === LossDriver_LostMarginFromDowntime)!;
    const zeroD3_1 = zero.estimates.find((e) => e.lossDriverCatalogId === LossDriver_LostMarginFromDowntime)!;
    expect(blankD3_1.max).toBe(zeroD3_1.max);
  });

  it('caps the peak multiple at the frozen 3.0x ceiling', () => {
    const at200 = withPeak(200); // 1 + 200/100 = 3.0, exactly the cap
    const at500 = withPeak(500); // uncapped would be 6.0x — must clamp to the same 3.0x as at200
    const d3_1At200 = at200.estimates.find((e) => e.lossDriverCatalogId === LossDriver_LostMarginFromDowntime)!;
    const d3_1At500 = at500.estimates.find((e) => e.lossDriverCatalogId === LossDriver_LostMarginFromDowntime)!;
    expect(d3_1At500.max).toBe(d3_1At200.max);
  });
});

describe('deriveEstimates — A3 Q15s ceiling caps D4.1', () => {
  it('caps the triplet and clamps likely/min down to it when the ceiling is tighter than the computed max', () => {
    const uncapped = deriveEstimates(fullyAnsweredProfile({ ransomPaymentCeilingUsd: null }), organizationFixture(), FULL_ACTIVATION_SET);
    const capped = deriveEstimates(fullyAnsweredProfile({ ransomPaymentCeilingUsd: 100_000 }), organizationFixture(), FULL_ACTIVATION_SET);
    const uncappedD4_1 = uncapped.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ExtortionPayment)!;
    const cappedD4_1 = capped.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ExtortionPayment)!;

    expect(uncappedD4_1.max).toBeGreaterThan(100_000);
    expect(cappedD4_1.max).toBe(100_000);
    expect(cappedD4_1.likely).toBeLessThanOrEqual(100_000);
    expect(cappedD4_1.min).toBeLessThanOrEqual(cappedD4_1.likely);
  });

  it('leaves the triplet unchanged when the ceiling is generous — the platform anchor survives', () => {
    const uncapped = deriveEstimates(fullyAnsweredProfile({ ransomPaymentCeilingUsd: null }), organizationFixture(), FULL_ACTIVATION_SET);
    const generous = deriveEstimates(fullyAnsweredProfile({ ransomPaymentCeilingUsd: 100_000_000 }), organizationFixture(), FULL_ACTIVATION_SET);
    const uncappedD4_1 = uncapped.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ExtortionPayment)!;
    const generousD4_1 = generous.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ExtortionPayment)!;
    expect(generousD4_1).toEqual(uncappedD4_1);
  });

  it('leaves posture-no exactly (0, 0, 0), ceiling or not', () => {
    const result = deriveEstimates(
      fullyAnsweredProfile({ ransomPaymentPosture: false, ransomPaymentCeilingUsd: 5_000 }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const d4_1 = result.estimates.find((e) => e.isPosture === true);
    expect(d4_1).toMatchObject({ min: 0, likely: 0, max: 0, isPosture: true });
  });

  it('leaves the triplet unchanged (today\'s behavior) when Q15 is yes with a blank ceiling', () => {
    const result = deriveEstimates(fullyAnsweredProfile({ ransomPaymentCeilingUsd: null }), organizationFixture(), FULL_ACTIVATION_SET);
    const d4_1 = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ExtortionPayment)!;
    expect(d4_1.isPosture).toBeUndefined();
    expect(d4_1.min).toBeGreaterThan(0);
  });
});

describe('deriveEstimates — A5 D7.3 additive legs are near value-neutral, and fix the GDPR cap', () => {
  it('for a regulated organization holding non-sensitive personal data, likely moves to 0.005x revenue and max is exactly unchanged at 0.03x revenue', () => {
    const result = deriveEstimates(
      fullyAnsweredProfile({
        annualRevenueUsd: 30_000_000,
        recordsHeld: { holdsPersonalDataBeyondEmployees: true, individualsBand: '100k_to_500k', paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'none' },
        regulatoryRegime: 'nis2_essential',
      }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const d7_3 = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)!;
    expect(d7_3.likely).toBeCloseTo(30_000_000 * 0.005, 6);
    expect(d7_3.max).toBeCloseTo(30_000_000 * 0.03, 6);
  });

  it('lets an organization above 500M$ of revenue reach beyond the old flat 20M$ ceiling', () => {
    const result = deriveEstimates(
      fullyAnsweredProfile({
        annualRevenueUsd: 2_000_000_000,
        recordsHeld: { holdsPersonalDataBeyondEmployees: true, individualsBand: 'over_5m', paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'none' },
        regulatoryRegime: 'none',
      }),
      organizationFixture({ revenueBand: '1b_10b', employeeCount: 20_000 }),
      FULL_ACTIVATION_SET,
    );
    const d7_3 = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)!;
    expect(d7_3.max).toBeGreaterThan(20_000_000);
  });

  it('leaves an unregulated organization untouched (nothing moves)', () => {
    const result = deriveEstimates(
      fullyAnsweredProfile({
        annualRevenueUsd: 30_000_000,
        recordsHeld: { holdsPersonalDataBeyondEmployees: false, individualsBand: null, paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'none' },
        regulatoryRegime: 'none',
      }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const d7_3 = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines);
    // A declared zero, not an unpriced one: both answers say "none", so the row carries the same
    // marker the refusal posture does rather than reaching the page as three editable zeroes.
    expect(d7_3).toMatchObject({ min: 0, likely: 0, max: 0, isPosture: true });
  });

  it('leaves a priced fines row unmarked, so the marker means a declared zero and nothing else', () => {
    const result = deriveEstimates(
      fullyAnsweredProfile({
        annualRevenueUsd: 30_000_000,
        recordsHeld: { holdsPersonalDataBeyondEmployees: true, individualsBand: '100k_to_500k', paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'none' },
        regulatoryRegime: 'nis2_essential',
      }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const d7_3 = result.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)!;
    expect(d7_3.likely).toBeGreaterThan(0);
    expect(d7_3.isPosture).toBe(false);
  });

  it('applies the sensitivity lift to the data-protection leg alone, never the sectoral leg', () => {
    const nonSensitive = deriveEstimates(
      fullyAnsweredProfile({
        annualRevenueUsd: 30_000_000,
        recordsHeld: { holdsPersonalDataBeyondEmployees: true, individualsBand: '100k_to_500k', paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'none' },
        regulatoryRegime: 'nis2_essential',
      }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const sensitive = deriveEstimates(
      fullyAnsweredProfile({
        annualRevenueUsd: 30_000_000,
        recordsHeld: { holdsPersonalDataBeyondEmployees: true, individualsBand: '100k_to_500k', paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'under_100k' },
        regulatoryRegime: 'nis2_essential',
      }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const nonSensitiveD7_3 = nonSensitive.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)!;
    const sensitiveD7_3 = sensitive.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)!;
    // The lift only reaches the data-protection leg: sectoral stays revenue x 0.002 (likely) / x 0.01 (max) either way.
    expect(sensitiveD7_3.likely - nonSensitiveD7_3.likely).toBeCloseTo(30_000_000 * 0.003 * 0.5, 6); // 1.5x - 1x on the DP leg's 0.003 base
    expect(sensitiveD7_3.max - nonSensitiveD7_3.max).toBeCloseTo(30_000_000 * 0.02 * 0.5, 6);
  });
});

describe('deriveEstimates — A6 per-regime statutory caps replace the interim flat regulatedMultiplier', () => {
  // The anchored caps are the law's own euro figures (GDPR €20M, NIS2 €10M/€7M) carried into the
  // kernel's currency at the 2025-06 ECB rate; `other_sectoral` is a house anchor, so it is a
  // dollar figure in its own right.
  it('pins the frozen per-regime cap coefficients against the decision record', () => {
    expect(COEFFICIENT_SET_V3.d7_3.regimeCaps).toEqual({
      nis2_essential: { confidence: 'anchored', capFlatUsd: 11_500_000, capRevenueFraction: 0.02 },
      nis2_important: { confidence: 'anchored', capFlatUsd: 8_100_000, capRevenueFraction: 0.014 },
      dora: { confidence: 'weak', capFlatUsd: null, capRevenueFraction: 0.02 },
      other_sectoral: { confidence: 'weak', capFlatUsd: 5_000_000, capRevenueFraction: 0.01 },
    });
    expect(COEFFICIENT_SET_V3.d7_3.dataProtection).toMatchObject({ confidence: 'anchored', capFlatUsd: 23_000_000, capRevenueFraction: 0.04, sensitivityLiftFactor: 1.5 });
  });

  it('a named regime activates the sectoral leg; "none" answers a real zero', () => {
    const base = { annualRevenueUsd: 30_000_000, recordsHeld: { holdsPersonalDataBeyondEmployees: false, individualsBand: null, paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'none' } } as const;

    const named = deriveEstimates(fullyAnsweredProfile({ ...base, regulatoryRegime: 'other_sectoral' }), organizationFixture(), FULL_ACTIVATION_SET);
    const none = deriveEstimates(fullyAnsweredProfile({ ...base, regulatoryRegime: 'none' }), organizationFixture(), FULL_ACTIVATION_SET);

    const namedD7_3 = named.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)!;
    expect(namedD7_3.likely).toBeGreaterThan(0);
    // The gate answered "no personal data" explicitly, so a blank Q10 alongside it is still a real,
    // legitimately-derived zero (Honesty rules: an explicit "none"/"false" answers honestly, it is
    // only a wholly-unanswered card that stays underived).
    expect(none.estimates.find((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)).toMatchObject({ min: 0, likely: 0, max: 0 });
  });

  it('emits no row at all when both Q9a and Q10 are wholly unanswered', () => {
    const blank = deriveEstimates(
      fullyAnsweredProfile({
        annualRevenueUsd: 30_000_000,
        recordsHeld: { holdsPersonalDataBeyondEmployees: null, individualsBand: null, paymentCardTransactionsBand: 'none', sensitiveRecordsBand: 'none' },
        regulatoryRegime: null,
      }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    expect(blank.estimates.some((e) => e.lossDriverCatalogId === LossDriver_RegulatoryFines)).toBe(false);
  });
});

describe('deriveEstimates — C1 restore-test recency widens the max leg only', () => {
  const RECENCY_DRIVER_IDS = [
    LossDriver_ForensicsIncidentManagement, // D1.1
    LossDriver_InternalResponseSurgeLabor, // D1.4
    LossDriver_SystemDataRestoration, // D2.1
    LossDriver_LostMarginFromDowntime, // D3.1
    LossDriver_IncrementalOperatingCost, // D3.2
    LossDriver_ContractualPenalties, // D7.5
    LossDriver_CustomerAttritionWinBack, // D8.1
  ];

  it('pins the frozen multipliers: within_12m 1.0, over_12m 1.25, never 1.5 (weak)', () => {
    expect(COEFFICIENT_SET_V3.restoreTestRecency).toEqual({
      confidence: 'weak',
      maxMultiplierByBand: { within_12m: 1.0, over_12m: 1.25, never: 1.5 },
    });
  });

  it('widens the max of all seven restore-band drivers for "never tested", leaving likely and min untouched, and a blank costs nothing', () => {
    const within12m = deriveEstimates(fullyAnsweredProfile({ restoreTestRecency: 'within_12m' }), organizationFixture(), FULL_ACTIVATION_SET);
    const never = deriveEstimates(fullyAnsweredProfile({ restoreTestRecency: 'never' }), organizationFixture(), FULL_ACTIVATION_SET);
    const blank = deriveEstimates(fullyAnsweredProfile({ restoreTestRecency: null }), organizationFixture(), FULL_ACTIVATION_SET);

    for (const driverId of RECENCY_DRIVER_IDS) {
      const base = within12m.estimates.find((e) => e.lossDriverCatalogId === driverId)!;
      const widened = never.estimates.find((e) => e.lossDriverCatalogId === driverId)!;
      const blankResult = blank.estimates.find((e) => e.lossDriverCatalogId === driverId)!;

      expect(widened.max, driverId).toBeGreaterThan(base.max);
      expect(widened.likely, driverId).toBe(base.likely);
      expect(widened.min, driverId).toBe(base.min);
      // A blank never widens: reads the same as within_12m's own 1.0 multiplier.
      expect(blankResult.max, driverId).toBe(base.max);
    }
  });
});

describe('evaluateTotalSanity — the same verdict on a total the kernel did not derive', () => {
  // fullyAnsweredProfile declares 30M revenue and no costliest incident, so the revealed anchor is
  // supplied per case.
  const judge = (expectedTotalUsd: number, overrides: Partial<FinancialProfileInput> = {}) => evaluateTotalSanity(
    fullyAnsweredProfile(overrides),
    organizationFixture(),
    expectedTotalUsd,
  );

  it('says nothing about a total that sits between the two anchors', () => {
    expect(judge(3_000_000)).toEqual([]);
  });

  it('still judges a total that comes to exactly zero', () => {
    // An explicit refusal posture, or a manual (0,0,0) row, is a priced zero and not an absence of
    // pricing: against a declared incident it is precisely what under-pricing means.
    const warnings = judge(0, { costliestIncidentBand: '500k_2m' });
    expect(warnings.map((w) => w.kind)).toEqual(['under_pricing']);
  });

  it('flags a total far above what the organization\'s scale makes plausible', () => {
    const warnings = judge(500_000_000);
    expect(warnings.map((w) => w.kind)).toEqual(['over_pricing']);
    expect(warnings[0].ratio).toBeGreaterThan(3);
  });

  it('flags a total below a loss the organization reports having suffered', () => {
    const warnings = judge(1_000, { costliestIncidentBand: '100k_500k' });
    expect(warnings.map((w) => w.kind)).toEqual(['under_pricing']);
    expect(warnings[0].anchorUsd).toBe(223_607);
  });

  it('holds no opinion on a small total when no incident was declared', () => {
    expect(judge(1_000)).toEqual([]);
  });

  it('holds no opinion when revenue is unknown, rather than a reassuring one', () => {
    expect(evaluateTotalSanity(
      fullyAnsweredProfile({ annualRevenueUsd: null }),
      organizationFixture({ revenueBand: null }),
      500_000_000,
    )).toEqual([]);
  });

});

describe('deriveEstimates — C2 a revealed outage widens the max of the drivers built on the restore band', () => {
  // fullyAnsweredProfile restores in '3_to_7d', a five-day target, and tested within twelve months.
  const RESTORE_DOUBT_DRIVER_IDS = [
    LossDriver_ForensicsIncidentManagement, // D1.1
    LossDriver_InternalResponseSurgeLabor, // D1.4
    LossDriver_SystemDataRestoration, // D2.1
    LossDriver_LostMarginFromDowntime, // D3.1
    LossDriver_IncrementalOperatingCost, // D3.2
    LossDriver_ContractualPenalties, // D7.5
    LossDriver_CustomerAttritionWinBack, // D8.1
  ];

  const derive = (overrides: Partial<FinancialProfileInput>) => deriveEstimates(fullyAnsweredProfile(overrides), organizationFixture(), FULL_ACTIVATION_SET);
  const driver = (result: ReturnType<typeof derive>, driverId: string) => result.estimates.find((e) => e.lossDriverCatalogId === driverId)!;

  it('pins the frozen ceiling: three times the target at most, weak', () => {
    expect(COEFFICIENT_SET_V3.revealedOutage).toEqual({ confidence: 'weak', maxOverrunMultiplier: 3.0 });
  });

  it('costs nothing when the history stayed inside the target, and nothing when the card is blank', () => {
    const base = derive({ worstOutageBand: 'none' });
    const inside = derive({ worstOutageBand: '1_to_3d' });
    const blank = derive({ worstOutageBand: null });

    for (const driverId of RESTORE_DOUBT_DRIVER_IDS) {
      expect(driver(inside, driverId).max, driverId).toBe(driver(base, driverId).max);
      expect(driver(blank, driverId).max, driverId).toBe(driver(base, driverId).max);
    }
  });

  it('widens the max in proportion to the overrun, leaving likely and min untouched', () => {
    const base = derive({ worstOutageBand: 'none' });
    // Ten and a half days against a five-day target.
    const overran = derive({ worstOutageBand: '1_to_2w' });

    const baseD3_1 = driver(base, LossDriver_LostMarginFromDowntime);
    const overranD3_1 = driver(overran, LossDriver_LostMarginFromDowntime);
    // Four decimals, not six: the legs are rounded to whole dollars on the way out, so the ratio of
    // two of them carries that rounding and can no longer be exact to the coefficient's precision.
    expect(overranD3_1.max / baseD3_1.max).toBeCloseTo(10.5 / 5, 4);

    for (const driverId of RESTORE_DOUBT_DRIVER_IDS) {
      expect(driver(overran, driverId).max, driverId).toBeGreaterThan(driver(base, driverId).max);
      expect(driver(overran, driverId).likely, driverId).toBe(driver(base, driverId).likely);
      expect(driver(overran, driverId).min, driverId).toBe(driver(base, driverId).min);
    }
  });

  it('stops widening at the ceiling, so one catastrophic week cannot swamp the estimate', () => {
    const base = derive({ worstOutageBand: 'none' });
    // Twenty-one days against a five-day target is a 4.2 overrun, held at 3.0.
    const capped = derive({ worstOutageBand: 'over_2w' });

    expect(driver(capped, LossDriver_LostMarginFromDowntime).max / driver(base, LossDriver_LostMarginFromDowntime).max).toBeCloseTo(3.0, 4);
  });

  it('takes the stronger of an untested restore and a revealed overrun, never their product', () => {
    const untestedOnly = derive({ restoreTestRecency: 'never', worstOutageBand: 'none' });
    const revealedOnly = derive({ restoreTestRecency: 'within_12m', worstOutageBand: 'over_2w' });
    const both = derive({ restoreTestRecency: 'never', worstOutageBand: 'over_2w' });

    for (const driverId of RESTORE_DOUBT_DRIVER_IDS) {
      // 1.5 and 3.0 resolve to 3.0, not to 4.5: one weakness is not charged twice.
      expect(driver(both, driverId).max, driverId).toBe(driver(revealedOnly, driverId).max);
      expect(driver(both, driverId).max, driverId).toBeGreaterThan(driver(untestedOnly, driverId).max);
    }
  });

  it('never lowers a max as the revealed outage worsens', () => {
    const ladder = (['none', 'under_1d', '1_to_3d', '3_to_7d', '1_to_2w', 'over_2w'] as const).map((band) => derive({ worstOutageBand: band }));

    for (const driverId of RESTORE_DOUBT_DRIVER_IDS) {
      const maxes = ladder.map((result) => driver(result, driverId).max);
      expect(maxes, driverId).toEqual([...maxes].sort((a, b) => a - b));
    }
  });
});

describe('deriveEstimates — C3 Q19s liability cap bounds the D7.2 B2B and D7.5 maxima', () => {
  const CONTRACTED_REVENUE_UNDER_25_TO_75 = 30_000_000 * 0.5; // fullyAnsweredProfile's default '25_to_75' band, on a 30M revenue
  const d7_5 = (r: DerivationResult) => r.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ContractualPenalties)!;
  const derive = (overrides: Partial<FinancialProfileInput>) => deriveEstimates(fullyAnsweredProfile(overrides), organizationFixture(), FULL_ACTIVATION_SET);

  /**
   * An aggregate cap is what a whole contract book could ever owe, not the bad case of one
   * incident, so it bounds the driver's own spread instead of standing in for it. The cap
   * therefore binds only where an organization declares a genuinely low ceiling: the widened
   * spread reaches 0.07 x outage tier x restore doubt of contracted revenue, at most 0.28, so
   * `under_25` is the one band that can ever be the binding constraint.
   */
  it('bounds D7.5s max at the cap when the cap sits below the drivers own spread', () => {
    // A three-week restore doubles the outage tier, lifting the spread above the 12.5% ceiling.
    const result = derive({ fullRestoreBand: 'over_2w', contractualLiabilityCapBand: 'under_25' });
    expect(d7_5(result).max).toBeCloseTo(CONTRACTED_REVENUE_UNDER_25_TO_75 * 0.125, 2);
  });

  it('leaves the max at the drivers own spread when the cap sits above it', () => {
    // The default profile's likely is 0.02 of contracted revenue; the heavy-tailed spread opens it
    // to 3.5x, which every ceiling from 25_100 up clears -- so none of them moves the figure.
    const spreadMax = CONTRACTED_REVENUE_UNDER_25_TO_75 * 0.02 * 3.5;
    for (const band of ['25_100', '100_200', 'over_200', 'no_cap'] as const) {
      expect(d7_5(derive({ contractualLiabilityCapBand: band })).max, band).toBeCloseTo(spreadMax, 2);
    }
    // A blank card falls back to 0.3, which is above the reachable spread too: not knowing the
    // ceiling never invents a binding one.
    expect(d7_5(derive({ contractualLiabilityCapBand: null })).max).toBeCloseTo(spreadMax, 2);
  });

  it('prices no_cap at least as high as any declared ceiling, never below it', () => {
    // An uncapped contract is the worst contractual position on the card, so it must never derive a
    // smaller max than a declared ceiling does. Its true exposure is unbounded and cannot be emitted.
    const binding = { fullRestoreBand: 'over_2w' } as const;
    const uncapped = d7_5(derive({ ...binding, contractualLiabilityCapBand: 'no_cap' }));
    for (const band of ['under_25', '25_100', '100_200', 'over_200'] as const) {
      expect(uncapped.max, band).toBeGreaterThanOrEqual(d7_5(derive({ ...binding, contractualLiabilityCapBand: band })).max);
    }
    expect(uncapped.max).toBeGreaterThan(d7_5(derive({ ...binding, contractualLiabilityCapBand: 'under_25' })).max);
  });

  it('bounds D7.2s B2B max the same way, on the same cap', () => {
    const noPersonalData = {
      recordsHeld: { holdsPersonalDataBeyondEmployees: null, individualsBand: null, paymentCardTransactionsBand: null, sensitiveRecordsBand: null },
    };
    const b2bMax = (band: KernelContractualLiabilityCapBand) => deriveEstimates(
      fullyAnsweredProfile({ ...noPersonalData, contractualLiabilityCapBand: band }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    ).estimates.find((e) => e.lossDriverCatalogId === LossDriver_SettlementsDamages)!.max;

    // The leg's own spread is 2.5x its 0.06 settlement rate, so 0.15 of contracted revenue.
    expect(b2bMax('100_200')).toBeCloseTo(CONTRACTED_REVENUE_UNDER_25_TO_75 * 0.15, 2);
    // `under_25` sits below that, so there the cap is what the max reads.
    expect(b2bMax('under_25')).toBeCloseTo(CONTRACTED_REVENUE_UNDER_25_TO_75 * 0.125, 2);
  });
});

describe('deriveEstimates: declared workstations and servers replace the proxies and drop the low-confidence flag only when both are declared', () => {
  it('drops the flag on D1.1 and D2.1 only when both counts are declared; one side alone keeps it', () => {
    const both = deriveEstimates(fullyAnsweredProfile({ declaredWorkstations: exact(500), declaredServers: exact(20) }), organizationFixture(), FULL_ACTIVATION_SET);
    const workstationsOnly = deriveEstimates(fullyAnsweredProfile({ declaredWorkstations: exact(500), declaredServers: null }), organizationFixture(), FULL_ACTIVATION_SET);
    const serverOnly = deriveEstimates(fullyAnsweredProfile({ declaredWorkstations: null, declaredServers: exact(20) }), organizationFixture(), FULL_ACTIVATION_SET);
    const neither = deriveEstimates(fullyAnsweredProfile({ declaredWorkstations: null, declaredServers: null }), organizationFixture(), FULL_ACTIVATION_SET);

    for (const driverId of [LossDriver_ForensicsIncidentManagement, LossDriver_SystemDataRestoration]) {
      expect(both.estimates.find((e) => e.lossDriverCatalogId === driverId)?.lowConfidence, driverId).toBe(false);
      expect(workstationsOnly.estimates.find((e) => e.lossDriverCatalogId === driverId)?.lowConfidence, driverId).toBe(true);
      expect(serverOnly.estimates.find((e) => e.lossDriverCatalogId === driverId)?.lowConfidence, driverId).toBe(true);
      expect(neither.estimates.find((e) => e.lossDriverCatalogId === driverId)?.lowConfidence, driverId).toBe(true);
    }
  });

  it('keeps the flag when a weak coefficient widened the max, even with both counts declared', () => {
    // An untested restore widens these maxima through a coefficient marked weak. A row whose max
    // moved on a weak coefficient cannot report itself anchored, however exact its inputs were.
    const untestedRestore = deriveEstimates(
      fullyAnsweredProfile({ declaredWorkstations: exact(500), declaredServers: exact(20), restoreTestRecency: 'never' }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );

    for (const driverId of [
      LossDriver_ForensicsIncidentManagement,
      LossDriver_InternalResponseSurgeLabor,
      LossDriver_SystemDataRestoration,
      LossDriver_LostMarginFromDowntime,
      LossDriver_ContractualPenalties,
      LossDriver_CustomerAttritionWinBack,
    ]) {
      expect(untestedRestore.estimates.find((e) => e.lossDriverCatalogId === driverId)?.lowConfidence, driverId).toBe(true);
    }
  });

  it('leaves a row anchored when the widening resolved to exactly one', () => {
    const testedRestore = deriveEstimates(
      fullyAnsweredProfile({ declaredWorkstations: exact(500), declaredServers: exact(20), restoreTestRecency: 'within_12m', worstOutageBand: 'none' }),
      organizationFixture(),
      FULL_ACTIVATION_SET,
    );
    const forensics = testedRestore.estimates.find((e) => e.lossDriverCatalogId === LossDriver_ForensicsIncidentManagement);
    expect(forensics?.lowConfidence).toBe(false);
  });

  it('replaces the proxies with the declared counts', () => {
    const proxied = deriveEstimates(fullyAnsweredProfile({ declaredWorkstations: null, declaredServers: null }), organizationFixture({ employeeCount: 150 }), FULL_ACTIVATION_SET);
    const answered = deriveEstimates(fullyAnsweredProfile({ declaredWorkstations: exact(5), declaredServers: exact(1) }), organizationFixture({ employeeCount: 150 }), FULL_ACTIVATION_SET);

    const proxiedD2_1 = proxied.estimates.find((e) => e.lossDriverCatalogId === LossDriver_SystemDataRestoration)!;
    const answeredD2_1 = answered.estimates.find((e) => e.lossDriverCatalogId === LossDriver_SystemDataRestoration)!;
    // Tiny declared counts (5 workstations, 1 server) replace the much larger employee-count proxy, never average with it.
    expect(answeredD2_1.likely).toBeCloseTo((5 * 180 + 1 * 2_500) * 1, 2);
    expect(answeredD2_1.likely).toBeLessThan(proxiedD2_1.likely);
  });
});

describe('deriveEstimates: a declared range prices D1.1 and D2.1 at its low, middle and high counts', () => {
  const driverOf = (profile: Partial<FinancialProfileInput>, driverId: string) =>
    deriveEstimates(fullyAnsweredProfile(profile), organizationFixture(), FULL_ACTIVATION_SET).estimates.find((e) => e.lossDriverCatalogId === driverId)!;

  it('takes each leg from the exact count at its own point, the middle on a log scale', () => {
    const ranged = { declaredWorkstations: { low: 1_001, high: 5_000 }, declaredServers: { low: 51, high: 250 } };
    const atLow = { declaredWorkstations: exact(1_001), declaredServers: exact(51) };
    const atMid = { declaredWorkstations: exact(Math.sqrt(1_001 * 5_000)), declaredServers: exact(Math.sqrt(51 * 250)) };
    const atHigh = { declaredWorkstations: exact(5_000), declaredServers: exact(250) };

    for (const driverId of [LossDriver_ForensicsIncidentManagement, LossDriver_SystemDataRestoration]) {
      const range = driverOf(ranged, driverId);
      expect(range.min, driverId).toBeCloseTo(driverOf(atLow, driverId).min, 6);
      expect(range.likely, driverId).toBeCloseTo(driverOf(atMid, driverId).likely, 6);
      expect(range.max, driverId).toBeCloseTo(driverOf(atHigh, driverId).max, 6);
      expect(range.min, driverId).toBeLessThan(driverOf(atMid, driverId).min);
      expect(range.max, driverId).toBeGreaterThan(driverOf(atMid, driverId).max);
      expect(range.lowConfidence, driverId).toBe(false);
    }
  });

  it('opens an exact count with the labour spread around one amount', () => {
    for (const driverId of [LossDriver_ForensicsIncidentManagement, LossDriver_SystemDataRestoration]) {
      const estimate = driverOf({}, driverId);
      expect(estimate.min, driverId).toBe(estimate.likely * 0.7);
      expect(estimate.max, driverId).toBe(estimate.likely * 1.6);
    }
  });

  it('clamps the D1.1 workstation factor at each count, not on the result', () => {
    const forensics = (low: number, high: number) => driverOf({ declaredWorkstations: { low, high } }, LossDriver_ForensicsIncidentManagement);
    // 100 and 200 workstations both clamp to the 0.2 floor, 3,000 and 25,000 both to the ceiling of 3.
    expect(forensics(100, 25_000).min).toBe(forensics(200, 25_000).min);
    expect(forensics(100, 25_000).max).toBe(forensics(100, 3_000).max);
  });

  it('reads a range starting at 0 linearly', () => {
    const fromZero = driverOf({ declaredWorkstations: { low: 0, high: 10 } }, LossDriver_SystemDataRestoration);
    expect(fromZero.likely).toBe(driverOf({ declaredWorkstations: exact(5) }, LossDriver_SystemDataRestoration).likely);
  });
});

describe('deriveEstimates — C5 Q20 bounds the likely population only, max keeps the full estate', () => {
  it('bounds likely on D6.1, D6.2 and D7.2s per-record leg, leaving max at the full estate', () => {
    const isolatePerRecordLeg = { contractedRevenueUnderClausesBand: 'none' } as const;
    const fullEstate = deriveEstimates(fullyAnsweredProfile({ ...isolatePerRecordLeg, largestRepositoryBand: null }), organizationFixture(), FULL_ACTIVATION_SET);
    const bounded = deriveEstimates(fullyAnsweredProfile({ ...isolatePerRecordLeg, largestRepositoryBand: 'under_100k' }), organizationFixture(), FULL_ACTIVATION_SET);

    for (const driverId of [LossDriver_NotificationCallHandling, LossDriver_IdentityCreditProtection, LossDriver_SettlementsDamages]) {
      const full = fullEstate.estimates.find((e) => e.lossDriverCatalogId === driverId)!;
      const boundedEstimate = bounded.estimates.find((e) => e.lossDriverCatalogId === driverId)!;
      expect(boundedEstimate.likely, driverId).toBeLessThan(full.likely);
      expect(boundedEstimate.max, driverId).toBe(full.max);
    }
  });

  it('a blank Q20 reads the full estate for both likely and max, as today', () => {
    const isolatePerRecordLeg = { contractedRevenueUnderClausesBand: 'none' } as const;
    const blank = deriveEstimates(fullyAnsweredProfile({ ...isolatePerRecordLeg, largestRepositoryBand: null }), organizationFixture(), FULL_ACTIVATION_SET);
    // individualsBand's default midpoint (223,607) is well under 'over_5m' (7,500,000), so a generous repository band never binds either — same as blank.
    const generous = deriveEstimates(fullyAnsweredProfile({ ...isolatePerRecordLeg, largestRepositoryBand: 'over_5m' }), organizationFixture(), FULL_ACTIVATION_SET);

    for (const driverId of [LossDriver_NotificationCallHandling, LossDriver_IdentityCreditProtection, LossDriver_SettlementsDamages]) {
      const blankEstimate = blank.estimates.find((e) => e.lossDriverCatalogId === driverId)!;
      const generousEstimate = generous.estimates.find((e) => e.lossDriverCatalogId === driverId)!;
      expect(generousEstimate.likely, driverId).toBe(blankEstimate.likely);
    }
  });
});
