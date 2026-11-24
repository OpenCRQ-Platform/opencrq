import { DWELL_SENSITIVITY_VALUES, lossDrivers, SCALING_VARIABLE_VALUES } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

// `createSelectSchema` widens `text().$type<Union>()` to `z.string()`, so both closed
// vocabularies are restated here or the client loses the union.
const LossDriverSchema = createSelectSchema(lossDrivers).omit({ tenantId: true }).extend({
  dwellSensitivity: z.enum(DWELL_SENSITIVITY_VALUES),
  scalingVariable: z.enum(SCALING_VARIABLE_VALUES),
  lossCategoryName: z.string(),
  lossCategoryDisplayOrder: z.number().int(),
});

const RecommendationCellSchema = z.object({
  attackOutcomeId: z.uuid(),
  attackOutcomeName: z.string(),
  businessValueCategoryId: z.uuid(),
  businessValueCategoryCode: z.string(),
  businessValueCategoryName: z.string(),
});

const ScenarioDriverRecommendationSchema = z.object({
  compatibleCellCount: z.number().int(),
  recommendations: z.array(z.object({
    lossDriverId: z.uuid(),
    viaCells: z.array(RecommendationCellSchema),
    viaRequirements: z.array(z.object({ requirementId: z.uuid(), requirementName: z.string() })),
  })),
});

const LossDriverActivationCellSchema = z.object({
  attackOutcomeId: z.uuid(),
  attackOutcomeName: z.string(),
  businessValueCategoryId: z.uuid(),
  businessValueCategoryCode: z.string(),
  businessValueCategoryName: z.string(),
  businessValueCategoryDisplayOrder: z.number().int(),
  applies: z.boolean(),
});

/** Closed catalog: reads only, seeded per tenant. The activation matrix has no write endpoint. */
export const lossDriversRouter = (procedure: TenantProcedure) => router({
  getLossDriver: procedure
    .input(z.object({ id: z.uuid() }))
    .output(LossDriverSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .lossDrivers.getLossDriver(input.id) ?? null),
  // bounded-by: the loss-driver catalogue, 19 drivers seeded into every tenant
  getLossDrivers: procedure
    .output(z.array(LossDriverSchema.pick({
      id: true,
      lossCategoryId: true,
      name: true,
      description: true,
      dwellSensitivity: true,
      lossCategoryName: true,
      lossCategoryDisplayOrder: true,
    })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .lossDrivers.getLossDrivers()),
  // bounded-by: the business-value category catalogue, each category once
  getCompatibleBusinessValueCategoryIds: procedure
    .input(z.object({ attackOutcomeId: z.uuid() }))
    .output(z.array(z.uuid()))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .lossDrivers.getCompatibleBusinessValueCategoryIds(input.attackOutcomeId)),
  getScenarioDriverRecommendation: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(ScenarioDriverRecommendationSchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .lossDrivers.getScenarioDriverRecommendation(input.riskScenarioId)),
  // bounded-by: LOSS_ACTIVATION_MATRIX, one row per compatible (outcome, category) cell
  getLossDriverActivations: procedure
    .input(z.object({ lossDriverId: z.uuid() }))
    .output(z.array(LossDriverActivationCellSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .lossDrivers.getLossDriverActivations(input.lossDriverId)),
});
