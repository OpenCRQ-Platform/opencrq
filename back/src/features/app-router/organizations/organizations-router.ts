import {
  ASSET_CATEGORY_VALUES,
  ASSET_MAPPING_CHANGES,
  countries,
  CountryNotFoundError,
  ESTATE_MODE_VALUES,
  journalValueSchema,
  MappedAssetNotVisibleError,
  MAX_SCOPE_MAPPING_IDS,
  ORGANIZATION_IDENTITY_FIELDS,
  organizations,
  REVENUE_BAND_VALUES,
  RiskScopeAlreadyExistsError,
  RiskScopeNotFoundError,
  SectorNotFoundError,
  sectors,
} from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { RiskToleranceSchema } from '../risk-tolerance';
import { userSessionOnly } from '../user-session-only';
import { enqueueTefRecomputeOnFirmographyChange, FIRMOGRAPHY_FIELDS } from './firmography-recompute';

const OrganizationsSchema = createSelectSchema(organizations, {
  revenueBand: z.enum(REVENUE_BAND_VALUES).nullable(),
  estateMode: z.enum(ESTATE_MODE_VALUES),
});
const SectorsSchema = createSelectSchema(sectors);
const CountriesSchema = createSelectSchema(countries);

const OrganizationWithRelationsSchema = OrganizationsSchema.extend({
  sector: SectorsSchema.nullable(),
  country: CountriesSchema.nullable(),
  mappedAssetCount: z.number().int(),
  noMappedAsset: z.boolean(),
});

const OrganizationListRowSchema = OrganizationsSchema.pick({
  id: true,
  tenantId: true,
  name: true,
  description: true,
  sectorId: true,
  countryId: true,
  revenueBand: true,
  employeeCount: true,
  estateMode: true,
}).extend({
  sector: SectorsSchema.nullable(),
  country: CountriesSchema.nullable(),
  mappedAssetCount: z.number().int(),
  noMappedAsset: z.boolean(),
});

const OrganizationValuesSchema = z.object({
  description: z.string().nullable().optional(),
  legalEntityName: z.string().nullable().optional(),
  sectorId: z.uuid().nullable().optional(),
  countryId: z.uuid().nullable().optional(),
  revenueBand: z.enum(REVENUE_BAND_VALUES).nullable().optional(),
  employeeCount: z.number().int().nonnegative().nullable().optional(),
  domain: z.string().nullable().optional(),
  reactionTimeMin: z.number().nonnegative().nullable().optional(),
  reactionTimeLikely: z.number().positive().nullable().optional(),
  reactionTimeMax: z.number().positive().nullable().optional(),
  estateMode: z.enum(ESTATE_MODE_VALUES).optional(),
});

const IdentityEventSchema = z.object({
  id: z.uuid(),
  field: z.enum(ORGANIZATION_IDENTITY_FIELDS),
  before: journalValueSchema,
  after: journalValueSchema,
  createdAt: z.date(),
  userName: z.string().nullable(),
});

const AssetMappingEventSchema = z.object({
  id: z.uuid(),
  addedCount: z.number().int(),
  removedCount: z.number().int(),
  estateMode: z.object({ from: z.enum(ESTATE_MODE_VALUES), to: z.enum(ESTATE_MODE_VALUES) }).nullable(),
  createdAt: z.date(),
  userName: z.string().nullable(),
});

const AssetMappingEventAssetSchema = z.object({
  change: z.enum(ASSET_MAPPING_CHANGES),
  id: z.uuid(),
  name: z.string().nullable(),
  derivedName: z.string().nullable(),
  categoryId: z.enum(ASSET_CATEGORY_VALUES),
});

/** The cap applies to what the save really carries, so a list repeating one id is not turned away for its length. */
const mappingIds = z.array(z.uuid())
  .transform((ids) => [...new Set(ids)])
  .refine((ids) => ids.length <= MAX_SCOPE_MAPPING_IDS, {
    message: `A single save maps or unmaps at most ${MAX_SCOPE_MAPPING_IDS} assets`,
  });

const hasCoherentReactionTime = (data: {
  reactionTimeMin?: number | null,
  reactionTimeLikely?: number | null,
  reactionTimeMax?: number | null,
}) => {
  const { reactionTimeMin: min, reactionTimeLikely: likely, reactionTimeMax: max } = data;
  const provided = [min, likely, max].filter((value) => value !== undefined);
  if (provided.length === 0) {
    return true;
  }
  if (provided.length !== 3) {
    return false;
  }
  if (min == null || likely == null || max == null) {
    return min == null && likely == null && max == null;
  }
  return min <= likely && likely <= max;
};

const REACTION_TIME_MESSAGE = 'Reaction time must be either fully null or fully set, and satisfy: min <= likely <= max';

const UpdateOrganizationInputSchema = OrganizationValuesSchema
  .extend({
    id: z.uuid(),
    name: z.string().optional(),
    mapping: z.object({
      added: mappingIds.optional(),
      removed: mappingIds.optional(),
    }).optional(),
  })
  .refine(hasCoherentReactionTime, { message: REACTION_TIME_MESSAGE });

/**
 * `name` is required here and optional on update because the column is NOT NULL, and it is
 * trimmed to a non-empty string because the column would accept `''` as a name. A scope being
 * created has no stored mapping to delta against, so its ticks arrive as a set.
 */
const CreateOrganizationInputSchema = OrganizationValuesSchema
  .extend({ id: z.uuid(), name: z.string().trim().min(1), mappedAssetIds: mappingIds.optional() })
  .refine(hasCoherentReactionTime, { message: REACTION_TIME_MESSAGE });

/**
 * A save races the lists its ids were picked from, so these refusals are the caller's to act on,
 * not a server fault.
 */
const withMappingErrors = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof MappedAssetNotVisibleError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'An asset you ticked no longer exists, reload the list' });
    }
    if (error instanceof RiskScopeNotFoundError) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scope not found' });
    }
    if (error instanceof RiskScopeAlreadyExistsError) {
      throw new TRPCError({ code: 'CONFLICT', message: error.messageKey });
    }
    if (error instanceof SectorNotFoundError || error instanceof CountryNotFoundError) {
      throw new TRPCError({ code: 'NOT_FOUND', message: error.messageKey });
    }
    throw error;
  }
};

export const organizationsRouter = (procedure: TenantProcedure) => router({
  createOrganizationsTransaction: procedure
    .input(z.array(CreateOrganizationInputSchema))
    .mutation(async ({ input, ctx: { services, origin } }) => withMappingErrors(() => services.withOrigin(origin)
      .organizations.createOrganizations(input))),
  deleteOrganizations: procedure
    .input(z.array(z.uuid()))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .organizations.deleteOrganizations(input)),
  updateOrganization: procedure
    .input(UpdateOrganizationInputSchema)
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { id, mapping, ...columns } = input;
      const values = {
        ...columns,
        ...(mapping === undefined ? {} : { mapping: { added: mapping.added ?? [], removed: mapping.removed ?? [] } }),
      };
      const scopedServices = services.withOrigin(origin);
      const touchesFirmography = FIRMOGRAPHY_FIELDS.some((field) => field in values);
      if (!touchesFirmography) {
        return withMappingErrors(() => scopedServices.organizations.updateOrganization(id, values));
      }

      const before = await scopedServices.organizations.getOrganization(id);
      const result = await withMappingErrors(() => scopedServices.organizations.updateOrganization(id, values));
      const after = await scopedServices.organizations.getOrganization(id);
      await enqueueTefRecomputeOnFirmographyChange(scopedServices, origin, id, before, after);
      return result;
    }),
  getOrganization: procedure
    .input(z.object({ id: z.uuid() }))
    .output(OrganizationWithRelationsSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .organizations.getOrganization(input.id) ?? null),
  // eslint-disable-next-line app/no-unbounded-list-query, app/no-full-row-list-output -- grows with the tenant's risk scopes; nests whole sector and country rows, not trimmed yet
  getOrganizations: procedure
    .output(z.array(OrganizationListRowSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .organizations.getOrganizations()),
  // bounded-by: SCOPE_EVENTS_LIMIT, the service's cap on the events it returns
  getIdentityHistory: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.array(IdentityEventSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .organizations.getIdentityHistory(input.organizationId)),
  // bounded-by: SCOPE_EVENTS_LIMIT, the service's cap on the events it returns
  getAssetMappingHistory: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.array(AssetMappingEventSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .organizations.getAssetMappingHistory(input.organizationId)),
  // bounded-by: MAX_SCOPE_MAPPING_IDS, the most assets one save adds or removes
  getAssetMappingEventAssets: procedure
    .input(z.object({ eventId: z.uuid() }))
    .output(z.array(AssetMappingEventAssetSchema))
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .organizations.getAssetMappingEventAssets(input.eventId)),
  getRiskTolerance: procedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.object({ tolerance: RiskToleranceSchema.nullable(), scenarioCount: z.number().int(), ownThresholdCount: z.number().int() }))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .organizations.getRiskTolerance(input.organizationId)),
  setRiskTolerance: procedure
    .input(z.object({ organizationId: z.uuid(), tolerance: RiskToleranceSchema }))
    .mutation(async ({ input, ctx: { services, origin } }) => withMappingErrors(() => services.withOrigin(origin)
      .organizations.setRiskTolerance(input.organizationId, input.tolerance))),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's risk scopes, at most one unpin each for the calling user
  getUnpinnedOrganizationIds: procedure
    .output(z.array(z.uuid()))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .organizations.getUnpinnedOrganizationIds()),
  setOrganizationPinned: procedure
    .use(userSessionOnly)
    .input(z.object({ id: z.uuid(), pinned: z.boolean() }))
    .mutation(async ({ input, ctx: { services, origin } }) => withMappingErrors(() => services.withOrigin(origin)
      .organizations.setOrganizationPinned(input.id, input.pinned))),
});
