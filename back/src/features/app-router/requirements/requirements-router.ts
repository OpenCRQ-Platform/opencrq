import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const NamedRefSchema = z.object({ id: z.uuid(), name: z.string() });

const RequirementSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  interestedParty: z.string(),
  protectsConfidentiality: z.boolean(),
  protectsIntegrity: z.boolean(),
  protectsAvailability: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  primaryAssets: z.array(NamedRefSchema),
  businessValueCategories: z.array(NamedRefSchema.extend({ code: z.string() })),
  lossDrivers: z.array(NamedRefSchema),
});

/** A requirement that protects nothing, targets nothing or opens nothing could never be broken. */
const RequirementValuesSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().nullable().transform((value) => (value === '' ? null : value)),
  interestedParty: z.string().trim().min(1),
  protectsConfidentiality: z.boolean(),
  protectsIntegrity: z.boolean(),
  protectsAvailability: z.boolean(),
  primaryAssetIds: z.array(z.uuid()),
  businessValueCategoryIds: z.array(z.uuid()),
  lossDriverIds: z.array(z.uuid()).min(1),
});

const refineRequirement = (values: z.infer<typeof RequirementValuesSchema>, ctx: z.RefinementCtx) => {
  if (!values.protectsConfidentiality && !values.protectsIntegrity && !values.protectsAvailability) {
    ctx.addIssue({ code: 'custom', message: 'A requirement protects at least one criterion', path: ['protectsAvailability'] });
  }
  if (values.primaryAssetIds.length + values.businessValueCategoryIds.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'A requirement has at least one target', path: ['primaryAssetIds'] });
  }
};

export const requirementsRouter = (procedure: TenantProcedure) => router({
  createRequirement: procedure
    .input(RequirementValuesSchema.extend({ id: z.uuid(), organizationId: z.uuid() }).superRefine(refineRequirement))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .requirements.createRequirement(input)),
  updateRequirement: procedure
    .input(RequirementValuesSchema.extend({ id: z.uuid() }).superRefine(refineRequirement))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { id, ...values } = input;
      return services.withOrigin(origin).requirements.updateRequirement(id, values);
    }),
  deleteRequirements: procedure
    .input(z.array(z.uuid()))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .requirements.deleteRequirements(input)),
  getRequirement: procedure
    .input(z.object({ id: z.uuid() }))
    .output(RequirementSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .requirements.getRequirement(input.id) ?? null),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the requirements users write in the risk scope
  getRequirements: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.array(RequirementSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .requirements.getRequirements(input.organizationId)),
  // bounded-by: the requirements of the scenario's risk scope
  getBrokenRequirements: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.array(z.object({
      id: z.uuid(),
      name: z.string(),
      interestedParty: z.string(),
      lossDrivers: z.array(NamedRefSchema),
    })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .requirements.getBrokenRequirements(input.riskScenarioId)),
});
