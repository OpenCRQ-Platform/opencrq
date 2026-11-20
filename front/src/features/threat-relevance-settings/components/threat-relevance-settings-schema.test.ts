import { i18n } from '@lingui/core';
import {
  MAX_ACT_HALF_LIFE_DAYS,
  MAX_UNKNOWN_ACTIVITY_AGE_DAYS,
  MIN_ACT_HALF_LIFE_DAYS,
  MIN_UNKNOWN_ACTIVITY_AGE_DAYS,
  THREAT_RELEVANCE_DEFAULTS,
} from '@app/module/client';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildThreatRelevanceSettingsFormSchema,
  HALF_LIFE_STEP_DAYS,
  UNKNOWN_ACTIVITY_AGE_STEP_DAYS,
} from './threat-relevance-settings-schema';

const validValues = { ...THREAT_RELEVANCE_DEFAULTS };

const isOnStepLadder = (value: number, min: number, step: number) => {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
};

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('buildThreatRelevanceSettingsFormSchema', () => {
  const schema = { safeParse: (values: unknown) => buildThreatRelevanceSettingsFormSchema().safeParse(values) };

  it('should accept the default values', () => {
    expect(schema.safeParse(validValues).success).toBe(true);
  });

  it('should accept a half-life at both bounds', () => {
    expect(schema.safeParse({ ...validValues, actHalfLifeObservedDays: MIN_ACT_HALF_LIFE_DAYS }).success).toBe(true);
    expect(schema.safeParse({ ...validValues, actHalfLifeAuthoredDays: MAX_ACT_HALF_LIFE_DAYS }).success).toBe(true);
  });

  it('should reject a half-life outside the bounds', () => {
    expect(schema.safeParse({ ...validValues, actHalfLifeObservedDays: MIN_ACT_HALF_LIFE_DAYS - 1 }).success).toBe(false);
    expect(schema.safeParse({ ...validValues, actHalfLifeObservedDays: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...validValues, actHalfLifeAuthoredDays: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...validValues, actHalfLifeAuthoredDays: MAX_ACT_HALF_LIFE_DAYS + 1 }).success).toBe(false);
  });

  it('should reject a fractional half-life', () => {
    expect(schema.safeParse({ ...validValues, actHalfLifeObservedDays: 180.5 }).success).toBe(false);
  });

  it('should reject a missing field', () => {
    expect(schema.safeParse({ actHalfLifeObservedDays: 180 }).success).toBe(false);
  });

  it('should reject a cleared field', () => {
    expect(schema.safeParse({ ...validValues, actHalfLifeObservedDays: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...validValues, actHalfLifeAuthoredDays: Number.NaN }).success).toBe(false);
  });

  it('should reject an observed half-life slower than the authored one with a translated message', () => {
    const result = schema.safeParse({ ...validValues, actHalfLifeObservedDays: 400, actHalfLifeAuthoredDays: 365 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('The observed anchor half-life must not exceed the authored anchor half-life.');
      expect(result.error.issues[0]?.path).toEqual(['actHalfLifeObservedDays']);
    }
  });

  it('should return a translated message rather than raw Zod text', () => {
    const result = schema.safeParse({ ...validValues, actHalfLifeObservedDays: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(`The half-life must be at least ${MIN_ACT_HALF_LIFE_DAYS} days.`);
    }
  });
});

describe('buildThreatRelevanceSettingsFormSchema unknown activity age', () => {
  const parse = (values: unknown) => buildThreatRelevanceSettingsFormSchema().safeParse(values);
  const { unknownActivityAgeDays: _omitted, ...withoutUnknownActivityAge } = validValues;

  it('should accept the default and both bounds', () => {
    expect(parse({ ...validValues, unknownActivityAgeDays: 365 }).success).toBe(true);
    expect(parse({ ...validValues, unknownActivityAgeDays: MIN_UNKNOWN_ACTIVITY_AGE_DAYS }).success).toBe(true);
    expect(parse({ ...validValues, unknownActivityAgeDays: MAX_UNKNOWN_ACTIVITY_AGE_DAYS }).success).toBe(true);
  });

  it('should reject an absent field with a translated message on its own path', () => {
    const result = parse(withoutUnknownActivityAge);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Enter a number of days.');
      expect(result.error.issues[0]?.path).toEqual(['unknownActivityAgeDays']);
    }
  });

  it('should reject a value outside the bounds', () => {
    expect(parse({ ...validValues, unknownActivityAgeDays: MIN_UNKNOWN_ACTIVITY_AGE_DAYS - 1 }).success).toBe(false);
    expect(parse({ ...validValues, unknownActivityAgeDays: MAX_UNKNOWN_ACTIVITY_AGE_DAYS + 1 }).success).toBe(false);
  });
});

describe('number input step ladders', () => {
  it('should keep every half-life bound and default reachable from the minimum', () => {
    expect(isOnStepLadder(THREAT_RELEVANCE_DEFAULTS.actHalfLifeObservedDays, MIN_ACT_HALF_LIFE_DAYS, HALF_LIFE_STEP_DAYS)).toBe(true);
    expect(isOnStepLadder(THREAT_RELEVANCE_DEFAULTS.actHalfLifeAuthoredDays, MIN_ACT_HALF_LIFE_DAYS, HALF_LIFE_STEP_DAYS)).toBe(true);
    expect(isOnStepLadder(MAX_ACT_HALF_LIFE_DAYS, MIN_ACT_HALF_LIFE_DAYS, HALF_LIFE_STEP_DAYS)).toBe(true);
  });

  it('should keep the unknown activity age bounds and default reachable from the minimum', () => {
    expect(isOnStepLadder(THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays, MIN_UNKNOWN_ACTIVITY_AGE_DAYS, UNKNOWN_ACTIVITY_AGE_STEP_DAYS)).toBe(true);
    expect(isOnStepLadder(MAX_UNKNOWN_ACTIVITY_AGE_DAYS, MIN_UNKNOWN_ACTIVITY_AGE_DAYS, UNKNOWN_ACTIVITY_AGE_STEP_DAYS)).toBe(true);
  });
});
