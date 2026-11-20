import { threatRelevanceSettingsSchema } from '@app/module';
import { z } from 'zod';
import type { TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const ThreatRelevanceSettingsOutputSchema = z.object({
  actHalfLifeObservedDays: z.number(),
  actHalfLifeAuthoredDays: z.number(),
  confidenceGate: z.number(),
  unknownActivityAgeDays: z.number(),
});

export const threatRelevanceSettingsRouter = (procedure: TenantSecurityProcedure) => router({
  getThreatRelevanceSettings: procedure
    .output(ThreatRelevanceSettingsOutputSchema)
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).threatRelevanceSettings.getThreatRelevanceSettings()),

  updateThreatRelevanceSettings: procedure
    .input(threatRelevanceSettingsSchema)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      await svc.threatRelevanceSettings.updateThreatRelevanceSettings(input);
    }),
});
