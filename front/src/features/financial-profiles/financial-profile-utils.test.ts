import { i18n } from '@lingui/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS } from './financial-profile-schema';
import {
  answerSummary,
  bandFromRevenueAmount,
  isMtdRtoInconsistent,
} from './financial-profile-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('Q1 revenue band', () => {
  it('derives the band a typed amount falls into', () => {
    expect(bandFromRevenueAmount(5_000_000)).toBe('under_10m');
    expect(bandFromRevenueAmount(300_000_000)).toBe('100m_1b');
  });
});

describe('MTD/RTO consistency check', () => {
  it('does not fire when either band is blank', () => {
    expect(isMtdRtoInconsistent({ timeToRevenueImpactBand: null, fullRestoreBand: '1_2w' })).toBe(false);
    expect(isMtdRtoInconsistent({ timeToRevenueImpactBand: 'under_6h', fullRestoreBand: null })).toBe(false);
  });

  it('does not fire when the RTO is unknown', () => {
    expect(isMtdRtoInconsistent({ timeToRevenueImpactBand: 'under_6h', fullRestoreBand: 'unknown' })).toBe(false);
  });

  it('does not fire on the mildest plausible mismatch', () => {
    expect(isMtdRtoInconsistent({ timeToRevenueImpactBand: 'under_6h', fullRestoreBand: 'under_1d' })).toBe(false);
  });

  it('fires when the RTO midpoint exceeds four times the MTD midpoint', () => {
    expect(isMtdRtoInconsistent({ timeToRevenueImpactBand: 'under_6h', fullRestoreBand: 'over_2w' })).toBe(true);
  });
});

describe('answerSummary', () => {
  it('carries both halves of the composite operating-days card', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, operatingDaysBand: 'about_250' as const, seasonalPeakPct: 20 };
    const summary = answerSummary('Q3', values);
    expect(summary).toContain('20');
    expect(summary.split(' \u00b7 ')).toHaveLength(2);
  });

  it('states the operating days alone when no seasonal peak was given', () => {
    const values = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, operatingDaysBand: 'about_250' as const };
    expect(answerSummary('Q3', values)).not.toContain('\u00b7');
  });
});

describe('answerSummary \u2014 amounts in the application language', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  const amounts = {
    ...EMPTY_FINANCIAL_PROFILE_ANSWERS,
    annualRevenue: 1_234_567,
    outOfBandThreshold: 50_000,
    ransomPaymentPosture: true,
    ransomPaymentCeiling: 2_500_000,
  };

  it('groups the digits as English does', () => {
    expect(answerSummary('Q1', amounts)).toBe('1,234,567 USD');
    expect(answerSummary('Q13', amounts)).toContain('50,000 USD');
    expect(answerSummary('Q15', amounts)).toContain('2,500,000 USD');
  });

  it('groups the digits as French does once the application is in French', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(answerSummary('Q1', amounts)).toBe('1\u202f234\u202f567 USD');
    expect(answerSummary('Q13', amounts)).toContain('50\u202f000 USD');
    expect(answerSummary('Q15', amounts)).toContain('2\u202f500\u202f000 USD');
  });
});
