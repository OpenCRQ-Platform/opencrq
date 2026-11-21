import {
  AI_TARGET_MODALITY_VALUES,
  AI_TARGET_PROVIDER_VALUES,
  ASSET_CATEGORY_VALUES,
  ASSET_CRITICALITY_VALUES,
  ASSET_IDENTITY_PROVIDER_VALUES,
  ASSET_SORT_KEYS,
  ASSET_SUBCATEGORY_VALUES,
  CLOUD_PROVIDER_VALUES,
  ConnectorBackedEvidenceError,
  CVE_AFFECTED_ASSET_SORT_KEYS,
  CveNotFoundError,
  DEPENDENCY_GRAPH_MAX_DEPTH,
  DISMISSAL_REASON_CODE_VALUES,
  DISMISSAL_TYPE_VALUES,
  ENDPOINT_ARCH_VALUES,
  EVIDENCE_ACTIVITY_DAYS,
  EVIDENCE_HISTORY_ORIGINS,
  EVIDENCE_STATES,
  EvidenceAlreadyExistsError,
  EXPECTATION_TYPE_VALUES,
  INTEGRATION_SOURCES,
  InvalidAssetClassificationError,
  RiskScopeNotFoundError,
  SupportingAssetNotFoundError,
  TagMergeRefusedError,
  TagNameTakenError,
  TagNotFoundError,
  TECHNIQUE_AFFECTED_ASSET_SORT_KEYS,
} from '@app/module';
import { TRPCError } from '@trpc/server';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { requestFindingScoreRecompute } from '../../finding-score/finding-score-recompute-queue';
import { estateInput, resolveMappedOrganizationId } from '../estate';
import { pagedInput, pagedOutput } from '../pagination';
import { TIME_ZONE_INPUT } from '../time-zone';
import { router } from '../../../trpc';
import { withBadRequestOn, withConflictOn, withNotFoundOn } from '../structured-error-conflict';

const SUPPORTING_ASSET_SOURCE_SCHEMA = z.object({
  supportingAssetId: z.uuid(),
  connectorId: z.uuid().nullable(),
  source: z.string().nullable(),
  sourceAssetId: z.string(),
  firstSeenAt: z.date().nullable(),
  lastSeenAt: z.date().nullable(),
  reportedName: z.string().nullable(),
  reportedDescription: z.string().nullable(),
  reportedCategoryId: z.enum(ASSET_CATEGORY_VALUES),
  reportedSubcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable(),
  reportedExposure: z.enum(['internet_facing', 'internal', 'unknown']),
  reportedCriticality: z.enum(ASSET_CRITICALITY_VALUES),
});

/**
 * What a person may type by hand into a family's property block, calqued on
 * `ConnectorAssetProperties` (`module/src/modules/supporting-assets/types.ts`) minus what only a
 * connector can produce: `normalizedEndpointUrl` is derived by the platform from
 * `endpointUrl` (`normalizeEndpointUrl`), and a machine's `hardwareUuid`, `directoryDeviceId`,
 * `cloudVmId`, `cloudResourceId`, `agentExternalReference` and `agentExecutorType` are identifiers
 * an inventory system assigns — nobody keys in a Defender machine id or an AWS ARN, and accepting
 * them here would only invite someone to type a value that silently never matches what the
 * connector itself reports.
 */
const MANUAL_MACHINE_PROPERTIES_SCHEMA = z.object({
  family: z.literal('machine'),
  hostname: z.string().nullable().optional(),
  ipAddresses: z.array(z.string()).nullable().optional(),
  macAddresses: z.array(z.string()).nullable().optional(),
  seenIp: z.string().nullable().optional(),
  cloudProvider: z.enum(CLOUD_PROVIDER_VALUES).nullable().optional(),
  cloudNativeType: z.string().nullable().optional(),
  cloudRegion: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  arch: z.enum(ENDPOINT_ARCH_VALUES).nullable().optional(),
  vendor: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  operatingSystem: z.string().nullable().optional(),
  osVersion: z.string().nullable().optional(),
  isEol: z.boolean().nullable().optional(),
});

const MANUAL_AI_TARGET_PROPERTIES_SCHEMA = z.object({
  family: z.literal('ai_target'),
  provider: z.enum(AI_TARGET_PROVIDER_VALUES).nullable().optional(),
  endpointUrl: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  modality: z.enum(AI_TARGET_MODALITY_VALUES).nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
});

/**
 * An identity's hand-typed block, minus the directory's own identifiers on the same ground as a
 * machine's above: the object id and both SIDs are assigned by the directory and are what the
 * matcher joins on, and `directoryType` is the directory's own record type.
 */
const MANUAL_IDENTITY_PROPERTIES_SCHEMA = z.object({
  family: z.literal('identity'),
  userPrincipalName: z.string().nullable().optional(),
  accountDomain: z.string().nullable().optional(),
  accountName: z.string().nullable().optional(),
  identityProvider: z.enum(ASSET_IDENTITY_PROVIDER_VALUES).nullable().optional(),
  department: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  isEnabled: z.boolean().nullable().optional(),
  assignedRoles: z.array(z.string()).nullable().optional(),
  privilegedPimRoles: z.array(z.string()).nullable().optional(),
});

const MANUAL_ASSET_PROPERTIES_SCHEMA = z.discriminatedUnion('family', [
  MANUAL_MACHINE_PROPERTIES_SCHEMA,
  MANUAL_AI_TARGET_PROPERTIES_SCHEMA,
  MANUAL_IDENTITY_PROPERTIES_SCHEMA,
]);

/** A group a push names: its name, and the id the customer's own system gave it when there is one. */
const ASSET_GROUP_REF_SCHEMA = z.object({
  name: z.string().min(1).max(256),
  externalReference: z.string().max(256).nullable().optional(),
});

const SUPPORTING_ASSET_LIST_ROW_SCHEMA = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  name: z.string().nullable(),
  derivedName: z.string().nullable(),
  description: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  exposure: z.enum(['internet_facing', 'internal', 'unknown']),
  categoryId: z.enum(ASSET_CATEGORY_VALUES),
  subcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable(),
  criticality: z.enum(ASSET_CRITICALITY_VALUES),
  firstSeenAt: z.date().nullable(),
  lastSeenAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  owner: z.object({ id: z.uuid().nullable(), name: z.string().nullable() }).nullable(),
  applicableEvidenceCount: z.number().int(),
  sources: z.array(SUPPORTING_ASSET_SOURCE_SCHEMA),
  /** The groups the asset belongs to, whoever asserted the membership, by name. */
  groups: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** Whether the row is mapped into the scope named by `membershipOrganizationId`, `false` without one. */
  mapped: z.boolean(),
  posture: z.number().int().nullable(),
});

/** One finding of a CVE or a technique, on the asset it is found on. */
const AFFECTED_ASSET_ROW_SCHEMA = z.object({
  evidenceId: z.uuid(),
  supportingAssetId: z.uuid(),
  assetName: z.string().nullable(),
  assetDerivedName: z.string().nullable(),
  assetCategoryId: z.enum(ASSET_CATEGORY_VALUES),
  assetCriticality: z.enum(ASSET_CRITICALITY_VALUES),
  /** Null when no history row was ever written, which reads as applicable. */
  currentState: z.enum(EVIDENCE_STATES).nullable(),
  stateChangedAt: z.date().nullable(),
  stateReason: z.string().nullable(),
  stateOrigin: z.enum(EVIDENCE_HISTORY_ORIGINS).nullable(),
  dismissalType: z.enum(DISMISSAL_TYPE_VALUES).nullable(),
});

const TECHNIQUE_AFFECTED_ASSET_ROW_SCHEMA = AFFECTED_ASSET_ROW_SCHEMA.extend({
  expectationType: z.enum(EXPECTATION_TYPE_VALUES).nullable(),
  securityPlatformType: z.string().nullable(),
});

const EVIDENCE_ACTIVITY_OUTPUT = z.array(z.object({ day: z.iso.date(), count: z.number().int() })).max(EVIDENCE_ACTIVITY_DAYS);

export const supportingAssetsRouter = (procedure: TenantProcedure) => router({
  createSupportingAsset: procedure
    .input(z.object({
      id: z.uuid(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      ownerId: z.uuid().nullable().optional(),
      /** The owner as text (an XTM One push): resolved to a member of the tenant, kept as `linkedPerson`. */
      ownerName: z.string().nullable().optional(),
      exposure: z.enum(['internet_facing', 'internal', 'unknown']),
      categoryId: z.enum(ASSET_CATEGORY_VALUES),
      subcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable().optional(),
      criticality: z.enum(ASSET_CRITICALITY_VALUES).optional(),
      url: z.string().nullable().optional(),
      linkedPerson: z.string().nullable().optional(),
      properties: MANUAL_ASSET_PROPERTIES_SCHEMA.optional(),
      tagNames: z.array(z.string()).optional(),
      /** The groups the caller puts the asset in, by name and optional external reference; replaces the caller's own memberships. */
      groups: z.array(ASSET_GROUP_REF_SCHEMA).optional(),
    }).extend(estateInput.shape))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { organizationId, ...values } = input;
      const svc = services.withOrigin(origin);
      const mapIntoOrganizationId = await resolveMappedOrganizationId(svc, organizationId);
      return withBadRequestOn(InvalidAssetClassificationError, () =>
        svc.supportingAssets.createSupportingAsset({ ...values, mapIntoOrganizationId }));
    }),
  updateSupportingAsset: procedure
    .input(z.object({
      id: z.uuid(),
      name: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      ownerId: z.uuid().nullable().optional(),
      /** The owner as text (an XTM One push): resolved to a member of the tenant, kept as `linkedPerson`. */
      ownerName: z.string().nullable().optional(),
      exposure: z.enum(['internet_facing', 'internal', 'unknown']).optional(),
      categoryId: z.enum(ASSET_CATEGORY_VALUES).optional(),
      subcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable().optional(),
      criticality: z.enum(ASSET_CRITICALITY_VALUES).optional(),
      url: z.string().nullable().optional(),
      linkedPerson: z.string().nullable().optional(),
      properties: MANUAL_ASSET_PROPERTIES_SCHEMA.optional(),
      tagNames: z.array(z.string()).optional(),
      /** The groups the caller puts the asset in, by name and optional external reference; replaces the caller's own memberships. */
      groups: z.array(ASSET_GROUP_REF_SCHEMA).optional(),
    }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { id, ...values } = input;
      return withNotFoundOn(SupportingAssetNotFoundError, () => withBadRequestOn(InvalidAssetClassificationError, () =>
        services.withOrigin(origin).supportingAssets.updateSupportingAsset(id, values)));
    }),
  deleteSupportingAssets: procedure
    .input(z.array(z.uuid()))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      const deleted = await svc.supportingAssets.deleteSupportingAssets(input);
      return deleted;
    }),
  getSupportingAsset: procedure
    .input(z.object({ id: z.uuid() }))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .supportingAssets.getSupportingAsset(input.id)),
  /**
   * The asset's OpenAEV test results as the OpenAEV sync stored them: the OpenAEV findings whose
   * latest test held (`success`) and whose latest test found the asset exposed (`failed`); `null`
   * while no OpenAEV test spoke about the asset. Read under the caller's tenant isolation and never
   * live from OpenAEV: a user-facing procedure never sends the deployment's connector token, so a
   * user sees only what the sync brought into this tenant (CTEM data segregation, opencrq #24).
   */
  getOpenaevPosture: procedure
    .input(z.object({ supportingAssetId: z.uuid() }))
    .output(z.object({ success: z.number().int(), failed: z.number().int() }).nullable())
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin).openaevConnector.getStoredPosture(input.supportingAssetId)),
  getSupportingAssetRelationGraph: procedure
    .input(z.object({
      supportingAssetId: z.uuid(),
      depth: z.number().int().min(1).max(DEPENDENCY_GRAPH_MAX_DEPTH).default(1),
    }))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .assetDependencies.getSupportingAssetRelationGraph(input.supportingAssetId, input.depth)),

  /** Server-paged, searched and source-filtered — the contract `findingScore.listScoredFindings` already uses. */
  listSupportingAssets: procedure
    .input(pagedInput(ASSET_SORT_KEYS).extend(estateInput.shape).extend({
      search: z.string().nullable().default(null),
      // 'user' names an asset with no connector observation, not a connector: a real sentinel, not
      // a hole in the vocabulary.
      source: z.enum([...INTEGRATION_SOURCES, 'user']).nullable().default(null),
      categoryId: z.enum(ASSET_CATEGORY_VALUES).nullable().default(null),
      /** `except` is what brings the machines back once the identities have buried them. */
      categoryMode: z.enum(['only', 'except']).default('only'),
      /** The assets of one group only, whoever asserted the membership. */
      groupId: z.uuid().nullable().default(null),
      /** Never a narrowing: the scope each row reports its membership of, and what the `mapped` sort raises. */
      membershipOrganizationId: z.uuid().nullable().default(null),
    }))
    .output(pagedOutput(SUPPORTING_ASSET_LIST_ROW_SCHEMA).extend({
      /** Every observation behind the matching assets — never just the current page's own. */
      totalObservations: z.number().int(),
      /** The estate the page is drawn from, before the search, the source and the category filters narrow it. */
      estateTotal: z.number().int(),
    }))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.supportingAssets.listSupportingAssets({
        page: input.page,
        limit: input.limit,
        search: input.search,
        source: input.source,
        categoryId: input.categoryId,
        categoryMode: input.categoryMode,
        groupId: input.groupId,
        mappedToOrganizationId: await resolveMappedOrganizationId(svc, input.organizationId),
        membershipOrganizationId: input.membershipOrganizationId,
        sortBy: input.sortBy ?? 'name',
        sortDesc: input.sortDesc,
      });
    }),

  /** Every source that has written an asset in the estate the page reads, with its own count — never a hardcoded connector list. */
  // bounded-by: INTEGRATION_SOURCES, one row per connector plus one for assets no connector wrote
  getAssetCountsBySource: procedure
    .input(estateInput)
    .output(z.array(z.object({ source: z.string(), assetCount: z.number().int() })))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.supportingAssets.getAssetCountsBySource(await resolveMappedOrganizationId(svc, input.organizationId));
    }),

  /** The tenant's asset groups with their distinct asset count, for the group filter and column. */
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's groups (users, XTM One, the OpenAEV sync)
  listAssetGroups: procedure
    .output(z.array(z.object({
      id: z.uuid(), name: z.string(), description: z.string().nullable(), externalReference: z.string().nullable(), fromConnector: z.boolean(), assetCount: z.number().int(),
    })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin).supportingAssets.listAssetGroups()),

  /** The tenant's whole tag vocabulary, for a tag picker to offer — not just what one asset already carries. */
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's tags, written by users and the OpenAEV sync
  listTags: procedure
    .output(z.array(z.object({ id: z.uuid(), name: z.string(), color: z.string().nullable() })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin).supportingAssets.listTags()),

  /** Every tag of the tenant, merged ones included, for the tag management page. */
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's tags, merged ones included
  listManagedTags: procedure
    .output(z.array(z.object({
      id: z.uuid(),
      name: z.string(),
      color: z.string().nullable(),
      mergedIntoTagId: z.uuid().nullable(),
      mergedAt: z.date().nullable(),
      assetCount: z.number().int(),
      sources: z.array(z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('manual') }),
        z.object({ kind: z.literal('xtm_one') }),
        z.object({ kind: z.literal('connector'), source: z.enum(INTEGRATION_SOURCES), reportedName: z.string() }),
      ])),
    })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin).supportingAssets.listManagedTags()),

  renameTag: procedure
    .input(z.object({ tagId: z.uuid(), name: z.string().trim().min(1) }))
    .mutation(({ input, ctx: { services, origin } }) => withNotFoundOn(TagNotFoundError, () =>
      withConflictOn(TagNameTakenError, () =>
        services.withOrigin(origin).supportingAssets.renameTag(input.tagId, input.name)))),

  mergeTag: procedure
    .input(z.object({ tagId: z.uuid(), targetTagId: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => withNotFoundOn(TagNotFoundError, () =>
      withBadRequestOn(TagMergeRefusedError, () =>
        services.withOrigin(origin).supportingAssets.mergeTag(input.tagId, input.targetTagId)))),

  unmergeTag: procedure
    .input(z.object({ tagId: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => withNotFoundOn(TagNotFoundError, () =>
      withBadRequestOn(TagMergeRefusedError, () =>
        services.withOrigin(origin).supportingAssets.unmergeTag(input.tagId)))),

  deleteTag: procedure
    .input(z.object({ tagId: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => withNotFoundOn(TagNotFoundError, () =>
      services.withOrigin(origin).supportingAssets.deleteTag(input.tagId))),

  /** Clears every hand-set value on the asset and re-derives it from its observations. */
  resyncSupportingAssetWithConnectors: procedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      await svc.supportingAssets.resyncSupportingAssetWithConnectors(input.id);
      await requestFindingScoreRecompute(svc, origin, origin.tenantId);
    }),

  createAssetEvidence: procedure
    .input(z.object({
      supportingAssetId: z.uuid(),
      cveId: z.uuid(),
    }))
    .mutation(({ input, ctx: { services, origin, user } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const svc = services.withOrigin(origin);
      return withNotFoundOn(SupportingAssetNotFoundError, () => withNotFoundOn(CveNotFoundError, () =>
        withConflictOn(EvidenceAlreadyExistsError, async () => {
          const created = await svc.supportingAssets.createEvidence({
            id: uuidv7(),
            supportingAssetId: input.supportingAssetId,
            cveId: input.cveId,
            mitreTechniqueId: null,
            expectationType: null,
            userId: user.id,
            changedByUserId: user.id,
          });
          return created;
        })));
    }),

  deleteAssetEvidence: procedure
    .input(z.object({ evidenceId: z.uuid() }))
    .mutation(({ input, ctx: { services, origin, user } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return withConflictOn(ConnectorBackedEvidenceError, () =>
        services.withOrigin(origin).supportingAssets.deleteEvidence({ evidenceId: input.evidenceId }));
    }),

  updateEvidenceState: procedure
    .input(z.discriminatedUnion('state', [
      z.object({ evidenceId: z.uuid(), state: z.literal('applicable') }),
      z.object({
        evidenceId: z.uuid(),
        state: z.literal('dismissed'),
        dismissalType: z.enum(DISMISSAL_TYPE_VALUES),
        reasonCode: z.enum(DISMISSAL_REASON_CODE_VALUES),
        reason: z.string().trim().min(1).max(2000),
      }),
    ]))
    .mutation(async ({ input, ctx: { services, origin, user } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const svc = services.withOrigin(origin);
      if (input.state === 'dismissed') {
        await svc.supportingAssets.dismissEvidence({
          evidenceId: input.evidenceId,
          dismissalType: input.dismissalType,
          reasonCode: input.reasonCode,
          reason: input.reason,
          changedByUserId: user.id,
        });
        return;
      }
      await svc.supportingAssets.markEvidenceApplicable({
        evidenceId: input.evidenceId,
        changedByUserId: user.id,
      });
    }),
  resetEvidenceState: procedure
    .input(z.object({ evidenceId: z.uuid() }))
    .mutation(({ input, ctx: { services, origin, user } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return services.withOrigin(origin).supportingAssets.resetEvidenceState({
        evidenceId: input.evidenceId,
        changedByUserId: user.id,
      });
    }),

  getEvidenceDetail: procedure
    .input(z.object({ evidenceId: z.uuid() }))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).supportingAssets.getEvidenceDetail(input.evidenceId)),

  // bounded-by: the ATT&CK catalogue, each technique once whatever number of results it has
  getApplicableTechniquesForAsset: procedure
    .input(z.object({ assetId: z.uuid() }))
    .output(z.array(z.object({ id: z.uuid(), externalId: z.string(), name: z.string() })))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).supportingAssets.getApplicableTechniquesForAsset(input.assetId)),

  // bounded-by: EVIDENCE_ACTIVITY_DAYS, one point per day the heatmap draws
  getEvidenceActivityForAsset: procedure
    .input(z.object({ assetId: z.uuid(), timeZone: TIME_ZONE_INPUT }))
    .output(EVIDENCE_ACTIVITY_OUTPUT)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .supportingAssets.getEvidenceActivity({ supportingAssetId: input.assetId }, input.timeZone)),

  // bounded-by: EVIDENCE_ACTIVITY_DAYS, one point per day the heatmap draws
  getEvidenceActivityForCve: procedure
    .input(estateInput.extend({ cveId: z.string().min(1), timeZone: TIME_ZONE_INPUT }))
    .output(EVIDENCE_ACTIVITY_OUTPUT)
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.supportingAssets.getEvidenceActivity(
        { cveId: input.cveId },
        input.timeZone,
        await resolveMappedOrganizationId(svc, input.organizationId),
      );
    }),

  // bounded-by: EVIDENCE_ACTIVITY_DAYS, one point per day the heatmap draws
  getEvidenceActivityForTechnique: procedure
    .input(z.object({ mitreTechniqueId: z.uuid(), timeZone: TIME_ZONE_INPUT }))
    .output(EVIDENCE_ACTIVITY_OUTPUT)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .supportingAssets.getEvidenceActivity({ mitreTechniqueId: input.mitreTechniqueId }, input.timeZone)),

  getEvidencesForCve: procedure
    .input(pagedInput(CVE_AFFECTED_ASSET_SORT_KEYS).extend({ cveId: z.string().min(1) }))
    .output(pagedOutput(AFFECTED_ASSET_ROW_SCHEMA))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .supportingAssets.listAffectedAssets({
        flaw: { cveId: input.cveId },
        page: input.page,
        limit: input.limit,
        sortBy: input.sortBy ?? 'assetName',
        sortDesc: input.sortDesc,
      })),

  getEvidencesForTechnique: procedure
    .input(pagedInput(TECHNIQUE_AFFECTED_ASSET_SORT_KEYS).extend({ mitreTechniqueId: z.uuid() }))
    .output(pagedOutput(TECHNIQUE_AFFECTED_ASSET_ROW_SCHEMA))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .supportingAssets.listAffectedAssets({
        flaw: { mitreTechniqueId: input.mitreTechniqueId },
        page: input.page,
        limit: input.limit,
        sortBy: input.sortBy ?? 'assetName',
        sortDesc: input.sortDesc,
      })),

  // bounded-by: one category's ATT&CK techniques, seeded per tenant with no write path
  getTechniquesByCategory: procedure
    .input(z.object({ categoryId: z.enum(ASSET_CATEGORY_VALUES) }))
    .output(z.array(z.object({ id: z.string(), externalId: z.string(), name: z.string(), isSubtechnique: z.boolean() })))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).attackSurfaces.getApplicableTechniques(input.categoryId)),

  // bounded-by: ASSET_CATEGORY_VALUES, one count per category
  getTechniqueCountPerCategory: procedure
    .output(z.array(z.object({ categoryId: z.enum(ASSET_CATEGORY_VALUES), techniqueCount: z.number().int() })))
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).attackSurfaces.getApplicableTechniqueCountPerCategory()),

  getProtectingControls: procedure
    .input(z.object({ supportingAssetId: z.uuid(), organizationId: z.uuid().nullish() }))
    .query(({ input, ctx: { services, origin } }) => withNotFoundOn(SupportingAssetNotFoundError, () => withNotFoundOn(RiskScopeNotFoundError, () =>
      services.withOrigin(origin).controlValidation.getAssetProtectingControls(input.supportingAssetId, input.organizationId)))),

  // bounded-by: ASSET_SUBCATEGORY_VALUES, plus one row per category for assets with no subcategory
  getAssetCountBySubcategory: procedure
    .input(estateInput)
    .output(z.array(z.object({
      categoryId: z.enum(ASSET_CATEGORY_VALUES),
      subcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable(),
      assetCount: z.number().int(),
    })))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      return svc.supportingAssets.getAssetCountBySubcategory(await resolveMappedOrganizationId(svc, input.organizationId));
    }),

});
