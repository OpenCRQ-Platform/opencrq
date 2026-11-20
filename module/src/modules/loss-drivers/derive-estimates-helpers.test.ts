import { describe, expect, it } from 'vitest';
import type { FinancialProfileInput, OrganizationInput } from './derive-estimates-types';
import {
  countRangeMidpoint,
  CUSTOMER_COUNT_MIDPOINT,
  deriveSizeClass,
  deriveSystemsInScope,
  openBaselineSpread,
  resolveAnnualRevenueUsd,
  resolveLiabilityCapFraction,
  resolveLoadedDailyLabourCostUsd,
  resolveRestoreDays,
  revealedOutageOverrun,
  SIZE_CLASS_MEDIUM_MAX_USD,
  SIZE_CLASS_SMALL_MAX_USD,
} from './derive-estimates-helpers';

describe('deriveSizeClass', () => {
  it('clamps at the band edges with no interpolation', () => {
    expect(deriveSizeClass(0)).toBe('S');
    expect(deriveSizeClass(SIZE_CLASS_SMALL_MAX_USD - 1)).toBe('S');
    expect(deriveSizeClass(SIZE_CLASS_SMALL_MAX_USD)).toBe('M');
    expect(deriveSizeClass(SIZE_CLASS_MEDIUM_MAX_USD - 1)).toBe('M');
    expect(deriveSizeClass(SIZE_CLASS_MEDIUM_MAX_USD)).toBe('L');
    expect(deriveSizeClass(SIZE_CLASS_MEDIUM_MAX_USD + 1)).toBe('L');
  });
});

describe('openBaselineSpread', () => {
  it('opens a narrower spread for labour-like drivers', () => {
    const triplet = openBaselineSpread(100, 'labour');
    expect(triplet.min).toBeLessThan(triplet.likely);
    expect(triplet.likely).toBe(100);
    expect(triplet.max).toBeGreaterThan(triplet.likely);
    expect(triplet.max / triplet.min).toBeLessThan(openBaselineSpread(100, 'heavyTailed').max / openBaselineSpread(100, 'heavyTailed').min);
  });

  it('opens a wider spread for heavy-tailed drivers', () => {
    const triplet = openBaselineSpread(100, 'heavyTailed');
    expect(triplet.min).toBeLessThan(triplet.likely);
    expect(triplet.max).toBeGreaterThan(triplet.likely);
  });

  it('forces min to zero for contingent drivers regardless of spread class', () => {
    expect(openBaselineSpread(100, 'labour', true).min).toBe(0);
    expect(openBaselineSpread(100, 'heavyTailed', true).min).toBe(0);
  });
});

describe('deriveSystemsInScope', () => {
  it('proxies workstations from employee count and servers from size class when nothing is declared', () => {
    const small = deriveSystemsInScope(100, 'S', null, null);
    const large = deriveSystemsInScope(100, 'L', null, null);
    expect(small.endpoints).toEqual({ low: 90, mid: 90, high: 90 });
    expect(small.servers.mid).toBeLessThan(large.servers.mid);
    expect(small.proxied).toBe(true);
  });

  it('reads an exact declaration as three equal points and drops the proxy flag once both sides are declared', () => {
    const systems = deriveSystemsInScope(100, 'S', { low: 250, high: 250 }, { low: 12, high: 12 });
    expect(systems).toEqual({ endpoints: { low: 250, mid: 250, high: 250 }, servers: { low: 12, mid: 12, high: 12 }, proxied: false });
  });

  it('drops the proxy flag for a declaration however wide', () => {
    const systems = deriveSystemsInScope(100, 'S', { low: 5_001, high: 25_000 }, { low: 1, high: 10 });
    expect(systems.endpoints.low).toBe(5_001);
    expect(systems.endpoints.high).toBe(25_000);
    expect(systems.proxied).toBe(false);
  });

  it('keeps the proxy, and its flag, for whichever side is undeclared', () => {
    const workstationsOnly = deriveSystemsInScope(100, 'S', { low: 250, high: 250 }, null);
    expect(workstationsOnly.endpoints.mid).toBe(250);
    expect(workstationsOnly.servers).toEqual({ low: 5, mid: 5, high: 5 });
    expect(workstationsOnly.proxied).toBe(true);

    const serversOnly = deriveSystemsInScope(100, 'S', null, { low: 12, high: 12 });
    expect(serversOnly.servers.mid).toBe(12);
    expect(serversOnly.endpoints).toEqual({ low: 90, mid: 90, high: 90 });
    expect(serversOnly.proxied).toBe(true);
  });
});

describe('countRangeMidpoint', () => {
  it('reads a range on a log scale', () => {
    expect(countRangeMidpoint({ low: 1_001, high: 5_000 })).toBeCloseTo(2_237.2, 1);
    expect(countRangeMidpoint({ low: 5_001, high: 25_000 })).toBeCloseTo(11_181.5, 0);
  });

  it('reads a range starting at 0 linearly', () => {
    expect(countRangeMidpoint({ low: 0, high: 10 })).toBe(5);
    expect(countRangeMidpoint({ low: 0, high: 0 })).toBe(0);
  });

  it('returns an exact number unchanged', () => {
    expect(countRangeMidpoint({ low: 4_200, high: 4_200 })).toBe(4_200);
    expect(countRangeMidpoint({ low: 9_999_999, high: 9_999_999 })).toBe(9_999_999);
  });
});

describe('resolveAnnualRevenueUsd', () => {
  const organization: OrganizationInput = { revenueBand: '100m_1b', employeeCount: 1_000 };
  const baseProfile: FinancialProfileInput = {
    annualRevenueUsd: null,
    grossMarginPct: null,
    operatingDaysBand: null,
    seasonalPeakPct: null,
    itDependentRevenuePct: null,
    timeToRevenueImpactBand: null,
    fullRestoreBand: null,
    revenueRecaptureBand: null,
    restoreTestRecency: null,
    declaredWorkstations: null,
    declaredServers: null,
    recordsHeld: { holdsPersonalDataBeyondEmployees: null, individualsBand: null, paymentCardTransactionsBand: null, sensitiveRecordsBand: null },
    regulatoryRegime: null,
    customerBase: { customerCountBand: null, b2cRevenuePct: null, recurringRevenuePct: null },
    contractedRevenueUnderClausesBand: null,
    contractualLiabilityCapBand: null,
    largestRepositoryBand: null,
    paymentFlows: { dailyValueBand: null, outOfBandVerification: null, outOfBandThresholdUsd: null },
    rdIpValue: null,
    ransomPaymentPosture: null,
    ransomPaymentCeilingUsd: null,
    costliestIncidentBand: null,
    worstOutageBand: null,
    loadedDailyLabourCostUsd: null,
  };

  it('uses the exact Q1 answer with no low-confidence flag when present', () => {
    const resolved = resolveAnnualRevenueUsd({ ...baseProfile, annualRevenueUsd: 500_000_000 }, organization);
    expect(resolved).toEqual({ annualRevenueUsd: 500_000_000, lowConfidence: false });
  });

  it('falls back to the organization revenue-band midpoint, and flags low confidence', () => {
    const resolved = resolveAnnualRevenueUsd(baseProfile, organization);
    expect(resolved.annualRevenueUsd).toBeCloseTo(316_227_766, 0);
    expect(resolved.lowConfidence).toBe(true);
  });

  it('resolves to no revenue at all when neither Q1 nor the organization band is known', () => {
    const resolved = resolveAnnualRevenueUsd(baseProfile, { ...organization, revenueBand: null });
    expect(resolved).toEqual({ annualRevenueUsd: null, lowConfidence: false });
  });

  // Same profile fixture: the labour-cost resolver mirrors this one.
  describe('resolveLoadedDailyLabourCostUsd', () => {
    it('uses the answered rate with no low-confidence flag', () => {
      const resolved = resolveLoadedDailyLabourCostUsd({ ...baseProfile, loadedDailyLabourCostUsd: 410 }, { ...organization, countryIsoAlpha3: 'FRA' });
      expect(resolved).toEqual({ loadedDailyLabourCostUsd: 410, lowConfidence: false });
    });

    it('falls back to the country benchmark when the rate is blank, and flags low confidence', () => {
      const resolved = resolveLoadedDailyLabourCostUsd(baseProfile, { ...organization, countryIsoAlpha3: 'FRA' });
      expect(resolved).toEqual({ loadedDailyLabourCostUsd: 480, lowConfidence: true });
    });

    it('falls back to the platform default when the country is unknown or has no benchmark', () => {
      expect(resolveLoadedDailyLabourCostUsd(baseProfile, organization)).toEqual({ loadedDailyLabourCostUsd: 300, lowConfidence: true });
      expect(resolveLoadedDailyLabourCostUsd(baseProfile, { ...organization, countryIsoAlpha3: 'ATA' })).toEqual({ loadedDailyLabourCostUsd: 300, lowConfidence: true });
    });
  });
});

describe('resolveRestoreDays', () => {
  it('flags low confidence only when the band is "unknown"', () => {
    expect(resolveRestoreDays('3_to_7d', 'M').lowConfidence).toBe(false);
    expect(resolveRestoreDays('unknown', 'M').lowConfidence).toBe(true);
  });
});

describe('revealedOutageOverrun', () => {
  it('reads a history inside the restore target as no evidence at all', () => {
    expect(revealedOutageOverrun('none', 5)).toBe(1);
    expect(revealedOutageOverrun(null, 5)).toBe(1);
    // Two days against a five-day target: the target held, which is not evidence it is pessimistic.
    expect(revealedOutageOverrun('1_to_3d', 5)).toBe(1);
  });

  it('measures how far the outage overran the target', () => {
    expect(revealedOutageOverrun('1_to_2w', 5)).toBeCloseTo(2.1, 6);
    expect(revealedOutageOverrun('over_2w', 0.5)).toBeCloseTo(42, 6);
  });

  it('reads a zero-day target as no evidence rather than dividing by it', () => {
    expect(revealedOutageOverrun('over_2w', 0)).toBe(1);
  });
});

describe('CUSTOMER_COUNT_MIDPOINT', () => {
  it('is the geometric midpoint of each decade band', () => {
    expect(CUSTOMER_COUNT_MIDPOINT.under_1k).toBe(500);
    expect(CUSTOMER_COUNT_MIDPOINT['1k_10k']).toBe(3_162);
    expect(CUSTOMER_COUNT_MIDPOINT['10k_100k']).toBe(31_623);
    expect(CUSTOMER_COUNT_MIDPOINT['100k_1m']).toBe(316_228);
    expect(CUSTOMER_COUNT_MIDPOINT.over_1m).toBe(1_500_000);
  });

  it('prices a thousand customers apart from fifty thousand, which the magnitude ladder could not', () => {
    // The ladder collapsed under_1k and 1k_50k onto one 50 000 midpoint and jumped over_50k to
    // 2 236 068, so 1 000 and 49 000 customers priced identically and 60 000 priced 45x higher.
    const distinct = new Set(Object.values(CUSTOMER_COUNT_MIDPOINT));
    expect(distinct.size).toBe(Object.keys(CUSTOMER_COUNT_MIDPOINT).length);
    expect(CUSTOMER_COUNT_MIDPOINT['1k_10k']).toBeLessThan(CUSTOMER_COUNT_MIDPOINT['10k_100k']);
  });
});

describe('resolveLiabilityCapFraction', () => {
  const FALLBACK = 0.3;

  it('reads each declared band as its own fraction, and a blank card as the platform fallback', () => {
    expect(resolveLiabilityCapFraction('under_25', FALLBACK)).toBe(0.125);
    expect(resolveLiabilityCapFraction('over_200', FALLBACK)).toBe(3.0);
    expect(resolveLiabilityCapFraction(null, FALLBACK)).toBe(FALLBACK);
  });

  it('never lets "no ceiling at all" price below a declared ceiling', () => {
    // The ordering is the point, not the value: an uncapped contract is exposed at least as far as
    // the highest ceiling the card can band, so no answer to Q19 may produce a smaller cap than it.
    const uncapped = resolveLiabilityCapFraction('no_cap', FALLBACK);
    for (const band of ['under_25', '25_100', '100_200', 'over_200'] as const) {
      expect(resolveLiabilityCapFraction(band, FALLBACK)).toBeLessThanOrEqual(uncapped);
    }
    expect(resolveLiabilityCapFraction(null, FALLBACK)).toBeLessThanOrEqual(uncapped);
  });
});
