import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import {
  buildThreatRelevanceSettingsSchema,
  MAX_ACT_HALF_LIFE_DAYS,
  MAX_UNKNOWN_ACTIVITY_AGE_DAYS,
  MIN_ACT_HALF_LIFE_DAYS,
  MIN_UNKNOWN_ACTIVITY_AGE_DAYS,
} from '@app/module/client';
import type { z } from 'zod';

/**
 * Native number inputs anchor their spinner ladder on `min`, so both bounds and the default
 * must be reachable from `min` by whole steps or the arrows skip over them.
 */
export const HALF_LIFE_STEP_DAYS = 1;

export const UNKNOWN_ACTIVITY_AGE_STEP_DAYS = 1;

const formatBound = (value: number) => value.toLocaleString(i18n.locale || 'en');

export const buildThreatRelevanceSettingsFormSchema = () => {
  const minHalfLife = formatBound(MIN_ACT_HALF_LIFE_DAYS);
  const maxHalfLife = formatBound(MAX_ACT_HALF_LIFE_DAYS);
  const minUnknownActivityAge = formatBound(MIN_UNKNOWN_ACTIVITY_AGE_DAYS);
  const maxUnknownActivityAge = formatBound(MAX_UNKNOWN_ACTIVITY_AGE_DAYS);

  const enterDays = t`Enter a number of days.`;

  // The shared schema leaves the field optional so a caller that never sends it keeps the stored
  // value; the form always owns it, so a cleared field must be refused rather than silently kept.
  return buildThreatRelevanceSettingsSchema({
    halfLifeRequired: enterDays,
    halfLifeInteger: t`The half-life must be a whole number of days.`,
    halfLifeMin: t`The half-life must be at least ${minHalfLife} days.`,
    halfLifeMax: t`The half-life must be at most ${maxHalfLife} days.`,
    observedNotSlowerThanAuthored: t`The observed anchor half-life must not exceed the authored anchor half-life.`,
    confidenceGateInvalid: t`Select a confidence level.`,
    unknownActivityAgeInteger: t`The assumed activity age must be a whole number of days.`,
    unknownActivityAgeMin: t`The assumed activity age must be at least ${minUnknownActivityAge} days.`,
    unknownActivityAgeMax: t`The assumed activity age must be at most ${maxUnknownActivityAge} days.`,
  }).refine(
    (values) => values.unknownActivityAgeDays !== undefined,
    { error: enterDays, path: ['unknownActivityAgeDays'] },
  );
};

export type ThreatRelevanceSettingsFormValues = z.infer<ReturnType<typeof buildThreatRelevanceSettingsFormSchema>>;
