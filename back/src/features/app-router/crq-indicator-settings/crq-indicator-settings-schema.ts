import { z } from 'zod';
import { DECLARED_CRITICALITY_VALUES, isMeasuredInFuture, MAX_CRQ_ITERATIONS, PHISHING_FAILURE_RATE_BOUNDS, UNKNOWN_EXPOSURE_COUNTS_AS_VALUES } from '@app/module';

const phishingFailureRate = z.number().min(PHISHING_FAILURE_RATE_BOUNDS.min).max(PHISHING_FAILURE_RATE_BOUNDS.max);

/** The day of the last phishing simulation, as `YYYY-MM-DD`. */
const calendarDay = z.iso.date();

export const CrqIndicatorSettingsSchema = z.object({
  iterations: z.number().int().positive().max(MAX_CRQ_ITERATIONS),
  exposureWeightInternetFacing: z.number().positive(),
  exposureWeightInternal: z.number().positive(),
  susceptibilityGamma: z.number().min(0).max(1),
  measuredValidityDays: z.number().int().positive().nullable(),
  unknownCriticalityCountsAs: z.enum(DECLARED_CRITICALITY_VALUES),
  unknownExposureCountsAs: z.enum(UNKNOWN_EXPOSURE_COUNTS_AS_VALUES),
  phishingFailureRate: phishingFailureRate.nullable(),
  phishingFailureMeasuredOn: calendarDay.nullable(),
});

export const UpdateCrqIndicatorSettingsSchema = z.object({
  iterations: z.number().int().positive().max(MAX_CRQ_ITERATIONS).optional(),
  exposureWeightInternetFacing: z.number().positive().optional(),
  exposureWeightInternal: z.number().positive().optional(),
  susceptibilityGamma: z.number().min(0).max(1).optional(),
  // Null turns the window off, so the key is nullable as well as optional: the service tells the
  // two apart and only an omitted key keeps what is stored.
  measuredValidityDays: z.number().int().positive().nullable().optional(),
  unknownCriticalityCountsAs: z.enum(DECLARED_CRITICALITY_VALUES).optional(),
  unknownExposureCountsAs: z.enum(UNKNOWN_EXPOSURE_COUNTS_AS_VALUES).optional(),
  // The two travel together: a rate is read as measured on a day, and null clears both.
  phishingFailureRate: phishingFailureRate.nullable().optional(),
  phishingFailureMeasuredOn: calendarDay
    .refine((day) => !isMeasuredInFuture(day, new Date()), 'A campaign cannot be measured in the future')
    .nullable()
    .optional(),
}).refine(
  (input) => (input.phishingFailureRate === undefined) === (input.phishingFailureMeasuredOn === undefined)
    && (input.phishingFailureRate === null) === (input.phishingFailureMeasuredOn === null),
  { error: 'A phishing failure rate and the day it was measured are given together, or cleared together', path: ['phishingFailureMeasuredOn'] },
);
