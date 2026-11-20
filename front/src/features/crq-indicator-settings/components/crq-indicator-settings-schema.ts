import { DECLARED_CRITICALITY_VALUES, UNKNOWN_EXPOSURE_COUNTS_AS_VALUES } from '@app/module/client';
import { z } from 'zod';
import { validatePhishingDeclaration } from '../crq-indicator-settings-utils';

export const crqIndicatorSettingsFormSchema = z.object({
  iterations: z.number().int().positive(),
  exposureWeightInternetFacing: z.number().positive(),
  exposureWeightInternal: z.number().positive(),
  susceptibilityGamma: z.number().min(0).max(1),
  measuredValidityDays: z.number().int().positive().nullable(),
  unknownCriticalityCountsAs: z.enum(DECLARED_CRITICALITY_VALUES),
  unknownExposureCountsAs: z.enum(UNKNOWN_EXPOSURE_COUNTS_AS_VALUES),
  phishingFailureRate: z.number().nullable(),
  phishingFailureMeasuredOn: z.string().nullable(),
}).superRefine((values, ctx) => {
  const errors = validatePhishingDeclaration(
    { rate: values.phishingFailureRate, measuredOn: values.phishingFailureMeasuredOn },
    new Date(),
  );
  // The message is the error code: the section maps it to a translated text.
  if (errors.rate !== null) {
    ctx.addIssue({ code: 'custom', message: errors.rate, path: ['phishingFailureRate'] });
  }
  if (errors.measuredOn !== null) {
    ctx.addIssue({ code: 'custom', message: errors.measuredOn, path: ['phishingFailureMeasuredOn'] });
  }
});

export type CrqIndicatorSettingsFormValues = z.infer<typeof crqIndicatorSettingsFormSchema>;
