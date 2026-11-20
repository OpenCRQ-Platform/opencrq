import {
  DuplicatePrimaryAssetReferenceError,
  DuplicatePrimaryAssetTemplateError,
  PRIMARY_ASSET_BUSINESS_FUNCTION_MAX_LENGTH,
  PRIMARY_ASSET_DURATION_MAX_MINUTES,
  PRIMARY_ASSET_ONBOARDING_TEMPLATES,
  PRIMARY_ASSET_REFERENCE_MAX_LENGTH,
  primaryAssets,
  SECURITY_NEED_LEVELS,
} from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { withConflictOn } from '../structured-error-conflict';

const levelSchema = z.enum(SECURITY_NEED_LEVELS).nullable();
const durationSchema = z.number().int().min(0).max(PRIMARY_ASSET_DURATION_MAX_MINUTES).nullable();

/** Each optional on an update, where an absent field is left as it is and `null` clears it. */
const NativeFieldsSchema = z.object({
  reference: z.string().trim().max(PRIMARY_ASSET_REFERENCE_MAX_LENGTH).nullable(),
  businessFunction: z.string().trim().max(PRIMARY_ASSET_BUSINESS_FUNCTION_MAX_LENGTH).nullable(),
  availability: levelSchema,
  integrity: levelSchema,
  confidentiality: levelSchema,
  traceability: levelSchema,
  rtoMinutes: durationSchema,
  rpoMinutes: durationSchema,
  mtpdMinutes: durationSchema,
}).partial();

const PrimaryAssetListRowSchema = createSelectSchema(primaryAssets)
  .pick({
    id: true,
    name: true,
    description: true,
    reference: true,
    businessFunction: true,
    availability: true,
    integrity: true,
    confidentiality: true,
    traceability: true,
    rtoMinutes: true,
    rpoMinutes: true,
    mtpdMinutes: true,
    onboardingTemplate: true,
  })
  .extend({
    availability: levelSchema,
    integrity: levelSchema,
    confidentiality: levelSchema,
    traceability: levelSchema,
    onboardingTemplate: z.enum(PRIMARY_ASSET_ONBOARDING_TEMPLATES).nullable(),
    owner: z.object({ name: z.string().nullable() }).nullable(),
    businessValueCategories: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  });

export const primaryAssetsRouter = (procedure: TenantProcedure) => router({
  createPrimaryAsset: procedure
    .input(z.object({
      id: z.uuid(),
      organizationId: z.uuid(),
      name: z.string().min(1),
      description: z.string().nullable(),
      ownerId: z.uuid().nullable(),
      businessValueCategoryIds: z.array(z.uuid()).min(1),
      onboardingTemplate: z.enum(PRIMARY_ASSET_ONBOARDING_TEMPLATES).nullable().optional(),
    }).extend(NativeFieldsSchema.shape))
    .mutation(async ({ input, ctx: { services, origin } }) => withConflictOn(DuplicatePrimaryAssetTemplateError, async () => withConflictOn(
      DuplicatePrimaryAssetReferenceError,
      async () => services.withOrigin(origin).primaryAssets.createPrimaryAsset(input),
    ))),
  updatePrimaryAsset: procedure
    .input(z.object({
      id: z.uuid(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      ownerId: z.uuid().nullable().optional(),
      businessValueCategoryIds: z.array(z.uuid()).min(1).optional(),
    }).extend(NativeFieldsSchema.shape))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { id, ...values } = input;
      return withConflictOn(DuplicatePrimaryAssetReferenceError, async () => services.withOrigin(origin).primaryAssets.updatePrimaryAsset(id, values));
    }),
  deletePrimaryAssets: procedure
    .input(z.array(z.uuid()))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .primaryAssets.deletePrimaryAssets(input)),
  getPrimaryAsset: procedure
    .input(z.object({ id: z.uuid() }))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .primaryAssets.getPrimaryAsset(input.id)),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the primary assets users create in the risk scope
  getPrimaryAssets: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.array(PrimaryAssetListRowSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .primaryAssets.getPrimaryAssets(input.organizationId)),
  /** Every scope's, since a supporting asset may support the primary assets of several. */
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the primary assets users create
  getPrimaryAssetsWithScope: procedure
    .output(z.array(z.object({
      id: z.uuid(),
      name: z.string(),
      organization: z.object({ id: z.uuid(), name: z.string() }),
      owner: z.object({ id: z.uuid(), name: z.string().nullable(), email: z.string() }).nullable(),
    })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .primaryAssets.getPrimaryAssetsWithScope()),
});
