import { describe, expect, it } from 'vitest';
import {
  percentToShare,
  shareToPercent,
  validatePhishingDeclaration,
} from './crq-indicator-settings-utils';

describe('percentToShare', () => {
  it('should read a percentage as a share', () => {
    expect(percentToShare(7)).toBe(0.07);
    expect(percentToShare(100)).toBe(1);
    expect(percentToShare(0)).toBe(0);
  });

  it('should keep a blank field blank', () => {
    expect(percentToShare(null)).toBeNull();
  });
});

describe('shareToPercent', () => {
  it('should show a share as a percentage without floating-point noise', () => {
    expect(shareToPercent(0.07)).toBe(7);
    expect(shareToPercent(0.333)).toBe(33.3);
    expect(shareToPercent(1)).toBe(100);
  });

  it('should keep a blank declaration blank', () => {
    expect(shareToPercent(null)).toBeNull();
  });

  it('should round-trip what a reader types', () => {
    for (const typed of [0, 0.5, 7, 12.5, 33.3, 99.99, 100]) {
      expect(shareToPercent(percentToShare(typed))).toBe(typed);
    }
  });
});

describe('validatePhishingDeclaration', () => {
  const now = new Date('2026-10-14T12:00:00Z');

  it('should accept a rate with a past date', () => {
    expect(validatePhishingDeclaration({ rate: 0.12, measuredOn: '2026-09-01' }, now)).toEqual({ rate: null, measuredOn: null });
  });

  it('should accept both bounds of the rate and a date of today in UTC', () => {
    expect(validatePhishingDeclaration({ rate: 0, measuredOn: '2026-10-14' }, now)).toEqual({ rate: null, measuredOn: null });
    expect(validatePhishingDeclaration({ rate: 1, measuredOn: '2026-10-14' }, now)).toEqual({ rate: null, measuredOn: null });
  });

  it('should accept a declaration cleared together', () => {
    expect(validatePhishingDeclaration({ rate: null, measuredOn: null }, now)).toEqual({ rate: null, measuredOn: null });
  });

  it('should refuse a rate outside [0, 1]', () => {
    expect(validatePhishingDeclaration({ rate: -0.01, measuredOn: '2026-09-01' }, now).rate).toBe('RATE_OUT_OF_RANGE');
    expect(validatePhishingDeclaration({ rate: 1.01, measuredOn: '2026-09-01' }, now).rate).toBe('RATE_OUT_OF_RANGE');
    expect(validatePhishingDeclaration({ rate: Number.NaN, measuredOn: '2026-09-01' }, now).rate).toBe('RATE_OUT_OF_RANGE');
  });

  it('should refuse a rate without a date, on the date', () => {
    expect(validatePhishingDeclaration({ rate: 0.1, measuredOn: null }, now)).toEqual({ rate: null, measuredOn: 'DATE_REQUIRED' });
  });

  it('should refuse a date without a rate, on the rate', () => {
    expect(validatePhishingDeclaration({ rate: null, measuredOn: '2026-09-01' }, now)).toEqual({ rate: 'RATE_REQUIRED', measuredOn: null });
  });

  it('should refuse a date after today in UTC, whatever day it is where the reader sits', () => {
    expect(validatePhishingDeclaration({ rate: 0.1, measuredOn: '2026-10-15' }, now).measuredOn).toBe('DATE_IN_FUTURE');
    const lateInUtc = new Date('2026-10-14T23:59:59Z');
    expect(validatePhishingDeclaration({ rate: 0.1, measuredOn: '2026-10-14' }, lateInUtc).measuredOn).toBeNull();
    expect(validatePhishingDeclaration({ rate: 0.1, measuredOn: '2026-10-15' }, lateInUtc).measuredOn).toBe('DATE_IN_FUTURE');
  });
});
