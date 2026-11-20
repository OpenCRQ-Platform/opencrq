import { describe, expect, it } from 'vitest';
import { freshPhishingFailureRate, isMeasuredInFuture, utcCalendarDay } from './phishing-declaration';

describe('utcCalendarDay', () => {
  it('should name the UTC day, not the reader\'s', () => {
    expect(utcCalendarDay(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-14');
    expect(utcCalendarDay(new Date('2026-10-15T00:00:00Z'))).toBe('2026-10-15');
  });
});

describe('isMeasuredInFuture', () => {
  it('should accept today in UTC and refuse the day after', () => {
    const lateInUtc = new Date('2026-10-14T23:59:59Z');
    expect(isMeasuredInFuture('2026-10-14', lateInUtc)).toBe(false);
    expect(isMeasuredInFuture('2026-10-15', lateInUtc)).toBe(true);
  });
});

describe('freshPhishingFailureRate', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const declared = { phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2026-09-14' };

  it('should read the declared rate however old it is when the window is off', () => {
    expect(freshPhishingFailureRate({ ...declared, phishingFailureMeasuredOn: '2020-01-01', measuredValidityDays: null }, now)).toBe(0.12);
  });

  it('should read the declared rate up to the last day of the window', () => {
    expect(freshPhishingFailureRate({ ...declared, measuredValidityDays: 30 }, now)).toBe(0.12);
  });

  it('should leave an expired declaration to the default', () => {
    expect(freshPhishingFailureRate({ ...declared, measuredValidityDays: 29 }, now)).toBeNull();
  });

  it('should count whole UTC days, so the answer holds through the day', () => {
    const settings = { ...declared, measuredValidityDays: 30 };
    expect(freshPhishingFailureRate(settings, new Date('2026-10-14T00:00:00Z'))).toBe(0.12);
    expect(freshPhishingFailureRate(settings, new Date('2026-10-14T23:59:59Z'))).toBe(0.12);
    expect(freshPhishingFailureRate(settings, new Date('2026-10-15T00:00:00Z'))).toBeNull();
  });

  it('should read nothing when no rate is declared', () => {
    expect(freshPhishingFailureRate({ phishingFailureRate: null, phishingFailureMeasuredOn: null, measuredValidityDays: 30 }, now)).toBeNull();
  });
});
