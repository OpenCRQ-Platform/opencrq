import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crqIndicatorSettingsFormSchema } from './crq-indicator-settings-schema';

const baseValues = {
  iterations: 1000,
  exposureWeightInternetFacing: 1,
  exposureWeightInternal: 0.4,
  susceptibilityGamma: 0.7,
  measuredValidityDays: null,
  unknownCriticalityCountsAs: 'low',
  unknownExposureCountsAs: 'internal',
  phishingFailureRate: null,
  phishingFailureMeasuredOn: null,
};

const issuesOf = (overrides: Record<string, unknown>) => {
  const result = crqIndicatorSettingsFormSchema.safeParse({ ...baseValues, ...overrides });
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};

describe('crqIndicatorSettingsFormSchema phishing declaration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should accept no declaration, and a complete one', () => {
    expect(issuesOf({})).toEqual([]);
    expect(issuesOf({ phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2026-09-01' })).toEqual([]);
  });

  it('should refuse a rate without a date on the date field', () => {
    expect(issuesOf({ phishingFailureRate: 0.12 })).toEqual([{ path: 'phishingFailureMeasuredOn', message: 'DATE_REQUIRED' }]);
  });

  it('should refuse a date without a rate on the rate field', () => {
    expect(issuesOf({ phishingFailureMeasuredOn: '2026-09-01' })).toEqual([{ path: 'phishingFailureRate', message: 'RATE_REQUIRED' }]);
  });

  it('should refuse a rate above 1 and a date in the future together', () => {
    expect(issuesOf({ phishingFailureRate: 1.5, phishingFailureMeasuredOn: '2026-10-15' })).toEqual([
      { path: 'phishingFailureRate', message: 'RATE_OUT_OF_RANGE' },
      { path: 'phishingFailureMeasuredOn', message: 'DATE_IN_FUTURE' },
    ]);
  });
});
