import {
  ASSET_CATEGORY_VALUES,
  ASSET_CRITICALITY_VALUES,
  DEPENDENCY_CANDIDATE_RELATIONS,
  DEPENDENCY_GRAPH_DEFAULT_DEPTH,
  DEPENDENCY_GRAPH_MAX_DEPTH,
  INTEGRATION_SOURCES,
  isStorableLinkRoleSet,
  MAX_DEPENDENCY_LINKS_PER_WRITE,
  PRIMARY_TO_PRIMARY_LINK_STRENGTHS,
  PrimaryAssetNotFoundError,
  PrimaryToPrimaryLinkRefusedError,
  SUPPORT_TO_PRIMARY_LINK_ROLES,
} from '@app/module';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, pagedOutput } from '../pagination';
import { withBadRequestOn, withNotFoundOn } from '../structured-error-conflict';

const linkRolesSchema = z.array(z.enum(SUPPORT_TO_PRIMARY_LINK_ROLES))
  .refine(isStorableLinkRoleSet, 'A dependency needs at least one role, and Unknown cannot be combined with another role');

const isUniqueBy = <T>(items: ReadonlyArray<T>, key: (item: T) => string) => new Set(items.map(key)).size === items.length;
const UNIQUE_LINK_IDS = 'A link id cannot appear twice in one call';
const UNIQUE_PAIRS = 'A pair cannot be linked twice in one call';

const DEPENDENCY_CANDIDATE_ROW_SCHEMA = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  derivedName: z.string().nullable(),
  categoryId: z.enum(ASSET_CATEGORY_VALUES),
  exposure: z.enum(['internet_facing', 'internal', 'unknown']),
  criticality: z.enum(ASSET_CRITICALITY_VALUES),
  /** The reporting connectors' slugs, empty for an asset only a person set. */
  sources: z.array(z.string()),
});

const LINK_ROLES_OUTPUT = z.array(z.enum(SUPPORT_TO_PRIMARY_LINK_ROLES));

const SUPPORT_TO_PRIMARY_LINK_BY_SUPPORTING_ROW_SCHEMA = z.object({
  id: z.uuid(),
  primaryAssetId: z.uuid(),
  roles: LINK_ROLES_OUTPUT,
  primaryAssetName: z.string().nullable(),
  organizationName: z.string().nullable(),
});

const SUPPORT_TO_PRIMARY_LINK_BY_PRIMARY_ROW_SCHEMA = z.object({
  id: z.uuid(),
  supportingAssetId: z.uuid(),
  roles: LINK_ROLES_OUTPUT,
  supportingAssetName: z.string().nullable(),
  supportingAssetDerivedName: z.string().nullable(),
  supportingAssetCategoryId: z.enum(ASSET_CATEGORY_VALUES).nullable(),
});

const SUPPORT_TO_SUPPORT_LINK_ROW_SCHEMA = z.object({
  id: z.uuid(),
  direction: z.enum(['provides', 'depends']),
  relatedAssetId: z.uuid(),
  relatedAssetName: z.string().nullable(),
  relatedAssetDerivedName: z.string().nullable(),
});

const PRIMARY_TO_PRIMARY_LINK_ROW_SCHEMA = z.object({
  id: z.uuid(),
  direction: z.enum(['provides', 'depends']),
  relatedAssetId: z.uuid(),
  relatedAssetName: z.string(),
  strength: z.enum(PRIMARY_TO_PRIMARY_LINK_STRENGTHS),
});

export const assetDependenciesRouter = (procedure: TenantProcedure) => router({
  /**
   * The supporting assets a manage drawer offers for one relation of one asset, linked ones first and
   * then by name. `assetId` is the supporting asset being edited for `dependsOn` / `providesTo`, which
   * is never offered to itself, and the primary asset for `supportsPrimary`.
   */
  listSupportingAssetCandidates: procedure
    .input(z.object({
      relation: z.enum(DEPENDENCY_CANDIDATE_RELATIONS),
      assetId: z.uuid(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
      search: z.string().nullable().default(null),
      source: z.enum([...INTEGRATION_SOURCES, 'user']).nullable().default(null),
      categoryId: z.enum(ASSET_CATEGORY_VALUES).nullable().default(null),
      linkedOnly: z.boolean().default(false),
    }))
    .output(pagedOutput(DEPENDENCY_CANDIDATE_ROW_SCHEMA))
    .query(async ({ input, ctx: { services, origin } }) => {
      const page = await services.withOrigin(origin).supportingAssets.listDependencyCandidates({
        page: input.page,
        limit: input.limit,
        search: input.search,
        source: input.source,
        categoryId: input.categoryId,
        dependency: { relation: input.relation, assetId: input.assetId, linkedOnly: input.linkedOnly },
      });
      return {
        ...page,
        items: page.items.map((asset) => ({
          id: asset.id,
          name: asset.name,
          derivedName: asset.derivedName,
          categoryId: asset.categoryId,
          exposure: asset.exposure,
          criticality: asset.criticality,
          sources: [...new Set(asset.sources.flatMap((source) => (source.source === null ? [] : [source.source])))],
        })),
      };
    }),

  createSupportToPrimaryLinks: procedure
    .input(z.array(z.object({
      id: z.uuid(),
      supportingAssetId: z.uuid(),
      primaryAssetId: z.uuid(),
      roles: linkRolesSchema.optional(),
    })).max(MAX_DEPENDENCY_LINKS_PER_WRITE)
      .refine((links) => isUniqueBy(links, (link) => link.id), UNIQUE_LINK_IDS)
      .refine((links) => isUniqueBy(links, (link) => `${link.supportingAssetId}:${link.primaryAssetId}`), UNIQUE_PAIRS))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.createSupportToPrimaryLinks(input)),
  updateSupportToPrimaryLinks: procedure
    .input(z.array(z.object({
      id: z.uuid(),
      roles: linkRolesSchema,
    })).max(MAX_DEPENDENCY_LINKS_PER_WRITE)
      .refine((links) => isUniqueBy(links, (link) => link.id), 'A link cannot be updated twice in one call'))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.updateSupportToPrimaryLinks(input)),
  deleteSupportToPrimaryLinks: procedure
    .input(z.array(z.uuid()).max(MAX_DEPENDENCY_LINKS_PER_WRITE))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.deleteSupportToPrimaryLinks(input)),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the primary assets one supporting asset supports, created by hand
  getSupportToPrimaryLinksBySupportingAssetId: procedure
    .input(z.object({ supportingAssetId: z.uuid() }))
    .output(z.array(SUPPORT_TO_PRIMARY_LINK_BY_SUPPORTING_ROW_SCHEMA))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(input.supportingAssetId)),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the supporting assets linked to one primary asset, not capped yet
  getSupportToPrimaryLinksByPrimaryAssetId: procedure
    .input(z.object({ primaryAssetId: z.uuid() }))
    .output(z.array(SUPPORT_TO_PRIMARY_LINK_BY_PRIMARY_ROW_SCHEMA))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(input.primaryAssetId)),

  getPrimaryAssetDependencyGraph: procedure
    .input(z.object({
      primaryAssetId: z.uuid(),
      depth: z.number().int().min(1).max(DEPENDENCY_GRAPH_MAX_DEPTH).default(DEPENDENCY_GRAPH_DEFAULT_DEPTH),
    }))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(PrimaryAssetNotFoundError, () => services.withOrigin(origin)
      .assetDependencies.getPrimaryAssetDependencyGraph(input.primaryAssetId, input.depth))),
  getSupportingAssetDependencyGraph: procedure
    .input(z.object({
      supportingAssetId: z.uuid(),
      depth: z.number().int().min(1).max(DEPENDENCY_GRAPH_MAX_DEPTH).default(DEPENDENCY_GRAPH_DEFAULT_DEPTH),
    }))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.getSupportingAssetDependencyGraph(input.supportingAssetId, input.depth)),

  createSupportToSupportLinks: procedure
    .input(z.array(z.object({
      id: z.uuid(),
      providerAssetId: z.uuid(),
      dependentAssetId: z.uuid(),
    })).max(MAX_DEPENDENCY_LINKS_PER_WRITE)
      .refine((links) => isUniqueBy(links, (link) => link.id), UNIQUE_LINK_IDS)
      .refine((links) => isUniqueBy(links, (link) => `${link.providerAssetId}:${link.dependentAssetId}`), UNIQUE_PAIRS))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.createSupportToSupportLinks(input)),
  deleteSupportToSupportLinks: procedure
    .input(z.array(z.uuid()).max(MAX_DEPENDENCY_LINKS_PER_WRITE))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.deleteSupportToSupportLinks(input)),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the assets linked to one supporting asset, both ways, not capped yet
  getSupportToSupportLinks: procedure
    .input(z.object({ assetId: z.uuid() }))
    .output(z.array(SUPPORT_TO_SUPPORT_LINK_ROW_SCHEMA))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.getSupportToSupportLinks(input.assetId)),

  // eslint-disable-next-line app/no-unused-router-endpoint -- an import script writes these links by name; no screen calls it yet
  createPrimaryToPrimaryLinks: procedure
    .input(z.array(z.object({
      id: z.uuid(),
      dependentAssetId: z.uuid(),
      providerAssetId: z.uuid(),
      strength: z.enum(PRIMARY_TO_PRIMARY_LINK_STRENGTHS).optional(),
    }).refine((link) => link.dependentAssetId !== link.providerAssetId, 'A primary asset cannot depend on itself'))
      .max(MAX_DEPENDENCY_LINKS_PER_WRITE)
      .refine((links) => isUniqueBy(links, (link) => link.id), UNIQUE_LINK_IDS)
      .refine((links) => isUniqueBy(links, (link) => `${link.dependentAssetId}:${link.providerAssetId}`), UNIQUE_PAIRS))
    .mutation(async ({ input, ctx: { services, origin } }) => withBadRequestOn(PrimaryToPrimaryLinkRefusedError, () => services.withOrigin(origin)
      .assetDependencies.createPrimaryToPrimaryLinks(input))),
  // eslint-disable-next-line app/no-unused-router-endpoint -- an import script writes these links by name; no screen calls it yet
  updatePrimaryToPrimaryLinks: procedure
    .input(z.array(z.object({
      id: z.uuid(),
      strength: z.enum(PRIMARY_TO_PRIMARY_LINK_STRENGTHS),
    })).max(MAX_DEPENDENCY_LINKS_PER_WRITE)
      .refine((links) => isUniqueBy(links, (link) => link.id), 'A link cannot be updated twice in one call'))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.updatePrimaryToPrimaryLinks(input)),
  // eslint-disable-next-line app/no-unused-router-endpoint -- an import script writes these links by name; no screen calls it yet
  deletePrimaryToPrimaryLinks: procedure
    .input(z.array(z.uuid()).max(MAX_DEPENDENCY_LINKS_PER_WRITE))
    .mutation(async ({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.deletePrimaryToPrimaryLinks(input)),
  // eslint-disable-next-line app/no-unbounded-list-query, app/no-unused-router-endpoint -- grows with the primary assets linked to one primary asset, both ways; an import script reads it by name, no screen calls it yet
  getPrimaryToPrimaryLinks: procedure
    .input(z.object({ primaryAssetId: z.uuid() }))
    .output(z.array(PRIMARY_TO_PRIMARY_LINK_ROW_SCHEMA))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.getPrimaryToPrimaryLinks(input.primaryAssetId)),
});
