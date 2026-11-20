import { z } from 'zod';
import type { TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { CrqIndicatorSettingsSchema, UpdateCrqIndicatorSettingsSchema } from './crq-indicator-settings-schema';

export const crqIndicatorSettingsRouter = (procedure: TenantSecurityProcedure) => router({
  getCrqIndicatorSettings: procedure
    .output(CrqIndicatorSettingsSchema)
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).crqIndicatorSettings.getCrqIndicatorSettings()),

  updateCrqIndicatorSettings: procedure
    .input(UpdateCrqIndicatorSettingsSchema)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      await svc.crqIndicatorSettings.updateCrqIndicatorSettings(input);
    }),
});
