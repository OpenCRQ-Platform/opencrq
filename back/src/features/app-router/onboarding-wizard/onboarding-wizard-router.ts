import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const OnboardingStepStatusSchema = z.enum(['done', 'started', 'todo']);

const OnboardingWizardSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  steps: z.object({
    company: OnboardingStepStatusSchema,
    assets: OnboardingStepStatusSchema,
    threats: OnboardingStepStatusSchema,
    defenses: OnboardingStepStatusSchema,
    finances: OnboardingStepStatusSchema,
    tolerance: OnboardingStepStatusSchema,
    protect: OnboardingStepStatusSchema,
    scenarios: OnboardingStepStatusSchema,
  }),
  finished: z.boolean(),
});

export const onboardingWizardRouter = (procedure: TenantProcedure) => router({
  getOnboardingWizard: procedure
    .output(OnboardingWizardSchema.nullable())
    .query(async ({ ctx: { services, origin } }) => await services.withOrigin(origin)
      .onboardingWizards.getOnboardingWizard() ?? null),
});
