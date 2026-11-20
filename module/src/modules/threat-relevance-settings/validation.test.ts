import { describe, expect, it } from 'vitest';
import {
  MAX_ACT_HALF_LIFE_DAYS,
  MAX_UNKNOWN_ACTIVITY_AGE_DAYS,
  MIN_ACT_HALF_LIFE_DAYS,
  MIN_UNKNOWN_ACTIVITY_AGE_DAYS,
  THREAT_RELEVANCE_DEFAULTS,
} from './constants';
import { buildThreatRelevanceSettingsSchema, threatRelevanceSettingsSchema } from './validation';

const validValues = { ...THREAT_RELEVANCE_DEFAULTS };

const firstMessage = (values: Record<string, unknown>, schema = threatRelevanceSettingsSchema) => {
  const result = schema.safeParse(values);
  return result.success ? undefined : result.error.issues[0]?.message;
};

describe('threatRelevanceSettingsSchema', () => {
  it('should accept the module defaults', () => {
    expect(threatRelevanceSettingsSchema.safeParse(validValues).success).toBe(true);
  });

  it('should accept both half-life bounds', () => {
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeObservedDays: MIN_ACT_HALF_LIFE_DAYS }).success).toBe(true);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeAuthoredDays: MAX_ACT_HALF_LIFE_DAYS }).success).toBe(true);
  });

  it('should reject a half-life outside the bounds', () => {
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeObservedDays: MIN_ACT_HALF_LIFE_DAYS - 1 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeAuthoredDays: MAX_ACT_HALF_LIFE_DAYS + 1 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeObservedDays: 0 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeAuthoredDays: -1 }).success).toBe(false);
  });

  it('should reject a fractional half-life', () => {
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeObservedDays: 180.5 }).success).toBe(false);
  });

  it('should reject a missing, cleared or NaN field', () => {
    expect(threatRelevanceSettingsSchema.safeParse({ actHalfLifeObservedDays: 180 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeObservedDays: undefined }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, actHalfLifeAuthoredDays: Number.NaN }).success).toBe(false);
  });

  it('should reject an observed half-life slower than the authored one', () => {
    const inverted = { ...validValues, actHalfLifeObservedDays: 400, actHalfLifeAuthoredDays: 365 };
    const result = threatRelevanceSettingsSchema.safeParse(inverted);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(['actHalfLifeObservedDays']);
  });

  it('should accept equal observed and authored half-lives', () => {
    expect(threatRelevanceSettingsSchema.safeParse({
      ...validValues,
      actHalfLifeObservedDays: 365,
      actHalfLifeAuthoredDays: 365,
    }).success).toBe(true);
  });
});

describe('threatRelevanceSettingsSchema unknown activity age', () => {
  const { unknownActivityAgeDays: _omitted, ...withoutUnknownActivityAge } = validValues;

  it('should accept the absence of the field', () => {
    expect(threatRelevanceSettingsSchema.safeParse(withoutUnknownActivityAge).success).toBe(true);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: undefined }).success).toBe(true);
  });

  it('should accept both bounds', () => {
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: MIN_UNKNOWN_ACTIVITY_AGE_DAYS }).success).toBe(true);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: MAX_UNKNOWN_ACTIVITY_AGE_DAYS }).success).toBe(true);
  });

  it('should reject a value outside the bounds', () => {
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: MIN_UNKNOWN_ACTIVITY_AGE_DAYS - 1 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: MAX_UNKNOWN_ACTIVITY_AGE_DAYS + 1 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: 0 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: -30 }).success).toBe(false);
  });

  it('should reject a fractional or NaN value', () => {
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: 100.5 }).success).toBe(false);
    expect(threatRelevanceSettingsSchema.safeParse({ ...validValues, unknownActivityAgeDays: Number.NaN }).success).toBe(false);
  });
});

describe('buildThreatRelevanceSettingsSchema', () => {
  const messages = {
    halfLifeRequired: 'half-life required',
    halfLifeInteger: 'half-life integer',
    halfLifeMin: 'half-life min',
    halfLifeMax: 'half-life max',
    observedNotSlowerThanAuthored: 'observed not slower than authored',
    confidenceGateInvalid: 'confidence gate invalid',
    unknownActivityAgeInteger: 'unknown activity age integer',
    unknownActivityAgeMin: 'unknown activity age min',
    unknownActivityAgeMax: 'unknown activity age max',
  };
  const schema = buildThreatRelevanceSettingsSchema(messages);

  it('should surface the injected message on each reachable half-life failure', () => {
    expect(firstMessage({ ...validValues, actHalfLifeObservedDays: undefined }, schema)).toBe(messages.halfLifeRequired);
    expect(firstMessage({ ...validValues, actHalfLifeObservedDays: Number.NaN }, schema)).toBe(messages.halfLifeRequired);
    expect(firstMessage({ ...validValues, actHalfLifeObservedDays: 180.5 }, schema)).toBe(messages.halfLifeInteger);
    expect(firstMessage({ ...validValues, actHalfLifeObservedDays: MIN_ACT_HALF_LIFE_DAYS - 1 }, schema)).toBe(messages.halfLifeMin);
    expect(firstMessage({ ...validValues, actHalfLifeObservedDays: MAX_ACT_HALF_LIFE_DAYS + 1 }, schema)).toBe(messages.halfLifeMax);
  });

  it('should surface the injected message on each unknown activity age failure', () => {
    expect(firstMessage({ ...validValues, unknownActivityAgeDays: 100.5 }, schema)).toBe(messages.unknownActivityAgeInteger);
    expect(firstMessage({ ...validValues, unknownActivityAgeDays: Number.NaN }, schema)).toBe(messages.unknownActivityAgeInteger);
    expect(firstMessage({ ...validValues, unknownActivityAgeDays: MIN_UNKNOWN_ACTIVITY_AGE_DAYS - 1 }, schema)).toBe(messages.unknownActivityAgeMin);
    expect(firstMessage({ ...validValues, unknownActivityAgeDays: 0 }, schema)).toBe(messages.unknownActivityAgeMin);
    expect(firstMessage({ ...validValues, unknownActivityAgeDays: -30 }, schema)).toBe(messages.unknownActivityAgeMin);
    expect(firstMessage({ ...validValues, unknownActivityAgeDays: MAX_UNKNOWN_ACTIVITY_AGE_DAYS + 1 }, schema)).toBe(messages.unknownActivityAgeMax);
  });

  it('should surface the injected message when the observed half-life exceeds the authored one', () => {
    expect(firstMessage({ ...validValues, actHalfLifeObservedDays: 400, actHalfLifeAuthoredDays: 365 }, schema))
      .toBe(messages.observedNotSlowerThanAuthored);
  });

  it('should fall back to built-in messages when none are injected', () => {
    expect(firstMessage({ ...validValues, actHalfLifeObservedDays: 0 })).toContain(`${MIN_ACT_HALF_LIFE_DAYS}`);
  });
});
