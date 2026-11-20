import { z } from 'zod';
import {
  CONFIDENCE_GATE_LEVELS,
  MAX_ACT_HALF_LIFE_DAYS,
  MAX_UNKNOWN_ACTIVITY_AGE_DAYS,
  MIN_ACT_HALF_LIFE_DAYS,
  MIN_UNKNOWN_ACTIVITY_AGE_DAYS,
} from './constants';

export type ThreatRelevanceSettingsMessages = {
  halfLifeRequired: string,
  halfLifeInteger: string,
  halfLifeMin: string,
  halfLifeMax: string,
  observedNotSlowerThanAuthored: string,
  confidenceGateInvalid: string,
  unknownActivityAgeInteger: string,
  unknownActivityAgeMin: string,
  unknownActivityAgeMax: string,
};

const DEFAULT_MESSAGES: ThreatRelevanceSettingsMessages = {
  halfLifeRequired: 'A half-life in days is required',
  halfLifeInteger: 'The half-life must be a whole number of days',
  halfLifeMin: `The half-life must be at least ${MIN_ACT_HALF_LIFE_DAYS} days`,
  halfLifeMax: `The half-life must be at most ${MAX_ACT_HALF_LIFE_DAYS} days`,
  observedNotSlowerThanAuthored: 'The observed anchor half-life must not exceed the authored anchor half-life',
  confidenceGateInvalid: 'A confidence level is required',
  unknownActivityAgeInteger: 'The age of an unknown activity must be a whole number of days',
  unknownActivityAgeMin: `The age of an unknown activity must be at least ${MIN_UNKNOWN_ACTIVITY_AGE_DAYS} days`,
  unknownActivityAgeMax: `The age of an unknown activity must be at most ${MAX_UNKNOWN_ACTIVITY_AGE_DAYS} days`,
};

/**
 * Single source of the threat relevance settings field rules, shared by the tRPC input
 * schema, the domain service write guard and the frontend form schema. Messages are
 * injected so the frontend can hand over translated strings.
 */
export const buildThreatRelevanceSettingsSchema = (
  messages: ThreatRelevanceSettingsMessages = DEFAULT_MESSAGES,
) => {
  const halfLifeDays = z.number({ error: messages.halfLifeRequired })
    .int({ error: messages.halfLifeInteger })
    .min(MIN_ACT_HALF_LIFE_DAYS, { error: messages.halfLifeMin })
    .max(MAX_ACT_HALF_LIFE_DAYS, { error: messages.halfLifeMax });

  const unknownActivityAgeDays = z.number({ error: messages.unknownActivityAgeInteger })
    .int({ error: messages.unknownActivityAgeInteger })
    .min(MIN_UNKNOWN_ACTIVITY_AGE_DAYS, { error: messages.unknownActivityAgeMin })
    .max(MAX_UNKNOWN_ACTIVITY_AGE_DAYS, { error: messages.unknownActivityAgeMax });

  return z.object({
    actHalfLifeObservedDays: halfLifeDays,
    actHalfLifeAuthoredDays: halfLifeDays,
    confidenceGate: z.number({ error: messages.confidenceGateInvalid })
      .refine((value) => CONFIDENCE_GATE_LEVELS.some((level) => level === value), { error: messages.confidenceGateInvalid }),
    unknownActivityAgeDays: unknownActivityAgeDays.optional(),
  }).refine(
    (values) => values.actHalfLifeObservedDays <= values.actHalfLifeAuthoredDays,
    { error: messages.observedNotSlowerThanAuthored, path: ['actHalfLifeObservedDays'] },
  );
};

export const threatRelevanceSettingsSchema = buildThreatRelevanceSettingsSchema();

export type ThreatRelevanceSettingsValues = z.infer<typeof threatRelevanceSettingsSchema>;

export type ThreatRelevanceSettings = ThreatRelevanceSettingsValues & { unknownActivityAgeDays: number };
