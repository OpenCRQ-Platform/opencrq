import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrqIndicatorSettingsSchema, UpdateCrqIndicatorSettingsSchema } from './crq-indicator-settings-schema';

const TODAY = '2026-10-14';

describe('UpdateCrqIndicatorSettingsSchema phishing declaration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T08:30:00.000Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const accepts = (input: unknown) => UpdateCrqIndicatorSettingsSchema.safeParse(input).success;

  it('should leave the declaration alone when neither key is given', () => {
    expect(accepts({})).toBe(true);
    expect(accepts({ iterations: 500 })).toBe(true);
  });

  it('should accept a rate with the date of the campaign that measured it', () => {
    expect(accepts({ phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2026-09-01' })).toBe(true);
  });

  it('should accept the bounds of the rate', () => {
    expect(accepts({ phishingFailureRate: 0, phishingFailureMeasuredOn: '2026-09-01' })).toBe(true);
    expect(accepts({ phishingFailureRate: 1, phishingFailureMeasuredOn: '2026-09-01' })).toBe(true);
  });

  it.each([-0.01, 1.01, 12])('should refuse a rate of %s', (rate) => {
    expect(accepts({ phishingFailureRate: rate, phishingFailureMeasuredOn: '2026-09-01' })).toBe(false);
  });

  it('should refuse a rate with no date, and a date with no rate', () => {
    expect(accepts({ phishingFailureRate: 0.12 })).toBe(false);
    expect(accepts({ phishingFailureMeasuredOn: '2026-09-01' })).toBe(false);
  });

  it('should refuse a rate given with a cleared date, and a date given with a cleared rate', () => {
    expect(accepts({ phishingFailureRate: 0.12, phishingFailureMeasuredOn: null })).toBe(false);
    expect(accepts({ phishingFailureRate: null, phishingFailureMeasuredOn: '2026-09-01' })).toBe(false);
  });

  it('should accept clearing both together', () => {
    expect(accepts({ phishingFailureRate: null, phishingFailureMeasuredOn: null })).toBe(true);
  });

  it('should accept today and refuse a day in the future', () => {
    expect(accepts({ phishingFailureRate: 0.12, phishingFailureMeasuredOn: TODAY })).toBe(true);
    expect(accepts({ phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2026-10-15' })).toBe(false);
  });

  it.each(['yesterday', '2026-13-01', '2026-02-30', '01/09/2026', '2026-09-01T00:00:00Z'])(
    'should refuse %s as the date of the campaign',
    (measuredOn) => {
      expect(accepts({ phishingFailureRate: 0.12, phishingFailureMeasuredOn: measuredOn })).toBe(false);
    },
  );
});

describe('CrqIndicatorSettingsSchema phishing declaration', () => {
  const stored = {
    iterations: 1000,
    exposureWeightInternetFacing: 1,
    exposureWeightInternal: 0.4,
    susceptibilityGamma: 0.7,
    measuredValidityDays: null,
    unknownCriticalityCountsAs: 'low',
    unknownExposureCountsAs: 'internal',
  };

  it('should carry no declaration as two nulls', () => {
    const parsed = CrqIndicatorSettingsSchema.parse({ ...stored, phishingFailureRate: null, phishingFailureMeasuredOn: null });

    expect(parsed).toMatchObject({ phishingFailureRate: null, phishingFailureMeasuredOn: null });
  });

  it('should carry a declaration as a rate and a calendar day', () => {
    const parsed = CrqIndicatorSettingsSchema.parse({ ...stored, phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2026-09-01' });

    expect(parsed).toMatchObject({ phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2026-09-01' });
  });

  it('should refuse a stored rate outside the unit interval', () => {
    expect(CrqIndicatorSettingsSchema.safeParse({ ...stored, phishingFailureRate: 1.5, phishingFailureMeasuredOn: '2026-09-01' }).success).toBe(false);
  });
});
