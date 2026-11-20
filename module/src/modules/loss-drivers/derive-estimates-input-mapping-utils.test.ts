import { describe, expect, it } from 'vitest';
import type { financialProfiles } from '../financial-profiles/schema';
import type { organizations } from '../organizations/schema';
import { financialProfileToKernelInput, organizationToKernelInput } from './derive-estimates-input-mapping-utils';

type FinancialProfileRow = typeof financialProfiles.$inferSelect;
type OrganizationRow = typeof organizations.$inferSelect;

const emptyProfile = (overrides: Partial<FinancialProfileRow> = {}): FinancialProfileRow => ({
  id: 'profile-id',
  tenantId: 'tenant-id',
  organizationId: 'organization-id',
  loadedDailyLabourCost: null,
  annualRevenue: null,
  grossMarginPct: null,
  operatingDaysBand: null,
  seasonalPeakPct: null,
  itDependentRevenuePct: null,
  timeToRevenueImpactBand: null,
  fullRestoreBand: null,
  revenueRecaptureBand: null,
  restoreTestRecency: null,
  recordsHeldGate: null,
  individualsBand: null,
  cardTransactionsBand: null,
  sensitiveRecordsBand: null,
  largestRepositoryBand: null,
  regulatoryRegime: 'none',
  customerCountBand: null,
  b2cRevenuePct: null,
  recurringRevenuePct: null,
  contractedRevenueBand: null,
  contractualLiabilityCapBand: null,
  paymentFlowDailyValueBand: null,
  outOfBandVerificationGate: null,
  outOfBandThreshold: null,
  rdIpValueBand: null,
  ransomPaymentPosture: null,
  ransomPaymentCeiling: null,
  worstOutageBand: null,
  costliestIncidentBand: null,
  coefficientSetVersion: null,
  updatedAt: new Date(),
  ...overrides,
});

const fullyAnsweredProfile = (): FinancialProfileRow => emptyProfile({
  loadedDailyLabourCost: 350,
  annualRevenue: 30_000_000,
  grossMarginPct: 40,
  operatingDaysBand: 'about_250',
  seasonalPeakPct: 20,
  itDependentRevenuePct: 80,
  timeToRevenueImpactBand: '12_24h',
  fullRestoreBand: '3_7d',
  revenueRecaptureBand: 'partly_deferred',
  recordsHeldGate: true,
  individualsBand: '100k_500k',
  cardTransactionsBand: 'under_500k',
  sensitiveRecordsBand: 'under_100k',
  regulatoryRegime: 'none',
  customerCountBand: '1k_10k',
  b2cRevenuePct: 40,
  recurringRevenuePct: 30,
  contractedRevenueBand: '25_75',
  paymentFlowDailyValueBand: '100k_500k',
  outOfBandVerificationGate: false,
  outOfBandThreshold: 100_000,
  rdIpValueBand: '2_8',
  ransomPaymentPosture: true,
  ransomPaymentCeiling: 500_000,
  restoreTestRecency: 'over_12m',
  largestRepositoryBand: '100k_500k',
  contractualLiabilityCapBand: '25_100',
  costliestIncidentBand: '100k_500k',
});

describe('financialProfileToKernelInput', () => {
  it('maps every band to the kernel spelling on a fully answered profile', () => {
    const result = financialProfileToKernelInput(fullyAnsweredProfile(), []);

    expect(result.annualRevenueUsd).toBe(30_000_000);
    expect(result.grossMarginPct).toBe(40);
    expect(result.operatingDaysBand).toBe('five_of_seven');
    expect(result.seasonalPeakPct).toBe(20);
    expect(result.timeToRevenueImpactBand).toBe('12_to_24h');
    expect(result.fullRestoreBand).toBe('3_to_7d');
    expect(result.revenueRecaptureBand).toBe('partly_deferred');
    expect(result.restoreTestRecency).toBe('over_12m');
    expect(result.contractedRevenueUnderClausesBand).toBe('25_to_75');
    expect(result.contractualLiabilityCapBand).toBe('25_100');
    expect(result.largestRepositoryBand).toBe('100k_to_500k');
    expect(result.rdIpValue).toEqual({ kind: 'revenue_fraction', band: '2_to_8' });
    expect(result.ransomPaymentPosture).toBe(true);
    expect(result.ransomPaymentCeilingUsd).toBe(500_000);
    expect(result.costliestIncidentBand).toBe('100k_500k');
    expect(result.loadedDailyLabourCostUsd).toBe(350);
  });

  it('reads the declared workstations and servers, and no other kind', () => {
    const result = financialProfileToKernelInput(emptyProfile(), [
      { kind: 'workstations', low: 1001, high: 5000 },
      { kind: 'servers', low: 180, high: 180 },
      { kind: 'people', low: 51, high: 250 },
    ]);

    expect(result.declaredWorkstations).toEqual({ low: 1001, high: 5000 });
    expect(result.declaredServers).toEqual({ low: 180, high: 180 });
  });

  it('nests the records-held answers under recordsHeld', () => {
    const result = financialProfileToKernelInput(fullyAnsweredProfile(), []);

    expect(result.recordsHeld).toEqual({
      holdsPersonalDataBeyondEmployees: true,
      individualsBand: '100k_to_500k',
      paymentCardTransactionsBand: '100k_to_500k',
      sensitiveRecordsBand: 'under_100k',
    });
  });

  it('nests the customer-base answers under customerBase, the count band passing through', () => {
    const result = financialProfileToKernelInput(fullyAnsweredProfile(), []);

    expect(result.customerBase).toEqual({
      customerCountBand: '1k_10k',
      b2cRevenuePct: 40,
      recurringRevenuePct: 30,
    });
  });

  it('nests the payment-flow answers under paymentFlows', () => {
    const result = financialProfileToKernelInput(fullyAnsweredProfile(), []);

    expect(result.paymentFlows).toEqual({
      dailyValueBand: '100k_to_500k',
      outOfBandVerification: false,
      outOfBandThresholdUsd: 100_000,
    });
  });

  it('leaves every band null on a blank profile', () => {
    const result = financialProfileToKernelInput(emptyProfile(), []);

    expect(result.annualRevenueUsd).toBeNull();
    expect(result.operatingDaysBand).toBeNull();
    expect(result.rdIpValue).toBeNull();
    expect(result.seasonalPeakPct).toBeNull();
    expect(result.restoreTestRecency).toBeNull();
    expect(result.declaredWorkstations).toBeNull();
    expect(result.declaredServers).toBeNull();
    expect(result.contractualLiabilityCapBand).toBeNull();
    expect(result.largestRepositoryBand).toBeNull();
    expect(result.ransomPaymentCeilingUsd).toBeNull();
    expect(result.costliestIncidentBand).toBeNull();
    expect(result.recordsHeld).toEqual({
      holdsPersonalDataBeyondEmployees: null,
      individualsBand: null,
      paymentCardTransactionsBand: null,
      sensitiveRecordsBand: null,
    });
  });

  it('passes every largest-repository band straight onto the same buckets individualsBand uses', () => {
    const bands = ['under_100k', '100k_500k', '500k_1m', '1m_5m', 'over_5m'] as const;
    const expected = ['under_100k', '100k_to_500k', '500k_to_1m', '1m_to_5m', 'over_5m'];
    const mapped = bands.map((band) => financialProfileToKernelInput(emptyProfile({ largestRepositoryBand: band }), []).largestRepositoryBand);
    expect(mapped).toEqual(expected);
  });

  it('passes every customer-count band straight through, so no two of them price alike', () => {
    // The kernel used to take these on the coarser magnitude ladder, which collapsed the two
    // bounded buckets onto one midpoint and jumped the open-ended one far above it.
    const bands = ['under_1k', '1k_10k', '10k_100k', '100k_1m', 'over_1m'] as const;
    const mapped = bands.map((band) => financialProfileToKernelInput(emptyProfile({ customerCountBand: band }), []).customerBase.customerCountBand);
    expect(mapped).toEqual([...bands]);
  });

  it('translates every worst-outage band onto the kernel duration spelling (C2)', () => {
    const bands = ['none', 'under_1d', '1_3d', '3_7d', '1_2w', 'over_2w'] as const;
    const expected = ['none', 'under_1d', '1_to_3d', '3_to_7d', '1_to_2w', 'over_2w'];
    const mapped = bands.map((band) => financialProfileToKernelInput(emptyProfile({ worstOutageBand: band }), []).worstOutageBand);
    expect(mapped).toEqual(expected);
    expect(financialProfileToKernelInput(emptyProfile(), []).worstOutageBand).toBeNull();
  });

  it('reads ransomPaymentCeiling into ransomPaymentCeilingUsd (A3)', () => {
    const withCeiling = financialProfileToKernelInput(emptyProfile({ ransomPaymentPosture: true, ransomPaymentCeiling: 9_000_000 }), []);
    const withoutCeiling = financialProfileToKernelInput(emptyProfile({ ransomPaymentPosture: true, ransomPaymentCeiling: null }), []);
    expect(withCeiling.ransomPaymentCeilingUsd).toBe(9_000_000);
    expect(withoutCeiling.ransomPaymentCeilingUsd).toBeNull();
  });
});

describe('organizationToKernelInput', () => {
  it('picks the two kernel-relevant fields as-is', () => {
    const organization: OrganizationRow = {
      id: 'org-id',
      tenantId: 'tenant-id',
      name: 'Acme',
      description: null,
      legalEntityName: null,
      sectorId: null,
      countryId: 'country-id',
      revenueBand: '10m_100m',
      employeeCount: 150,
      domain: null,
      reactionTimeMin: null,
      reactionTimeLikely: null,
      reactionTimeMax: null,
      estateMode: 'open',
      estateChangedAt: null,
    };

    expect(organizationToKernelInput(organization)).toEqual({
      revenueBand: '10m_100m',
      employeeCount: 150,
      countryIsoAlpha3: undefined,
    });
  });

  it('carries the country code the caller resolved', () => {
    expect(organizationToKernelInput({ revenueBand: null, employeeCount: null, countryIsoAlpha3: 'FRA' })).toEqual({
      revenueBand: null,
      employeeCount: null,
      countryIsoAlpha3: 'FRA',
    });
  });
});
