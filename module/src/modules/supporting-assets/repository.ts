import { and, arrayOverlaps, asc, count, countDistinct, desc, eq, getTableName, gte, inArray, isNotNull, isNull, ne, notExists, notInArray, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { unionAll } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DependencyCandidateRelation } from '../asset-dependencies/constants';
import type { AffectedAssetsFlaw, AffectedAssetSortKey, AssetCategory, AssetManualAttribute, AssetRelationKind, EvidenceActivityScope } from './constants';
import type { ApplicableSpan } from './evidence-activity';
import type { ReportedSoftware } from './types';
import type { OwnerCandidate } from './owner-resolution';
import type { AssetSortKey, SupportingAssetExposure } from './schema';
import type { RepositoryContext } from '../../registry';
import { LATERAL_ON } from '../../db/lateral';
import { diffRows } from '../../db/row-diff';
import { inUuids } from '../../db/uuid-array';
import { foldedLike, orderByFolded } from '../../db/fold-text';
import { updatedAtOnDataChange, valuesChange } from '../../db/write-guards';
import { isIntegrationSource } from '../integration-settings/schema';
import { defineRepository } from '../../registry';
import { estateFilter, estateOfMappedScope } from '../organizations/estate-filter';
import { enabledIdentitiesOf } from './enabled-identities';
import { findingLockOrder } from './finding-lock-order';
import { historyRowEnteredAt, latestEvidenceState } from './latest-evidence-state';
import { ASSET_CRITICALITY_SEVERITY, DEFAULT_EVIDENCE_STATE } from './constants';
import {
  ASSET_EVIDENCE_KEY,
  assetEnumerations,
  assetEvidence,
  assetEvidenceHistory,
  assetEvidenceSources,
  assetEvidenceSourceSoftware,
  assetEvidenceVerdicts,
  assetGroupMembers,
  assetGroups,
  supportingAssetAiTargetProperties,
  supportingAssetCriticalityLifts,
  supportingAssetIdentityProperties,
  supportingAssetMachineProperties,
  supportingAssetManualValues,
  supportingAssetRelations,
  supportingAssets,
  supportingAssetSources,
  supportingAssetTags,
  tags,
  tagSources,
} from './schema';

/**
 * Criticality and exposure are ordinal vocabularies held in text columns, so ordering on the column
 * itself sorts them alphabetically — which put `unknown` ahead of `very_high`.
 * `ASSET_CRITICALITY_SEVERITY` and this rank them instead, least first, matching the order OpenAEV
 * declares its own `AssetCriticality` in. Both are
 * exhaustive, so a band added to either vocabulary stops compiling until it is placed on the ladder.
 */
const EXPOSURE_RANK: Record<SupportingAssetExposure, number> = {
  unknown: 0, internal: 1, internet_facing: 2,
};

const rankOf = (column: PgColumn, ranks: Record<string, number>): SQL =>
  sql`case ${column} ${sql.join(Object.entries(ranks).map(([value, rank]) => sql`when ${value} then ${rank}`), sql` `)} else -1 end`;

/** Read per row of `views.supportingAssets`: the asset's findings whose state is applicable. */
const applicableEvidenceCount = (views: RepositoryContext['views']) => sql<number>`(
  select count(*)::int
  from ${views.assetEvidence}
  where ${views.assetEvidence.supportingAssetId} = ${views.supportingAssets.id}
    and ${views.assetEvidence.currentState} = ${DEFAULT_EVIDENCE_STATE}
)`;

/**
 * A CVE is resolved through the tenant's own catalogue row, whose id the findings carry. Compared as
 * a scalar rather than `IN (subquery)`: the lookup then becomes a parameter, and the stored-state
 * indexes serve the order of a page instead of the planner sorting every finding of the CVE.
 */
const affectedAssetsOfFlaw = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, flaw: AffectedAssetsFlaw) => ('cveId' in flaw
  ? eq(views.assetEvidence.cveId, db.select({ id: views.cve.id }).from(views.cve).where(eq(views.cve.cveId, flaw.cveId)).limit(1))
  : eq(views.assetEvidence.mitreTechniqueId, flaw.mitreTechniqueId));

/**
 * A tag with the colour its newest origin reporting one gives it, merged tags included. The colour
 * tie-break is shared by every reader of the vocabulary, so it is written once.
 */
const selectTagVocabulary = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, where?: SQL) =>
  db
    .selectDistinctOn([views.tags.id], {
      id: views.tags.id,
      name: views.tags.name,
      color: views.tagSources.reportedColor,
      mergedIntoTagId: views.tags.mergedIntoTagId,
      mergedAt: views.tags.mergedAt,
    })
    .from(views.tags)
    .leftJoin(views.tagSources, eq(views.tagSources.tagId, views.tags.id))
    .where(where)
    .orderBy(
      views.tags.id,
      sql`${views.tagSources.reportedColor} is null`,
      desc(views.tagSources.id),
    );

/**
 * Row-locks the tags in id order, so two transactions touching overlapping tags queue instead of
 * deadlocking. The lock lives as long as the enclosing transaction.
 */
const lockTagRows = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, tagIds: Array<string>) =>
  db.select({ id: views.tags.id })
    .from(views.tags)
    .where(inArray(views.tags.id, tagIds))
    .orderBy(views.tags.id)
    .for('update');

/** A reprojection statement carries one CASE branch per row and column, so it is chunked small. */
const REPROJECT_CHUNK_SIZE = 500;
/** Six columns a row: well under the 65,535 bind parameters a statement takes. */
const SOFTWARE_INSERT_CHUNK = 5000;

/**
 * The key `attribute-resolution.ts` ranks sources of one authority on: the later of the source's
 * last change and its last sighting of the asset, so a source that stopped reporting loses to one
 * still reporting. A source reporting no sighting (an OpenAEV endpoint without an agent) is ranked
 * on its last change alone. Both are bounded by the database clock, `last_seen_at` being
 * clamped when written (`upsertSupportingAssetSourceBatch`).
 */
const sourceLastActivityAt = ({ views }: Pick<RepositoryContext, 'views'>) =>
  sql<Date>`greatest(${views.supportingAssetSources.updatedAt}, ${views.supportingAssetSources.lastSeenAt})`
    .mapWith(views.supportingAssetSources.updatedAt);

/**
 * A property block is one more value its source reports: writing one (new or changed) moves the
 * source's `updated_at`, which `sourceLastActivityAt` ranks the sources on.
 */
const markSourcesChanged = async ({ db }: Pick<RepositoryContext, 'db'>, written: Array<{ supportingAssetSourceId: string }>) => {
  if (written.length === 0) {
    return;
  }
  await db.update(supportingAssetSources)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    .set({ updatedAt: sql`now()` as unknown as Date })
    .where(and(inArray(supportingAssetSources.id, written.map((w) => w.supportingAssetSourceId)), ne(supportingAssetSources.updatedAt, sql`now()`)));
};

/**
 * The observation shape the matcher and the attribute resolution both read. The per-family
 * property tables are left-joined in and nested under their own key — Drizzle nulls out the whole
 * nested object when the join finds no row, rather than each of its columns, which is exactly the
 * "no properties" case. `toAssetObservation` (service.ts) is the other half that turns this into
 * the discriminated `properties` block, and the two must agree on the shape below.
 * `assetCategoryId` is the asset's current category, not the source's: the matcher reads it to
 * leave out a source reporting another family than the one the asset now belongs to.
 */
const selectAssetObservations = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>) =>
  db
    .select({
      id: views.supportingAssetSources.id,
      supportingAssetId: views.supportingAssetSources.supportingAssetId,
      assetCategoryId: views.supportingAssets.categoryId,
      connectorId: views.supportingAssetSources.connectorId,
      origin: views.supportingAssetSources.origin,
      source: views.integrationSettings.source,
      sourceAssetId: views.supportingAssetSources.sourceAssetId,
      reportedName: views.supportingAssetSources.reportedName,
      reportedCategoryId: views.supportingAssetSources.reportedCategoryId,
      reportedSubcategoryId: views.supportingAssetSources.reportedSubcategoryId,
      reportedDescription: views.supportingAssetSources.reportedDescription,
      reportedExposure: views.supportingAssetSources.reportedExposure,
      reportedCriticality: views.supportingAssetSources.reportedCriticality,
      externalReference: views.supportingAssetSources.externalReference,
      reportedUrl: views.supportingAssetSources.reportedUrl,
      reportedLinkedPerson: views.supportingAssetSources.reportedLinkedPerson,
      firstSeenAt: views.supportingAssetSources.firstSeenAt,
      lastSeenAt: views.supportingAssetSources.lastSeenAt,
      sourceLastActivityAt: sourceLastActivityAt({ views }),
      machineProperties: {
        // `tenantId` (never null) leads the group: Drizzle decides whether a left-joined nested
        // selection is "no matching row" from its *first* column alone, and every other column
        // here can be null on a genuine row (e.g. hostname unset) without meaning that.
        tenantId: views.supportingAssetMachineProperties.tenantId,
        hostname: views.supportingAssetMachineProperties.hostname,
        ipAddresses: views.supportingAssetMachineProperties.ipAddresses,
        macAddresses: views.supportingAssetMachineProperties.macAddresses,
        seenIp: views.supportingAssetMachineProperties.seenIp,
        hardwareUuid: views.supportingAssetMachineProperties.hardwareUuid,
        directoryDeviceId: views.supportingAssetMachineProperties.directoryDeviceId,
        cloudVmId: views.supportingAssetMachineProperties.cloudVmId,
        cloudResourceId: views.supportingAssetMachineProperties.cloudResourceId,
        cloudProvider: views.supportingAssetMachineProperties.cloudProvider,
        cloudNativeType: views.supportingAssetMachineProperties.cloudNativeType,
        cloudRegion: views.supportingAssetMachineProperties.cloudRegion,
        platform: views.supportingAssetMachineProperties.platform,
        arch: views.supportingAssetMachineProperties.arch,
        vendor: views.supportingAssetMachineProperties.vendor,
        model: views.supportingAssetMachineProperties.model,
        operatingSystem: views.supportingAssetMachineProperties.operatingSystem,
        osVersion: views.supportingAssetMachineProperties.osVersion,
        isEol: views.supportingAssetMachineProperties.isEol,
        agentExternalReference: views.supportingAssetMachineProperties.agentExternalReference,
        agentExecutorType: views.supportingAssetMachineProperties.agentExecutorType,
      },
      aiTargetProperties: {
        // Same "first column leads" rule as `machineProperties` above.
        tenantId: views.supportingAssetAiTargetProperties.tenantId,
        provider: views.supportingAssetAiTargetProperties.provider,
        endpointUrl: views.supportingAssetAiTargetProperties.endpointUrl,
        normalizedEndpointUrl: views.supportingAssetAiTargetProperties.normalizedEndpointUrl,
        model: views.supportingAssetAiTargetProperties.model,
        modality: views.supportingAssetAiTargetProperties.modality,
        systemPrompt: views.supportingAssetAiTargetProperties.systemPrompt,
      },
      identityProperties: {
        // Same "first column leads" rule as `machineProperties` above.
        tenantId: views.supportingAssetIdentityProperties.tenantId,
        directoryObjectId: views.supportingAssetIdentityProperties.directoryObjectId,
        cloudSid: views.supportingAssetIdentityProperties.cloudSid,
        onPremSid: views.supportingAssetIdentityProperties.onPremSid,
        userPrincipalName: views.supportingAssetIdentityProperties.userPrincipalName,
        accountDomain: views.supportingAssetIdentityProperties.accountDomain,
        accountName: views.supportingAssetIdentityProperties.accountName,
        directoryType: views.supportingAssetIdentityProperties.directoryType,
        identityProvider: views.supportingAssetIdentityProperties.identityProvider,
        department: views.supportingAssetIdentityProperties.department,
        jobTitle: views.supportingAssetIdentityProperties.jobTitle,
        isEnabled: views.supportingAssetIdentityProperties.isEnabled,
        assignedRoles: views.supportingAssetIdentityProperties.assignedRoles,
        privilegedPimRoles: views.supportingAssetIdentityProperties.privilegedPimRoles,
      },
    })
    .from(views.supportingAssetSources)
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.supportingAssetSources.supportingAssetId))
    .leftJoin(views.integrationSettings, eq(views.supportingAssetSources.connectorId, views.integrationSettings.id))
    .leftJoin(views.supportingAssetMachineProperties, eq(views.supportingAssetMachineProperties.supportingAssetSourceId, views.supportingAssetSources.id))
    .leftJoin(views.supportingAssetAiTargetProperties, eq(views.supportingAssetAiTargetProperties.supportingAssetSourceId, views.supportingAssetSources.id))
    .leftJoin(views.supportingAssetIdentityProperties, eq(views.supportingAssetIdentityProperties.supportingAssetSourceId, views.supportingAssetSources.id));

/** The sentinel the `source` filter takes for an asset with no observation at all. */
const NO_SOURCE = 'user';

/**
 * An asset no connector observes — a manual observation does not count, so an asset a person only
 * typed properties onto still reads as `user` here, same as one with no source row at all.
 * Correlated on the row under test rather than tested against the set of observed ids, because a
 * `NOT IN` over the secured view cannot become an anti-join: the view hides the column's
 * `NOT NULL`, so Postgres keeps a per-row rescan of the whole set.
 */
const buildNoObservationFilter = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>) =>
  notExists(
    db.select({ observed: sql`1` })
      .from(views.supportingAssetSources)
      .where(and(
        eq(views.supportingAssetSources.supportingAssetId, views.supportingAssets.id),
        eq(views.supportingAssetSources.origin, 'connector'),
      )),
  );

/**
 * The `source` select's own filter, shared by the page query, its count and the tenant-wide
 * observation count. `user` is checked before `isIntegrationSource`, which otherwise silently
 * drops any value it does not recognise — `user` names no connector and would vanish there.
 */
const buildAssetSourceFilter = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, source: string | null) => {
  if (source === NO_SOURCE) {
    return buildNoObservationFilter({ db, views });
  }
  if (source === null || !isIntegrationSource(source)) {
    return undefined;
  }
  const sourceFilterSq = db.select({ supportingAssetId: views.supportingAssetSources.supportingAssetId })
    .from(views.supportingAssetSources)
    .innerJoin(views.integrationSettings, eq(views.supportingAssetSources.connectorId, views.integrationSettings.id))
    .where(eq(views.integrationSettings.source, source));
  return inArray(views.supportingAssets.id, sourceFilterSq);
};

/** `null` for a scope measured over the whole tenant estate: the caller resolves the mode. */
const buildEstateFilter = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  mappedToOrganizationId: string | null,
  assetIdColumn: PgColumn = views.supportingAssets.id,
) => estateFilter({ db, views }, estateOfMappedScope(mappedToOrganizationId), assetIdColumn);

/**
 * Server-side, not a filter over the page already fetched: thousands of identities entering an
 * estate of a few hundred machines is what makes the list unreadable, and a client-side filter
 * would still have paged through them to get there.
 *
 * `except` is what a reader wanting the machines back reaches for, and it is not the same as
 * picking every other category: a category this list does not yet know would drop out of an
 * enumerated filter and stays in an excluding one.
 */
const buildAssetCategoryFilter = (
  { views }: Pick<RepositoryContext, 'views'>,
  categoryId: AssetCategory | null,
  categoryMode: 'only' | 'except',
) => {
  if (categoryId === null) {
    return undefined;
  }
  return categoryMode === 'except'
    ? ne(views.supportingAssets.categoryId, categoryId)
    : eq(views.supportingAssets.categoryId, categoryId);
};

/** The asset a dependency candidate list is drawn for, and whether it keeps only the assets already linked. */
export interface DependencyCandidateScope {
  relation: DependencyCandidateRelation,
  assetId: string,
  linkedOnly: boolean,
}

/** The supporting assets already linked to the scope's asset through its relation. */
const selectDependencyLinkedIds = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  dependency: DependencyCandidateScope,
) => {
  const s2s = views.supportToSupportLinks;
  switch (dependency.relation) {
    case 'dependsOn':
      return db.select({ id: s2s.providerAssetId }).from(s2s).where(eq(s2s.dependentAssetId, dependency.assetId));
    case 'providesTo':
      return db.select({ id: s2s.dependentAssetId }).from(s2s).where(eq(s2s.providerAssetId, dependency.assetId));
    case 'supportsPrimary':
      return db.select({ id: views.supportToPrimaryLinks.supportingAssetId })
        .from(views.supportToPrimaryLinks)
        .where(eq(views.supportToPrimaryLinks.primaryAssetId, dependency.assetId));
  }
};

/**
 * Past this many links, binding them as a list costs more than sorting the whole tenant, and
 * Postgres refuses a statement of more than 65,535 parameters.
 */
const LINKED_FIRST_MAX_BOUND_LINKS = 2_000;

/** Whether the row is already linked to the scope's asset through its relation, as a test on the row. */
const buildDependencyMembership = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  dependency: DependencyCandidateScope,
) => inArray(views.supportingAssets.id, selectDependencyLinkedIds({ db, views }, dependency));

/** A supporting asset is never offered as its own provider or dependent, which the service refuses anyway. */
const buildDependencyCandidateFilters = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  dependency: DependencyCandidateScope | null,
) => (dependency === null ? [] : [
  dependency.relation === 'supportsPrimary' ? undefined : ne(views.supportingAssets.id, dependency.assetId),
  dependency.linkedOnly ? buildDependencyMembership({ db, views }, dependency) : undefined,
]);

/** The assets of one group, whoever asserted the membership (a person, XTM One or a connector). */
const buildAssetGroupFilter = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  groupId: string | null,
) => (groupId === null
  ? undefined
  : inArray(
    views.supportingAssets.id,
    db.select({ id: views.assetGroupMembers.supportingAssetId })
      .from(views.assetGroupMembers)
      .where(eq(views.assetGroupMembers.assetGroupId, groupId)),
  ));

/** The asset list's own filters, shared by the page query, its count and the observation count. */
const buildAssetListFilters = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  params: {
    search: string | null,
    source: string | null,
    categoryId?: AssetCategory | null,
    categoryMode?: 'only' | 'except',
    groupId?: string | null,
    mappedToOrganizationId?: string | null,
    dependency?: DependencyCandidateScope | null,
  },
) => [
  params.search ? foldedLike(views.supportingAssets.displayNameFolded, params.search, 'contains') : undefined,
  buildAssetSourceFilter({ db, views }, params.source),
  buildAssetCategoryFilter({ views }, params.categoryId ?? null, params.categoryMode ?? 'only'),
  buildAssetGroupFilter({ db, views }, params.groupId ?? null),
  buildEstateFilter({ db, views }, params.mappedToOrganizationId ?? null),
  ...buildDependencyCandidateFilters({ db, views }, params.dependency ?? null),
].filter((c) => c !== undefined);

export const supportingAssetsRepository = defineRepository({
  insertSupportingAsset: ({ db }, values: typeof supportingAssets.$inferInsert) =>
    db.insert(supportingAssets).values([values]),
  updateSupportingAsset: ({ db }, id: string, values: Partial<typeof supportingAssets.$inferInsert>) =>
    db.update(supportingAssets).set(values).where(eq(supportingAssets.id, id)),
  deleteSupportingAssets: ({ db }, ids: Array<string>) =>
    db.delete(supportingAssets).where(inArray(supportingAssets.id, ids)),
  isCveVisible: async ({ db, views }, id: string) =>
    (await db.select({ id: views.cve.id }).from(views.cve).where(eq(views.cve.id, id)).limit(1)).length > 0,
  /**
   * The members of the tenant whose email or shown name is `text`, case-insensitively: the owner
   * candidates of a push (`resolveOwner`). The shown name is the tenant's own name for the member,
   * else the account's.
   */
  findOwnerCandidates: async ({ db, views }, tenantId: string, text: string): Promise<Array<OwnerCandidate>> => {
    const wanted = text.trim().toLowerCase();
    if (!wanted) {
      return [];
    }
    const shownName = sql<string | null>`coalesce(${views.tenantUsers.name}, ${views.users.name})`;
    return db.select({ id: views.users.id, email: views.users.email, name: shownName })
      .from(views.tenantUsers)
      .innerJoin(views.users, eq(views.tenantUsers.userId, views.users.id))
      .where(and(
        eq(views.tenantUsers.tenantId, tenantId),
        or(eq(sql`lower(${views.users.email})`, wanted), eq(sql`lower(trim(${shownName}))`, wanted)),
      ));
  },
  /** The assets reported under these hostnames (lower-cased at ingestion), for the cross-product lookup. */
  findByHostnames: async ({ db, views }, hostnames: Array<string>) => {
    if (hostnames.length === 0) {
      return [];
    }
    return db.selectDistinct({
      id: views.supportingAssets.id,
      name: views.supportingAssets.name,
      hostname: views.supportingAssetMachineProperties.hostname,
    })
      .from(views.supportingAssetMachineProperties)
      .innerJoin(views.supportingAssetSources, eq(views.supportingAssetSources.id, views.supportingAssetMachineProperties.supportingAssetSourceId))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.supportingAssetSources.supportingAssetId))
      .where(inArray(views.supportingAssetMachineProperties.hostname, hostnames));
  },

  findSupportingAssetById: ({ db, views }, id: string) =>
    db
      .select({
        id: views.supportingAssets.id,
        tenantId: views.supportingAssets.tenantId,
        name: views.supportingAssets.name,
        derivedName: views.supportingAssets.derivedName,
        description: views.supportingAssets.description,
        ownerId: views.supportingAssets.ownerId,
        ownerSource: views.supportingAssets.ownerSource,
        exposure: views.supportingAssets.exposure,
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        criticality: views.supportingAssets.criticality,
        externalReference: views.supportingAssets.externalReference,
        url: views.supportingAssets.url,
        linkedPerson: views.supportingAssets.linkedPerson,
        firstSeenAt: views.supportingAssets.firstSeenAt,
        lastSeenAt: views.supportingAssets.lastSeenAt,
        createdAt: views.supportingAssets.createdAt,
        updatedAt: views.supportingAssets.updatedAt,
        owner: {
          id: views.users.id,
          name: views.users.name,
        },
        applicableEvidenceCount: applicableEvidenceCount(views),
      })
      .from(views.supportingAssets)
      .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
      .where(eq(views.supportingAssets.id, id))
      .limit(1)
      .then((r) => r.at(0) ?? null),
  /**
   * A paged, searchable, filterable read mirroring `findScoredFindingsPage` /
   * `countScoredFindings` in `finding-score/repository.ts`. `search` matches the displayed name
   * (the real one, else the derived one), never an observed name a source reported, case-insensitively.
   */
  findSupportingAssetsPage: async (
    { db, views },
    params: {
      search: string | null,
      source: string | null,
      categoryId?: AssetCategory | null,
      categoryMode?: 'only' | 'except',
      groupId?: string | null,
      mappedToOrganizationId: string | null,
      membershipOrganizationId: string | null,
      limit: number,
      offset: number,
      sortBy: AssetSortKey,
      sortDesc: boolean,
    },
  ) => {
    const sortColumns: Record<Exclude<AssetSortKey, 'mapped'>, PgColumn | SQL> = {
      name: views.supportingAssets.displayName,
      categoryId: views.supportingAssets.categoryId,
      subcategoryId: views.supportingAssets.subcategoryId,
      exposure: rankOf(views.supportingAssets.exposure, EXPOSURE_RANK),
      criticality: rankOf(views.supportingAssets.criticality, ASSET_CRITICALITY_SEVERITY),
      lastSeenAt: views.supportingAssets.lastSeenAt,
      posture: views.assetPostures.score,
    };
    // Membership of the named scope's mapping, both read on the row and ordered as a boolean, so a
    // picker states and raises what is already mapped without ever holding the mapping's ids.
    const membership = buildEstateFilter({ db, views }, params.membershipOrganizationId);
    const primaryOrder: Array<SQL> = params.sortBy === 'mapped' && membership !== undefined
      ? [sql`(${membership}) ${params.sortDesc ? sql`desc` : sql`asc`}`]
      : (() => {
        const sortKey = params.sortBy === 'mapped' ? 'name' : params.sortBy;
        if (sortKey === 'name') {
          return orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.displayName, params.sortDesc);
        }
        const sortColumn = sortColumns[sortKey];
        return [params.sortDesc ? sql`${sortColumn} desc nulls last` : sql`${sortColumn} asc nulls last`];
      })();

    const whereClauses = buildAssetListFilters({ db, views }, params);
    // Ties broken on the id: equal sort values can otherwise swap between requests.
    const ordering = [
      ...primaryOrder,
      ...(params.sortBy === 'mapped' ? orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.displayName, false) : []),
      asc(views.supportingAssets.id),
    ];

    /*
     * The page is cut on the ordered ids alone, and every per-row aggregate is read back against
     * that handful: a join and a group-by would compute the evidence count for the whole park to
     * serve one page of it.
     */
    const ids = db.select({ id: views.supportingAssets.id }).from(views.supportingAssets).$dynamic();
    const pageIds = (params.sortBy === 'posture'
      ? ids.leftJoin(views.assetPostures, eq(views.assetPostures.supportingAssetId, views.supportingAssets.id))
      : ids)
      .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
      .orderBy(...ordering)
      .limit(params.limit)
      .offset(params.offset)
      .as('page');

    return db
      .select({
        id: views.supportingAssets.id,
        tenantId: views.supportingAssets.tenantId,
        name: views.supportingAssets.name,
        derivedName: views.supportingAssets.derivedName,
        description: views.supportingAssets.description,
        ownerId: views.supportingAssets.ownerId,
        exposure: views.supportingAssets.exposure,
        categoryId: views.supportingAssets.categoryId,
        // What the list's human / non-human mark reads. It costs no extra read: the column is on
        // the row the page already selects.
        subcategoryId: views.supportingAssets.subcategoryId,
        criticality: views.supportingAssets.criticality,
        firstSeenAt: views.supportingAssets.firstSeenAt,
        lastSeenAt: views.supportingAssets.lastSeenAt,
        createdAt: views.supportingAssets.createdAt,
        updatedAt: views.supportingAssets.updatedAt,
        owner: {
          id: views.users.id,
          name: views.users.name,
        },
        applicableEvidenceCount: applicableEvidenceCount(views),
        mapped: membership === undefined ? sql<boolean>`false` : sql<boolean>`(${membership})`,
        posture: views.assetPostures.score,
      })
      .from(views.supportingAssets)
      .innerJoin(pageIds, eq(pageIds.id, views.supportingAssets.id))
      .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
      .leftJoin(views.assetPostures, eq(views.assetPostures.supportingAssetId, views.supportingAssets.id))
      .orderBy(...ordering);
  },
  /**
   * The page a dependency drawer offers for one relation of one asset: the linked rows first, then
   * the others, each in name order, with only the columns the drawer shows.
   *
   * No index serves the linked-first order, so ordering on it sorts every matching asset of the
   * tenant on each page. Up to `LINKED_FIRST_MAX_BOUND_LINKS`, the linked rows are read whole and
   * sliced here, and the others are paged in name order, which `supporting_assets_tenant_display_name_idx`
   * serves. The link ids are bound as a list rather than a subquery: against a subquery the
   * planner scans the whole tenant for the linked rows, or walks the name index testing each row.
   */
  findDependencyCandidatesPage: async (
    { db, views },
    params: {
      search: string | null,
      source: string | null,
      categoryId: AssetCategory | null,
      dependency: DependencyCandidateScope,
      limit: number,
      offset: number,
    },
  ) => {
    const whereClauses = buildAssetListFilters({ db, views }, params);
    const linkMembership = buildDependencyMembership({ db, views }, params.dependency);
    const nameOrder = orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.displayName, false);
    const ordering = [sql`(${linkMembership}) desc`, ...nameOrder, asc(views.supportingAssets.id)];
    const idsInNameOrder = (...clauses: Array<SQL>) => db
      .select({ id: views.supportingAssets.id })
      .from(views.supportingAssets)
      .where(and(...whereClauses, ...clauses))
      .orderBy(...nameOrder, asc(views.supportingAssets.id));

    const pageIds = await (async () => {
      const linkIds = await selectDependencyLinkedIds({ db, views }, params.dependency)
        .limit(LINKED_FIRST_MAX_BOUND_LINKS + 1)
        .then((rows) => rows.map((row) => row.id));
      if (linkIds.length > LINKED_FIRST_MAX_BOUND_LINKS) {
        return db
          .select({ id: views.supportingAssets.id })
          .from(views.supportingAssets)
          .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
          .orderBy(...ordering)
          .limit(params.limit)
          .offset(params.offset)
          .as('page');
      }
      const linkedIds = await idsInNameOrder(inArray(views.supportingAssets.id, linkIds))
        .then((rows) => rows.map((row) => row.id));
      const linkedOnPage = linkedIds.slice(params.offset, params.offset + params.limit);
      const linked = db
        .select({ id: views.supportingAssets.id })
        .from(views.supportingAssets)
        .where(inArray(views.supportingAssets.id, linkedOnPage));
      if (params.dependency.linkedOnly || linkedOnPage.length === params.limit) {
        return linked.as('page');
      }
      const unlinked = idsInNameOrder(notInArray(views.supportingAssets.id, linkIds))
        .limit(params.limit - linkedOnPage.length)
        .offset(Math.max(0, params.offset - linkedIds.length));
      return (linkedOnPage.length === 0 ? unlinked : linked.unionAll(unlinked)).as('page');
    })();

    return db
      .select({
        id: views.supportingAssets.id,
        name: views.supportingAssets.name,
        derivedName: views.supportingAssets.derivedName,
        categoryId: views.supportingAssets.categoryId,
        exposure: views.supportingAssets.exposure,
        criticality: views.supportingAssets.criticality,
      })
      .from(views.supportingAssets)
      .innerJoin(pageIds, eq(pageIds.id, views.supportingAssets.id))
      .orderBy(...ordering);
  },
  countSupportingAssets: async ({ db, views }, params: {
    search: string | null,
    source: string | null,
    categoryId: AssetCategory | null,
    categoryMode: 'only' | 'except',
    groupId?: string | null,
    mappedToOrganizationId: string | null,
    dependency?: DependencyCandidateScope | null,
  }) => {
    const whereClauses = buildAssetListFilters({ db, views }, params);
    const rows = await db
      .select({ value: count() })
      .from(views.supportingAssets)
      .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);
    return rows.at(0)?.value ?? 0;
  },
  /**
   * The connector observation count behind every matching asset, regardless of page: the
   * toolbar's `M observations` must not move when the page changes, and a hand-typed block is no
   * observation.
   */
  countObservationsForFilter: async ({ db, views }, params: { search: string | null, source: string | null, categoryId: AssetCategory | null, categoryMode: 'only' | 'except', groupId?: string | null, mappedToOrganizationId: string | null }) => {
    const whereClauses = buildAssetListFilters({ db, views }, params);
    const matchingAssetIdsSq = db.select({ id: views.supportingAssets.id })
      .from(views.supportingAssets)
      .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);
    const rows = await db
      .select({ value: count() })
      .from(views.supportingAssetSources)
      .where(and(
        inArray(views.supportingAssetSources.supportingAssetId, matchingAssetIdsSq),
        eq(views.supportingAssetSources.origin, 'connector'),
      ));
    return rows.at(0)?.value ?? 0;
  },
  /**
   * Every source that has actually written an asset in the estate the caller resolved, with its
   * own count, never a hardcoded connector list. `user` (assets with no *connector* observation —
   * whether it has none at all, or carries only a manual one) is appended last when any exist; an
   * observation whose connector was later deleted (`connectorId` set to null, `origin` still
   * `connector`) is neither counted here nor as `user`: it is not hand-created, and the connector
   * it named is gone.
   */
  getAssetCountsBySource: async ({ db, views }, mappedToOrganizationId: string | null = null) => {
    const bySource = await db
      .select({
        source: views.integrationSettings.source,
        assetCount: countDistinct(views.supportingAssetSources.supportingAssetId),
      })
      .from(views.supportingAssetSources)
      .innerJoin(views.integrationSettings, eq(views.supportingAssetSources.connectorId, views.integrationSettings.id))
      .where(buildEstateFilter({ db, views }, mappedToOrganizationId, views.supportingAssetSources.supportingAssetId))
      .groupBy(views.integrationSettings.source);

    const userRows = await db
      .select({ value: count() })
      .from(views.supportingAssets)
      .where(and(
        buildNoObservationFilter({ db, views }),
        buildEstateFilter({ db, views }, mappedToOrganizationId),
      ));
    const userCount = userRows.at(0)?.value ?? 0;

    return [
      ...bySource,
      ...(userCount > 0 ? [{ source: NO_SOURCE, assetCount: userCount }] : []),
    ];
  },
  /**
   * One row per reporting source, with its family block, for one asset's detail page: the Sources
   * card and the family-specific property card `resolveAssetProperties` derives from it.
   * `machineProperties`/`aiTargetProperties` follow the same "Drizzle nulls out the whole nested
   * object on a join miss" shape `selectAssetObservations` relies on — `toObservationProperties`
   * (service.ts) is what discriminates them. A list page wants `findSourceSummariesByAssetIds`
   * instead: it reads none of these columns, and joining both property tables for every source of
   * every row on the page is around two dozen columns thrown away per row.
   */
  findSourcesByAssetIds: ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({
        supportingAssetId: views.supportingAssetSources.supportingAssetId,
        connectorId: views.supportingAssetSources.connectorId,
        origin: views.supportingAssetSources.origin,
        source: views.integrationSettings.source,
        sourceAssetId: views.supportingAssetSources.sourceAssetId,
        firstSeenAt: views.supportingAssetSources.firstSeenAt,
        lastSeenAt: views.supportingAssetSources.lastSeenAt,
        sourceLastActivityAt: sourceLastActivityAt({ views }),
        reportedName: views.supportingAssetSources.reportedName,
        reportedDescription: views.supportingAssetSources.reportedDescription,
        reportedCategoryId: views.supportingAssetSources.reportedCategoryId,
        reportedSubcategoryId: views.supportingAssetSources.reportedSubcategoryId,
        reportedExposure: views.supportingAssetSources.reportedExposure,
        reportedCriticality: views.supportingAssetSources.reportedCriticality,
        reportedCriticalityRule: views.supportingAssetSources.reportedCriticalityRule,
        reportedUrl: views.supportingAssetSources.reportedUrl,
        reportedLinkedPerson: views.supportingAssetSources.reportedLinkedPerson,
        machineProperties: {
          tenantId: views.supportingAssetMachineProperties.tenantId,
          hostname: views.supportingAssetMachineProperties.hostname,
          ipAddresses: views.supportingAssetMachineProperties.ipAddresses,
          macAddresses: views.supportingAssetMachineProperties.macAddresses,
          seenIp: views.supportingAssetMachineProperties.seenIp,
          hardwareUuid: views.supportingAssetMachineProperties.hardwareUuid,
          directoryDeviceId: views.supportingAssetMachineProperties.directoryDeviceId,
          cloudVmId: views.supportingAssetMachineProperties.cloudVmId,
          cloudResourceId: views.supportingAssetMachineProperties.cloudResourceId,
          cloudProvider: views.supportingAssetMachineProperties.cloudProvider,
          cloudNativeType: views.supportingAssetMachineProperties.cloudNativeType,
          cloudRegion: views.supportingAssetMachineProperties.cloudRegion,
          platform: views.supportingAssetMachineProperties.platform,
          arch: views.supportingAssetMachineProperties.arch,
          vendor: views.supportingAssetMachineProperties.vendor,
          model: views.supportingAssetMachineProperties.model,
          operatingSystem: views.supportingAssetMachineProperties.operatingSystem,
          osVersion: views.supportingAssetMachineProperties.osVersion,
          isEol: views.supportingAssetMachineProperties.isEol,
          agentExternalReference: views.supportingAssetMachineProperties.agentExternalReference,
          agentExecutorType: views.supportingAssetMachineProperties.agentExecutorType,
        },
        aiTargetProperties: {
          tenantId: views.supportingAssetAiTargetProperties.tenantId,
          provider: views.supportingAssetAiTargetProperties.provider,
          endpointUrl: views.supportingAssetAiTargetProperties.endpointUrl,
          normalizedEndpointUrl: views.supportingAssetAiTargetProperties.normalizedEndpointUrl,
          model: views.supportingAssetAiTargetProperties.model,
          modality: views.supportingAssetAiTargetProperties.modality,
          systemPrompt: views.supportingAssetAiTargetProperties.systemPrompt,
        },
        identityProperties: {
          tenantId: views.supportingAssetIdentityProperties.tenantId,
          directoryObjectId: views.supportingAssetIdentityProperties.directoryObjectId,
          cloudSid: views.supportingAssetIdentityProperties.cloudSid,
          onPremSid: views.supportingAssetIdentityProperties.onPremSid,
          userPrincipalName: views.supportingAssetIdentityProperties.userPrincipalName,
          accountDomain: views.supportingAssetIdentityProperties.accountDomain,
          accountName: views.supportingAssetIdentityProperties.accountName,
          directoryType: views.supportingAssetIdentityProperties.directoryType,
          identityProvider: views.supportingAssetIdentityProperties.identityProvider,
          department: views.supportingAssetIdentityProperties.department,
          jobTitle: views.supportingAssetIdentityProperties.jobTitle,
          isEnabled: views.supportingAssetIdentityProperties.isEnabled,
          assignedRoles: views.supportingAssetIdentityProperties.assignedRoles,
          privilegedPimRoles: views.supportingAssetIdentityProperties.privilegedPimRoles,
        },
      })
      .from(views.supportingAssetSources)
      .leftJoin(views.integrationSettings, eq(views.supportingAssetSources.connectorId, views.integrationSettings.id))
      .leftJoin(views.supportingAssetMachineProperties, eq(views.supportingAssetMachineProperties.supportingAssetSourceId, views.supportingAssetSources.id))
      .leftJoin(views.supportingAssetAiTargetProperties, eq(views.supportingAssetAiTargetProperties.supportingAssetSourceId, views.supportingAssetSources.id))
      .leftJoin(views.supportingAssetIdentityProperties, eq(views.supportingAssetIdentityProperties.supportingAssetSourceId, views.supportingAssetSources.id))
      .where(inArray(views.supportingAssetSources.supportingAssetId, assetIds))
      // Oldest observation first: readers that show a single source must not see it change
      // between two identical requests.
      .orderBy(asc(views.supportingAssetSources.firstSeenAt), asc(views.supportingAssetSources.id));
  },
  /** The same rows without either family block: what a list page's source icon stack reads. */
  findSourceSummariesByAssetIds: ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({
        supportingAssetId: views.supportingAssetSources.supportingAssetId,
        connectorId: views.supportingAssetSources.connectorId,
        source: views.integrationSettings.source,
        sourceAssetId: views.supportingAssetSources.sourceAssetId,
        firstSeenAt: views.supportingAssetSources.firstSeenAt,
        lastSeenAt: views.supportingAssetSources.lastSeenAt,
        reportedName: views.supportingAssetSources.reportedName,
        reportedDescription: views.supportingAssetSources.reportedDescription,
        reportedCategoryId: views.supportingAssetSources.reportedCategoryId,
        reportedSubcategoryId: views.supportingAssetSources.reportedSubcategoryId,
        reportedExposure: views.supportingAssetSources.reportedExposure,
        reportedCriticality: views.supportingAssetSources.reportedCriticality,
      })
      .from(views.supportingAssetSources)
      .leftJoin(views.integrationSettings, eq(views.supportingAssetSources.connectorId, views.integrationSettings.id))
      .where(inArray(views.supportingAssetSources.supportingAssetId, assetIds))
      .orderBy(asc(views.supportingAssetSources.firstSeenAt), asc(views.supportingAssetSources.id));
  },
  /** The asset's one manual observation row, if a person has ever typed a family block onto it. */
  findManualSourceByAssetId: async ({ db, views }, supportingAssetId: string) => {
    const rows = await db
      .select({ id: views.supportingAssetSources.id, reportedCategoryId: views.supportingAssetSources.reportedCategoryId })
      .from(views.supportingAssetSources)
      .where(and(
        eq(views.supportingAssetSources.supportingAssetId, supportingAssetId),
        eq(views.supportingAssetSources.origin, 'user'),
      ))
      .limit(1);
    return rows.at(0) ?? null;
  },
  /** Moves the asset's manual observation, if any, to the category the asset was just given; its property blocks stay as they are. */
  updateManualSourceCategory: async ({ db }, supportingAssetId: string, categoryId: AssetCategory) => {
    await db.update(supportingAssetSources)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
      .set({ reportedCategoryId: categoryId, updatedAt: sql`now()` as unknown as Date })
      .where(and(
        eq(supportingAssetSources.supportingAssetId, supportingAssetId),
        eq(supportingAssetSources.origin, 'user'),
      ));
  },
  /** Deletes the asset's manual observation row; its property blocks cascade with it (FK `onDelete: 'cascade'`). */
  deleteManualSourceByAssetId: async ({ db }, supportingAssetId: string) => {
    await db.delete(supportingAssetSources).where(and(
      eq(supportingAssetSources.supportingAssetId, supportingAssetId),
      eq(supportingAssetSources.origin, 'user'),
    ));
  },
  /**
   * An asset's tags, one row per (asset, tag) — never per author: the link table carries one row
   * per author asserting a tag, so two connectors naming the same tag on the same asset
   * would otherwise paint two chips for it. `distinctOn` the (asset, tag) pair collapses them,
   * since every author of a given tag id reports the same canonical name by construction.
   *
   * The colour comes along in the same pass rather than a second query: it is the one the tag's
   * newest origin reports, skipping origins that report none (`reported_color IS NULL` sorts last,
   * so a colourless origin only wins when no origin has one). The tie-break is the newest origin
   * rather than the most recently synced one because an origin row carries no sync timestamp —
   * adding a column to settle a colour would cost more than the tie is worth, and ordering on the
   * row's own time-ordered id is stable.
   */
  findTagsByAssetIds: ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .selectDistinctOn([views.supportingAssetTags.supportingAssetId, views.tags.id], {
        supportingAssetId: views.supportingAssetTags.supportingAssetId,
        id: views.tags.id,
        name: views.tags.name,
        color: views.tagSources.reportedColor,
      })
      .from(views.supportingAssetTags)
      .innerJoin(views.tags, eq(views.supportingAssetTags.tagId, views.tags.id))
      .leftJoin(views.tagSources, eq(views.tagSources.tagId, views.tags.id))
      .where(inArray(views.supportingAssetTags.supportingAssetId, assetIds))
      .orderBy(
        views.supportingAssetTags.supportingAssetId,
        views.tags.id,
        sql`${views.tagSources.reportedColor} is null`,
        desc(views.tagSources.id),
      );
  },
  /**
   * Every (asset, tag) pair the manual author — never a connector — asserted, straight off
   * `supportingAssetTags.connectorId`: that column, not `tagSources` (which speaks to a tag's own
   * *name* origin, not to any one asset's link), is what tells this asset's link apart from a
   * connector's. A tag a connector also reports on the same asset still has its own row here
   * (`supporting_asset_tags_asset_tag_connector_uq` keeps one row per author), so this never
   * conflates the two.
   */
  findManualTagLinksByAssetIds: ({ db, views }, assetIds: Array<string>): Promise<Array<{ supportingAssetId: string, tagId: string }>> => {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({ supportingAssetId: views.supportingAssetTags.supportingAssetId, tagId: views.supportingAssetTags.tagId })
      .from(views.supportingAssetTags)
      .where(and(
        inArray(views.supportingAssetTags.supportingAssetId, assetIds),
        isNull(views.supportingAssetTags.connectorId),
      ));
  },
  findManualValuesByAssetIds: ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({
        supportingAssetId: views.supportingAssetManualValues.supportingAssetId,
        attribute: views.supportingAssetManualValues.attribute,
        value: views.supportingAssetManualValues.value,
        setByUserId: views.supportingAssetManualValues.setByUserId,
        setByUserName: views.users.name,
        setAt: views.supportingAssetManualValues.setAt,
      })
      .from(views.supportingAssetManualValues)
      .leftJoin(views.users, eq(views.supportingAssetManualValues.setByUserId, views.users.id))
      .where(inArray(views.supportingAssetManualValues.supportingAssetId, assetIds));
  },
  upsertManualValue: async ({ db }, row: typeof supportingAssetManualValues.$inferInsert) => {
    await db.insert(supportingAssetManualValues).values([row]).onConflictDoUpdate({
      target: [supportingAssetManualValues.supportingAssetId, supportingAssetManualValues.attribute],
      set: { value: row.value, setByUserId: row.setByUserId, setAt: row.setAt },
    });
  },
  deleteManualValues: async ({ db }, supportingAssetId: string) => {
    await db.delete(supportingAssetManualValues).where(eq(supportingAssetManualValues.supportingAssetId, supportingAssetId));
  },
  deleteManualValue: async ({ db }, supportingAssetId: string, attribute: AssetManualAttribute) => {
    await db.delete(supportingAssetManualValues).where(and(
      eq(supportingAssetManualValues.supportingAssetId, supportingAssetId),
      eq(supportingAssetManualValues.attribute, attribute),
    ));
  },
  /**
   * The candidates a batch could possibly resolve against, narrowed to what the matcher can ever
   * read: a row already keyed on one of the batch's own `(connectorId, sourceAssetId)` pairs
   * (what makes a resync of an existing row, of any family, find itself again), the common tier's
   * `externalReference`, or — within the `machine` family — a tier-0/tier-1 identifier, a MAC or a
   * hostname, in either direction (a candidate's `agentExternalReference` against an incoming
   * `sourceAssetId` covers OpenAEV naming a Defender machine id, and back — this is why
   * `sourceAssetId` is checked against both `sourceAssetIds` and `agentExternalReferences`,
   * regardless of family). A row with none of these in common could never be chosen by
   * `resolve()` regardless of what else it carries, so this never drops a reachable match — but an
   * asset can span several rows (one per connector), and the veto needs every one of them, so the
   * match is widened from rows to whole assets before the real observations are read back.
   *
   * A candidate row carrying no machine properties at all (nothing was ever reported beyond the
   * common part) is found by the first query alone, on its `sourceAssetId`/`externalReference`:
   * every predicate of the family queries below reads the joined property table, so a row without
   * one can only ever come from that first query.
   */
  findCandidateAssetObservationsForIdentities: async (
    { db, views },
    tenantId: string,
    identities: {
      sourceAssetIds: Array<string>,
      externalReferences: Array<string>,
      machine?: {
        hostnames: Array<string>,
        hardwareUuids: Array<string>,
        directoryDeviceIds: Array<string>,
        cloudVmIds: Array<string>,
        cloudResourceIds: Array<string>,
        macAddresses: Array<string>,
        agentExternalReferences: Array<string>,
      },
      aiTarget?: {
        normalizedEndpointUrls: Array<string>,
      },
      identity?: {
        directoryObjectIds: Array<string>,
        sids: Array<string>,
      },
    },
  ) => {
    // Either side of tier 0: a candidate's own device id, or the executor reference it was named
    // under, against every value the batch carries under either name.
    const referenceValues = [...new Set([...identities.sourceAssetIds, ...(identities.machine?.agentExternalReferences ?? [])])];
    const queries = [];
    if (referenceValues.length > 0 || identities.externalReferences.length > 0) {
      queries.push(
        db.selectDistinct({ supportingAssetId: views.supportingAssetSources.supportingAssetId })
          .from(views.supportingAssetSources)
          .where(and(
            eq(views.supportingAssetSources.tenantId, tenantId),
            or(
              referenceValues.length > 0 ? inArray(views.supportingAssetSources.sourceAssetId, referenceValues) : undefined,
              identities.externalReferences.length > 0 ? inArray(views.supportingAssetSources.externalReference, identities.externalReferences) : undefined,
            ),
          )),
      );
    }
    if (identities.machine) {
      const m = identities.machine;
      queries.push(
        db.selectDistinct({ supportingAssetId: views.supportingAssetSources.supportingAssetId })
          .from(views.supportingAssetSources)
          .leftJoin(views.supportingAssetMachineProperties, eq(views.supportingAssetMachineProperties.supportingAssetSourceId, views.supportingAssetSources.id))
          .where(and(
            eq(views.supportingAssetSources.tenantId, tenantId),
            or(
              m.hostnames.length > 0 ? inArray(views.supportingAssetMachineProperties.hostname, m.hostnames) : undefined,
              m.hardwareUuids.length > 0 ? inArray(views.supportingAssetMachineProperties.hardwareUuid, m.hardwareUuids) : undefined,
              m.directoryDeviceIds.length > 0 ? inArray(views.supportingAssetMachineProperties.directoryDeviceId, m.directoryDeviceIds) : undefined,
              m.cloudVmIds.length > 0 ? inArray(views.supportingAssetMachineProperties.cloudVmId, m.cloudVmIds) : undefined,
              m.cloudResourceIds.length > 0 ? inArray(views.supportingAssetMachineProperties.cloudResourceId, m.cloudResourceIds) : undefined,
              m.macAddresses.length > 0 ? arrayOverlaps(views.supportingAssetMachineProperties.macAddresses, m.macAddresses) : undefined,
              referenceValues.length > 0 ? inArray(views.supportingAssetMachineProperties.agentExternalReference, referenceValues) : undefined,
            ),
          )),
      );
    }
    if (identities.aiTarget && identities.aiTarget.normalizedEndpointUrls.length > 0) {
      queries.push(
        db.selectDistinct({ supportingAssetId: views.supportingAssetSources.supportingAssetId })
          .from(views.supportingAssetSources)
          .leftJoin(views.supportingAssetAiTargetProperties, eq(views.supportingAssetAiTargetProperties.supportingAssetSourceId, views.supportingAssetSources.id))
          .where(and(
            eq(views.supportingAssetSources.tenantId, tenantId),
            inArray(views.supportingAssetAiTargetProperties.normalizedEndpointUrl, identities.aiTarget.normalizedEndpointUrls),
          )),
      );
    }
    if (identities.identity && (identities.identity.directoryObjectIds.length > 0 || identities.identity.sids.length > 0)) {
      const i = identities.identity;
      queries.push(
        db.selectDistinct({ supportingAssetId: views.supportingAssetSources.supportingAssetId })
          .from(views.supportingAssetSources)
          .leftJoin(views.supportingAssetIdentityProperties, eq(views.supportingAssetIdentityProperties.supportingAssetSourceId, views.supportingAssetSources.id))
          .where(and(
            eq(views.supportingAssetSources.tenantId, tenantId),
            or(
              i.directoryObjectIds.length > 0 ? inArray(views.supportingAssetIdentityProperties.directoryObjectId, i.directoryObjectIds) : undefined,
              // One list against both columns: an account reaches us under whichever SID its
              // source knew, and the two never collide — a SID names one security principal.
              i.sids.length > 0 ? inArray(views.supportingAssetIdentityProperties.cloudSid, i.sids) : undefined,
              i.sids.length > 0 ? inArray(views.supportingAssetIdentityProperties.onPremSid, i.sids) : undefined,
            ),
          )),
      );
    }
    if (queries.length === 0) {
      return [];
    }
    // Sequential, not `Promise.all`: a connector sync matches its batch inside a transaction.
    const matchingAssetIds = new Set<string>();
    for (const query of queries) {
      for (const { supportingAssetId } of await query) {
        matchingAssetIds.add(supportingAssetId);
      }
    }
    if (matchingAssetIds.size === 0) {
      return [];
    }
    return selectAssetObservations({ db, views }).where(inArray(views.supportingAssetSources.supportingAssetId, [...matchingAssetIds]));
  },
  /** The same rows, narrowed to a few assets: what a reprojection or a single resync needs. */
  findAssetObservationsByAssetIds: ({ db, views }, assetIds: Array<string>) => (
    assetIds.length === 0
      ? Promise.resolve([])
      : selectAssetObservations({ db, views }).where(inArray(views.supportingAssetSources.supportingAssetId, assetIds))
  ),
  insertSupportingAssetBatch: async ({ db }, rows: Array<typeof supportingAssets.$inferInsert>) => {
    if (rows.length === 0) {
      return [];
    }
    const inserted = await db.insert(supportingAssets).values(rows).returning();
    return inserted.map((r) => ({ id: r.id }));
  },
  /**
   * Rewrites a conflicting row only when the values it would hold differ from the stored ones
   * (`setWhere`, compared after the `LEAST`/`GREATEST`/`COALESCE` resolution): an identical
   * re-report leaves the row, its `updated_at` and its change notification alone, and one that only
   * advances `last_seen_at` leaves `updated_at` alone, so `updated_at` means "last changed".
   *
   * `RETURNING` hands back only the rows written, and for a conflict the row that already existed,
   * not the `uuidv7()` the caller put in the insert payload: a key absent from the result was
   * skipped by the guard, and callers must read its id back with
   * `findSourcesByConnectorAndSourceAssetIds` rather than build their
   * `(connectorId, sourceAssetId) → id` map from this return value alone.
   */
  upsertSupportingAssetSourceBatch: async ({ db }, rows: Array<typeof supportingAssetSources.$inferInsert>) => {
    if (rows.length === 0) {
      return [];
    }
    // A sighting the connector dates in the future would outrank every other source of its
    // authority until real time caught up, so it is clamped to the database clock.
    const clamped = rows.map((row) => (row.lastSeenAt
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
      ? { ...row, lastSeenAt: sql`LEAST(${row.lastSeenAt.toISOString()}::timestamptz, now())` as unknown as Date }
      : row));
    // Keeps the first-seen and last-seen walks monotonic, and keeps a connector that reports no
    // date (an OpenAEV endpoint without an agent) from erasing the one we already hold.
    const written = {
      supportingAssetId: sql`excluded.supporting_asset_id`,
      reportedName: sql`COALESCE(excluded.reported_name, supporting_asset_sources.reported_name)`,
      reportedCategoryId: sql`excluded.reported_category_id`,
      reportedSubcategoryId: sql`excluded.reported_subcategory_id`,
      reportedDescription: sql`excluded.reported_description`,
      reportedExposure: sql`excluded.reported_exposure`,
      reportedCriticality: sql`excluded.reported_criticality`,
      reportedCriticalityRule: sql`excluded.reported_criticality_rule`,
      externalReference: sql`excluded.external_reference`,
      reportedUrl: sql`excluded.reported_url`,
      reportedLinkedPerson: sql`excluded.reported_linked_person`,
      firstSeenAt: sql`LEAST(supporting_asset_sources.first_seen_at, excluded.first_seen_at)`,
      lastSeenAt: sql`GREATEST(supporting_asset_sources.last_seen_at, excluded.last_seen_at)`,
    };
    return db.insert(supportingAssetSources).values(clamped).onConflictDoUpdate({
      target: [supportingAssetSources.tenantId, supportingAssetSources.connectorId, supportingAssetSources.sourceAssetId],
      set: { ...written, updatedAt: updatedAtOnDataChange(supportingAssetSources, written) },
      setWhere: valuesChange(supportingAssetSources, written),
    }).returning();
  },
  /** Conflicts on `supportingAssetSourceId`: one row per source, upserted after its parent, and not rewritten when no reported column differs; a row written moves its source's `updated_at`. */
  upsertMachinePropertiesBatch: async ({ db }, rows: Array<typeof supportingAssetMachineProperties.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    const set = {
      hostname: sql`excluded.hostname`,
      ipAddresses: sql`excluded.ip_addresses`,
      macAddresses: sql`excluded.mac_addresses`,
      seenIp: sql`excluded.seen_ip`,
      hardwareUuid: sql`excluded.hardware_uuid`,
      directoryDeviceId: sql`excluded.directory_device_id`,
      cloudVmId: sql`excluded.cloud_vm_id`,
      cloudResourceId: sql`excluded.cloud_resource_id`,
      cloudProvider: sql`excluded.cloud_provider`,
      cloudNativeType: sql`excluded.cloud_native_type`,
      cloudRegion: sql`excluded.cloud_region`,
      platform: sql`excluded.platform`,
      arch: sql`excluded.arch`,
      vendor: sql`excluded.vendor`,
      model: sql`excluded.model`,
      operatingSystem: sql`excluded.operating_system`,
      osVersion: sql`excluded.os_version`,
      isEol: sql`excluded.is_eol`,
      agentExternalReference: sql`excluded.agent_external_reference`,
      agentExecutorType: sql`excluded.agent_executor_type`,
    };
    const written = await db.insert(supportingAssetMachineProperties).values(rows).onConflictDoUpdate({
      target: [supportingAssetMachineProperties.supportingAssetSourceId],
      set,
      setWhere: valuesChange(supportingAssetMachineProperties, set),
    }).returning();
    await markSourcesChanged({ db }, written);
  },
  /** Conflicts on `supportingAssetSourceId`: one row per source, upserted after its parent, and not rewritten when no reported column differs; a row written moves its source's `updated_at`. */
  upsertAiTargetPropertiesBatch: async ({ db }, rows: Array<typeof supportingAssetAiTargetProperties.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    const set = {
      provider: sql`excluded.provider`,
      endpointUrl: sql`excluded.endpoint_url`,
      normalizedEndpointUrl: sql`excluded.normalized_endpoint_url`,
      model: sql`excluded.model`,
      modality: sql`excluded.modality`,
      systemPrompt: sql`excluded.system_prompt`,
    };
    const written = await db.insert(supportingAssetAiTargetProperties).values(rows).onConflictDoUpdate({
      target: [supportingAssetAiTargetProperties.supportingAssetSourceId],
      set,
      setWhere: valuesChange(supportingAssetAiTargetProperties, set),
    }).returning();
    await markSourcesChanged({ db }, written);
  },
  /** Conflicts on `supportingAssetSourceId`: one row per source, upserted after its parent, and not rewritten when no reported column differs; a row written moves its source's `updated_at`. */
  upsertIdentityPropertiesBatch: async ({ db }, rows: Array<typeof supportingAssetIdentityProperties.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    const set = {
      directoryObjectId: sql`excluded.directory_object_id`,
      cloudSid: sql`excluded.cloud_sid`,
      onPremSid: sql`excluded.on_prem_sid`,
      userPrincipalName: sql`excluded.user_principal_name`,
      accountDomain: sql`excluded.account_domain`,
      accountName: sql`excluded.account_name`,
      directoryType: sql`excluded.directory_type`,
      identityProvider: sql`excluded.identity_provider`,
      department: sql`excluded.department`,
      jobTitle: sql`excluded.job_title`,
      isEnabled: sql`excluded.is_enabled`,
      assignedRoles: sql`excluded.assigned_roles`,
      privilegedPimRoles: sql`excluded.privileged_pim_roles`,
    };
    const written = await db.insert(supportingAssetIdentityProperties).values(rows).onConflictDoUpdate({
      target: [supportingAssetIdentityProperties.supportingAssetSourceId],
      set,
      setWhere: valuesChange(supportingAssetIdentityProperties, set),
    }).returning();
    await markSourcesChanged({ db }, written);
  },
  /**
   * Drops the property rows of the family a connector's source no longer reports: a row left
   * behind would be read again as that source's block once the asset is in that family.
   */
  deleteMachinePropertiesBySourceIds: async ({ db }, sourceIds: Array<string>) => {
    if (sourceIds.length === 0) {
      return;
    }
    await db.delete(supportingAssetMachineProperties)
      .where(inArray(supportingAssetMachineProperties.supportingAssetSourceId, sourceIds));
  },
  deleteAiTargetPropertiesBySourceIds: async ({ db }, sourceIds: Array<string>) => {
    if (sourceIds.length === 0) {
      return;
    }
    await db.delete(supportingAssetAiTargetProperties)
      .where(inArray(supportingAssetAiTargetProperties.supportingAssetSourceId, sourceIds));
  },
  deleteIdentityPropertiesBySourceIds: async ({ db }, sourceIds: Array<string>) => {
    if (sourceIds.length === 0) {
      return;
    }
    await db.delete(supportingAssetIdentityProperties)
      .where(inArray(supportingAssetIdentityProperties.supportingAssetSourceId, sourceIds));
  },
  findSourcesByConnectorAndSourceAssetIds: async ({ db, views }, connectorId: string, sourceAssetIds: Array<string>) => {
    if (sourceAssetIds.length === 0) {
      return [];
    }
    return await db
      .select({ id: views.supportingAssetSources.id, supportingAssetId: views.supportingAssetSources.supportingAssetId, sourceAssetId: views.supportingAssetSources.sourceAssetId })
      .from(views.supportingAssetSources)
      .where(and(
        eq(views.supportingAssetSources.connectorId, connectorId),
        inArray(views.supportingAssetSources.sourceAssetId, sourceAssetIds),
      ));
  },
  deleteSupportingAssetSourcesByIds: async ({ db }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    await db.delete(supportingAssetSources).where(inArray(supportingAssetSources.id, ids));
  },
  /** Of these assets, the ones a connector still observes: a source of `connector` origin remains. */
  findAssetIdsWithConnectorSource: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    const rows = await db
      .selectDistinct({ id: views.supportingAssetSources.supportingAssetId })
      .from(views.supportingAssetSources)
      .where(and(
        inArray(views.supportingAssetSources.supportingAssetId, assetIds),
        eq(views.supportingAssetSources.origin, 'connector'),
      ));
    return rows.map((row) => row.id);
  },
  /**
   * Of these assets, the ones a person put something into, which deleting would destroy. Any
   * table pointing at `supporting_assets` that only a person writes is read here, in one statement
   * for the whole batch; what jobs and connectors write (postures, scores, lifts, enumerations,
   * connector tags and findings, the per-family property rows) is not an investment.
   *
   * Relations are written by connectors alone but tie the asset to another one, so they count as
   * links nobody should lose silently, except those of `retiringConnectorId`: that connector drops
   * them itself once the asset is no longer one of its endpoints, and would leave the asset behind.
   */
  findInvestedAssetIds: async ({ db, views }, params: { assetIds: Array<string>, retiringConnectorId: string }) => {
    const { assetIds, retiringConnectorId } = params;
    if (assetIds.length === 0) {
      return [];
    }
    const [first, ...rest] = [
      db.select({ id: views.supportingAssets.id })
        .from(views.supportingAssets)
        .where(and(inArray(views.supportingAssets.id, assetIds), isNotNull(views.supportingAssets.ownerId))),
      db.select({ id: views.supportingAssetManualValues.supportingAssetId })
        .from(views.supportingAssetManualValues)
        .where(inArray(views.supportingAssetManualValues.supportingAssetId, assetIds)),
      db.select({ id: views.supportingAssetSources.supportingAssetId })
        .from(views.supportingAssetSources)
        .where(and(inArray(views.supportingAssetSources.supportingAssetId, assetIds), eq(views.supportingAssetSources.origin, 'user'))),
      db.select({ id: views.supportingAssetTags.supportingAssetId })
        .from(views.supportingAssetTags)
        .where(and(inArray(views.supportingAssetTags.supportingAssetId, assetIds), isNull(views.supportingAssetTags.connectorId))),
      db.select({ id: views.supportingAssetRelations.fromAssetId })
        .from(views.supportingAssetRelations)
        .where(and(inArray(views.supportingAssetRelations.fromAssetId, assetIds), ne(views.supportingAssetRelations.connectorId, retiringConnectorId))),
      db.select({ id: views.supportingAssetRelations.toAssetId })
        .from(views.supportingAssetRelations)
        .where(and(inArray(views.supportingAssetRelations.toAssetId, assetIds), ne(views.supportingAssetRelations.connectorId, retiringConnectorId))),
      db.select({ id: views.supportToPrimaryLinks.supportingAssetId })
        .from(views.supportToPrimaryLinks)
        .where(inArray(views.supportToPrimaryLinks.supportingAssetId, assetIds)),
      db.select({ id: views.supportToSupportLinks.providerAssetId })
        .from(views.supportToSupportLinks)
        .where(inArray(views.supportToSupportLinks.providerAssetId, assetIds)),
      db.select({ id: views.supportToSupportLinks.dependentAssetId })
        .from(views.supportToSupportLinks)
        .where(inArray(views.supportToSupportLinks.dependentAssetId, assetIds)),
      db.select({ id: views.organizationAssets.supportingAssetId })
        .from(views.organizationAssets)
        .where(inArray(views.organizationAssets.supportingAssetId, assetIds)),
      db.select({ id: views.assetEvidence.supportingAssetId })
        .from(views.assetEvidence)
        .where(and(inArray(views.assetEvidence.supportingAssetId, assetIds), isNotNull(views.assetEvidence.userId))),
      db.select({ id: views.assetEvidence.supportingAssetId })
        .from(views.assetEvidenceHistory)
        .innerJoin(views.assetEvidence, eq(views.assetEvidenceHistory.assetEvidenceId, views.assetEvidence.id))
        .where(and(inArray(views.assetEvidence.supportingAssetId, assetIds), eq(views.assetEvidenceHistory.origin, 'user'))),
    ];
    const rows = await unionAll(first, ...rest);
    return rows.map((row) => row.id);
  },
  /** Every device a connector observes, with the identifiers a relation's device end joins on. */
  findConnectorDeviceIdentifiers: ({ db, views }, connectorId: string) => db
    .select({
      supportingAssetId: views.supportingAssetSources.supportingAssetId,
      directoryDeviceId: views.supportingAssetMachineProperties.directoryDeviceId,
      macAddresses: views.supportingAssetMachineProperties.macAddresses,
      lastSeenAt: views.supportingAssetSources.lastSeenAt,
    })
    .from(views.supportingAssetSources)
    .innerJoin(views.supportingAssetMachineProperties, eq(views.supportingAssetMachineProperties.supportingAssetSourceId, views.supportingAssetSources.id))
    .where(eq(views.supportingAssetSources.connectorId, connectorId)),
  /** Every identity a connector observes, by the key it reports it under: the Entra object id, or `sid:…`. */
  findConnectorIdentityKeys: ({ db, views }, connectorId: string) => db
    .select({
      supportingAssetId: views.supportingAssetSources.supportingAssetId,
      sourceAssetId: views.supportingAssetSources.sourceAssetId,
    })
    .from(views.supportingAssetSources)
    .where(and(
      eq(views.supportingAssetSources.connectorId, connectorId),
      eq(views.supportingAssetSources.reportedCategoryId, 'identity'),
    )),
  /** A re-observed relation keeps its first sighting and takes the source that reported it this time. */
  upsertRelationsBatch: async ({ db }, rows: Array<typeof supportingAssetRelations.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(supportingAssetRelations).values(rows).onConflictDoUpdate({
      target: [
        supportingAssetRelations.tenantId,
        supportingAssetRelations.connectorId,
        supportingAssetRelations.fromAssetId,
        supportingAssetRelations.toAssetId,
        supportingAssetRelations.kind,
      ],
      set: {
        source: sql`excluded.source`,
        lastReportedAt: sql`excluded.last_reported_at`,
      },
    });
  },
  /** The relations of one kind a connector holds, its own and no other connector's. */
  findConnectorRelations: ({ db, views }, params: { connectorId: string, kind: AssetRelationKind }) => db
    .select({
      id: views.supportingAssetRelations.id,
      fromAssetId: views.supportingAssetRelations.fromAssetId,
      toAssetId: views.supportingAssetRelations.toAssetId,
      source: views.supportingAssetRelations.source,
    })
    .from(views.supportingAssetRelations)
    .where(and(
      eq(views.supportingAssetRelations.connectorId, params.connectorId),
      eq(views.supportingAssetRelations.kind, params.kind),
    )),
  deleteRelationsByIds: async ({ db }, params: { connectorId: string, kind: AssetRelationKind, ids: ReadonlyArray<string> }) => {
    if (params.ids.length === 0) {
      return 0;
    }
    const deleted = await db.delete(supportingAssetRelations)
      .where(and(
        eq(supportingAssetRelations.connectorId, params.connectorId),
        eq(supportingAssetRelations.kind, params.kind),
        inArray(supportingAssetRelations.id, [...params.ids]),
      ))
      .returning();
    return deleted.length;
  },
  findRelationsByAssetId: async ({ db, views }, assetId: string) => {
    const read = (direction: 'outgoing' | 'incoming') => {
      const ownEnd = direction === 'outgoing' ? views.supportingAssetRelations.fromAssetId : views.supportingAssetRelations.toAssetId;
      const otherEnd = direction === 'outgoing' ? views.supportingAssetRelations.toAssetId : views.supportingAssetRelations.fromAssetId;
      return db
        .select({
          id: views.supportingAssetRelations.id,
          kind: views.supportingAssetRelations.kind,
          source: views.supportingAssetRelations.source,
          lastReportedAt: views.supportingAssetRelations.lastReportedAt,
          otherAsset: {
            id: views.supportingAssets.id,
            name: views.supportingAssets.name,
            derivedName: views.supportingAssets.derivedName,
            categoryId: views.supportingAssets.categoryId,
            subcategoryId: views.supportingAssets.subcategoryId,
            criticality: views.supportingAssets.criticality,
          },
        })
        .from(views.supportingAssetRelations)
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, otherEnd))
        .where(eq(ownEnd, assetId))
        .orderBy(...orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.displayName, false), asc(views.supportingAssets.id))
        .then((rows) => rows.map((row) => ({ ...row, direction })));
    };
    const [outgoing, incoming] = await Promise.all([read('outgoing'), read('incoming')]);
    return [...outgoing, ...incoming];
  },
  /** Every device an identity is the primary user of, with that identity's band in effect, whichever connector saw it. */
  findCriticalityLiftAssignments: ({ db, views }) => db
    .select({
      deviceId: views.supportingAssetRelations.toAssetId,
      identityId: views.supportingAssetRelations.fromAssetId,
      identityCriticality: views.supportingAssets.criticality,
    })
    .from(views.supportingAssetRelations)
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.supportingAssetRelations.fromAssetId))
    .where(eq(views.supportingAssetRelations.kind, 'primary_user_of')),
  findAllCriticalityLifts: ({ db, views }) => db
    .select({
      supportingAssetId: views.supportingAssetCriticalityLifts.supportingAssetId,
      criticality: views.supportingAssetCriticalityLifts.criticality,
      fromAssetId: views.supportingAssetCriticalityLifts.fromAssetId,
    })
    .from(views.supportingAssetCriticalityLifts),
  /**
   * Holds these assets for the rest of the transaction, taken before a reprojection reads what it
   * derives them from: two reprojections of one asset then run one after the other, the second
   * reading what the first committed, instead of the later commit writing back what it read before.
   *
   * `no key update`, the lock the reprojection's own update takes anyway: it leaves the KEY SHARE a
   * source row's insert takes on its asset alone, so a sync still writes its observations meanwhile.
   * Taken in id order, so that two reprojections never wait on each other's half.
   */
  lockSupportingAssetsForReprojection: ({ db, views }, assetIds: Array<string>) =>
    db.select({ id: views.supportingAssets.id })
      .from(views.supportingAssets)
      .where(inArray(views.supportingAssets.id, assetIds))
      .orderBy(views.supportingAssets.id)
      .for('no key update'),
  /**
   * Holds assets that may be deleted while the transaction decides. `update`, unlike the reprojection
   * lock, blocks the KEY SHARE a child row's insert takes: what a person adds meanwhile then fails on
   * its foreign key instead of being cascaded away unseen.
   */
  lockSupportingAssetsForDeletion: ({ db, views }, assetIds: Array<string>) =>
    db.select({ id: views.supportingAssets.id })
      .from(views.supportingAssets)
      .where(inArray(views.supportingAssets.id, assetIds))
      .orderBy(views.supportingAssets.id)
      .for('update'),
  findCriticalityLiftsByAssetIds: ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({
        supportingAssetId: views.supportingAssetCriticalityLifts.supportingAssetId,
        criticality: views.supportingAssetCriticalityLifts.criticality,
      })
      .from(views.supportingAssetCriticalityLifts)
      .where(inArray(views.supportingAssetCriticalityLifts.supportingAssetId, assetIds));
  },
  /** An asset's lift with the identity it comes from, for the detail; null when it carries none. */
  findCriticalityLiftByAssetId: ({ db, views }, assetId: string) => db
    .select({
      criticality: views.supportingAssetCriticalityLifts.criticality,
      fromAssetId: views.supportingAssetCriticalityLifts.fromAssetId,
      fromAssetName: views.supportingAssets.name,
      fromAssetDerivedName: views.supportingAssets.derivedName,
      fromAssetCriticality: views.supportingAssets.criticality,
    })
    .from(views.supportingAssetCriticalityLifts)
    .leftJoin(views.supportingAssets, eq(views.supportingAssets.id, views.supportingAssetCriticalityLifts.fromAssetId))
    .where(eq(views.supportingAssetCriticalityLifts.supportingAssetId, assetId))
    .then((rows) => rows[0] ?? null),
  upsertCriticalityLifts: async ({ db }, rows: Array<typeof supportingAssetCriticalityLifts.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(supportingAssetCriticalityLifts).values(rows).onConflictDoOverwrite({
      target: [supportingAssetCriticalityLifts.tenantId, supportingAssetCriticalityLifts.supportingAssetId],
      columns: ['criticality', 'fromAssetId'],
    });
  },
  deleteCriticalityLiftsByAssetIds: async ({ db }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return;
    }
    await db.delete(supportingAssetCriticalityLifts).where(inArray(supportingAssetCriticalityLifts.supportingAssetId, assetIds));
  },
  /**
   * Writes the derivation's output back onto the canonical rows, one statement per chunk. A row
   * whose resolved values all equal the stored ones is not rewritten, and one where only
   * `last_seen_at` moved is rewritten without moving `updated_at`, so a re-sync that changed nothing
   * leaves the asset's `updated_at` and change notification alone.
   */
  reprojectSupportingAssets: async (
    { db },
    rows: Array<{
      id: string,
      name: string | null,
      exposure: (typeof supportingAssets.$inferInsert)['exposure'],
      categoryId: (typeof supportingAssets.$inferInsert)['categoryId'],
      subcategoryId: (typeof supportingAssets.$inferInsert)['subcategoryId'],
      criticality: (typeof supportingAssets.$inferInsert)['criticality'],
      description: string | null,
      externalReference: string | null,
      url: string | null,
      linkedPerson: string | null,
      firstSeenAt: Date | null,
      lastSeenAt: Date | null,
    }>,
  ) => {
    for (let i = 0; i < rows.length; i += REPROJECT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + REPROJECT_CHUNK_SIZE);
      const caseExpression = <T>(fallbackColumn: PgColumn, getValue: (row: typeof chunk[number]) => Date | string | null | undefined) => {
        const value = sql`
          case ${supportingAssets.id}
          ${sql.join(chunk.map((row) => sql`when ${row.id} then ${getValue(row) ?? null}`), sql` `)}
          else ${fallbackColumn}
          end
        `;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: CASE expressions carry no column type
        return value as unknown as T;
      };
      const resolved = {
        name: caseExpression<string | null>(supportingAssets.name, (row) => row.name),
        exposure: caseExpression<(typeof supportingAssets.$inferInsert)['exposure']>(supportingAssets.exposure, (row) => row.exposure),
        categoryId: caseExpression<(typeof supportingAssets.$inferInsert)['categoryId']>(supportingAssets.categoryId, (row) => row.categoryId),
        subcategoryId: caseExpression<(typeof supportingAssets.$inferInsert)['subcategoryId']>(supportingAssets.subcategoryId, (row) => row.subcategoryId),
        criticality: caseExpression<(typeof supportingAssets.$inferInsert)['criticality']>(supportingAssets.criticality, (row) => row.criticality),
        description: caseExpression<string | null>(supportingAssets.description, (row) => row.description),
        externalReference: caseExpression<string | null>(supportingAssets.externalReference, (row) => row.externalReference),
        url: caseExpression<string | null>(supportingAssets.url, (row) => row.url),
        linkedPerson: caseExpression<string | null>(supportingAssets.linkedPerson, (row) => row.linkedPerson),
        firstSeenAt: caseExpression<Date | null>(supportingAssets.firstSeenAt, (row) => row.firstSeenAt),
        lastSeenAt: caseExpression<Date | null>(supportingAssets.lastSeenAt, (row) => row.lastSeenAt),
      };
      await db.update(supportingAssets).set({
        ...resolved,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
        updatedAt: updatedAtOnDataChange(supportingAssets, resolved) as unknown as Date,
      }).where(and(
        inArray(supportingAssets.id, chunk.map((row) => row.id)),
        valuesChange(supportingAssets, resolved),
      ));
    }
  },
  /**
   * Writes only the names that changed, and leaves `updated_at` alone: the name is deduced from
   * properties the asset already carries, not an edit of the asset.
   */
  updateDerivedNames: async ({ db }, rows: Array<{ id: string, derivedName: string | null }>) => {
    for (let i = 0; i < rows.length; i += REPROJECT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + REPROJECT_CHUNK_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: CASE expressions carry no column type
      const derivedName = sql`
        case ${supportingAssets.id}
        ${sql.join(chunk.map((row) => sql`when ${row.id} then ${row.derivedName}`), sql` `)}
        else ${supportingAssets.derivedName}
        end
      ` as unknown as string | null;
      await db.update(supportingAssets)
        .set({ derivedName })
        .where(and(
          inArray(supportingAssets.id, chunk.map((row) => row.id)),
          sql`${supportingAssets.derivedName} is distinct from ${derivedName}`,
        ));
    }
  },
  insertAssetEvidence: ({ db }, values: typeof assetEvidence.$inferInsert) =>
    db.insert(assetEvidence).values([values]),
  /**
   * Holds the finding for the rest of the transaction, so that a connector sync reaching the same
   * row serializes against the caller instead of slipping an observation in between its source
   * check and its delete.
   *
   * `for('update')` and not `for('key share')`: inserting a source row takes a KEY SHARE on its
   * parent, and KEY SHARE does not conflict with itself.
   */
  lockAssetEvidence: ({ db, views }, id: string) =>
    db.select({ id: views.assetEvidence.id })
      .from(views.assetEvidence)
      .where(eq(views.assetEvidence.id, id))
      .for('update'),
  /**
   * Whether the transaction already locked or wrote a finding: either leaves it a table lock on
   * `asset_evidence` above a read's until it ends. So does an insert into a table referencing it,
   * through the foreign key check.
   */
  holdsFindingLocks: async ({ rawDb }): Promise<boolean> => {
    // eslint-disable-next-line no-restricted-syntax -- reads this backend's own locks, not table data: there are no rows for a policy to scope, and this runs on the caller's own transaction
    const result = await rawDb().execute(sql`
      select exists (
        select 1 from pg_locks
        where pid = pg_backend_pid()
          and locktype = 'relation'
          and relation = ${getTableName(assetEvidence)}::regclass
          and mode <> 'AccessShareLock'
      ) as held
    `);
    return result.rows[0]?.['held'] === true;
  },
  /**
   * Holds every finding of these assets for the rest of the transaction and returns their ids, taken
   * before their sources are read: a sync writing one of them meanwhile then either commits before
   * the reads or waits for the caller's commit. `no key update` is the lock the sync's upsert takes,
   * in the same order (`findingLockOrder`), so the two queue instead of deadlocking.
   */
  lockFindingsOnAssets: ({ db, views }, assetIds: Array<string>) =>
    db.select({ id: views.assetEvidence.id })
      .from(views.assetEvidence)
      .where(inUuids(views.assetEvidence.supportingAssetId, assetIds))
      .orderBy(...findingLockOrder(views.assetEvidence))
      .for('no key update'),
  deleteAssetEvidence: ({ db }, id: string) =>
    db.delete(assetEvidence).where(eq(assetEvidence.id, id)),
  /** The techniques an asset has at least one applicable result on, each once. */
  findApplicableTechniquesForAsset: ({ db, views }, assetId: string) =>
    db
      .selectDistinct({
        id: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
      })
      .from(views.assetEvidence)
      .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.assetEvidence.mitreTechniqueId))
      .where(and(
        eq(views.assetEvidence.supportingAssetId, assetId),
        eq(views.assetEvidence.currentState, DEFAULT_EVIDENCE_STATE),
      )),
  insertEvidenceHistory: ({ db }, values: typeof assetEvidenceHistory.$inferInsert) =>
    db.insert(assetEvidenceHistory).values([values]),
  findEvidenceById: ({ db, views }, id: string) =>
    db
      .select({
        id: views.assetEvidence.id,
        supportingAssetId: views.assetEvidence.supportingAssetId,
        cveId: views.cve.cveId,
        mitreTechniqueId: views.assetEvidence.mitreTechniqueId,
        mitreTechniqueExternalId: views.mitreTechniques.externalId,
        mitreTechniqueName: views.mitreTechniques.name,
        expectationType: views.assetEvidence.expectationType,
        securityPlatformType: views.assetEvidence.securityPlatformType,
        evaluatedAt: views.assetEvidence.evaluatedAt,
        sourceScenarioId: views.assetEvidence.sourceScenarioId,
        sourceScenarioName: views.assetEvidence.sourceScenarioName,
        sourceSimulationId: views.assetEvidence.sourceSimulationId,
        sourceInjectId: views.assetEvidence.sourceInjectId,
        userId: views.assetEvidence.userId,
        createdAt: views.assetEvidence.createdAt,
        updatedAt: views.assetEvidence.updatedAt,
        cveDescription: views.cve.cveDescription,
        userName: views.users.name,
        assetName: views.supportingAssets.name,
        assetDerivedName: views.supportingAssets.derivedName,
      })
      .from(views.assetEvidence)
      .leftJoin(views.cve, eq(views.assetEvidence.cveId, views.cve.id))
      .leftJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
      .leftJoin(views.users, eq(views.assetEvidence.userId, views.users.id))
      .leftJoin(views.supportingAssets, eq(views.assetEvidence.supportingAssetId, views.supportingAssets.id))
      .where(eq(views.assetEvidence.id, id))
      .limit(1)
      .then((r) => r.at(0) ?? null),
  /** One row per reporting source, for the finding's Sources card and the list's icon stack. */
  findEvidenceSourcesByEvidenceIds: ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({
        assetEvidenceId: views.assetEvidenceSources.assetEvidenceId,
        connectorId: views.assetEvidenceSources.connectorId,
        source: views.integrationSettings.source,
        sourceFindingId: views.assetEvidenceSources.sourceFindingId,
        externalReference: views.assetEvidenceSources.externalReference,
        reportedSeverity: views.assetEvidenceSources.reportedSeverity,
        firstSeenAt: views.assetEvidenceSources.firstSeenAt,
        lastSeenAt: views.assetEvidenceSources.lastSeenAt,
        evaluatedAt: views.assetEvidenceSources.evaluatedAt,
      })
      .from(views.assetEvidenceSources)
      .leftJoin(views.integrationSettings, eq(views.assetEvidenceSources.connectorId, views.integrationSettings.id))
      .where(inArray(views.assetEvidenceSources.assetEvidenceId, evidenceIds))
      // Oldest source first: readers that show a single source must not see it change between
      // two identical requests.
      .orderBy(asc(views.assetEvidenceSources.firstSeenAt), asc(views.assetEvidenceSources.id));
  },
  findEvidenceSoftwareByEvidenceIds: ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .selectDistinct({
        assetEvidenceId: views.assetEvidenceSources.assetEvidenceId,
        vendor: views.assetEvidenceSourceSoftware.vendor,
        name: views.assetEvidenceSourceSoftware.name,
        version: views.assetEvidenceSourceSoftware.version,
      })
      .from(views.assetEvidenceSourceSoftware)
      .innerJoin(views.assetEvidenceSources, eq(views.assetEvidenceSources.id, views.assetEvidenceSourceSoftware.assetEvidenceSourceId))
      .where(inArray(views.assetEvidenceSources.assetEvidenceId, evidenceIds))
      .orderBy(
        asc(views.assetEvidenceSources.assetEvidenceId),
        asc(views.assetEvidenceSourceSoftware.name),
        asc(views.assetEvidenceSourceSoftware.vendor),
        asc(views.assetEvidenceSourceSoftware.version),
      );
  },
  /** A source not yet on file is skipped: the caller writes the sources first. */
  writeEvidenceSourceSoftware: async (
    { db, views },
    tenantId: string,
    reports: ReadonlyArray<{ assetEvidenceId: string, connectorId: string, sourceFindingId: string, software: ReadonlyArray<ReportedSoftware> }>,
  ) => {
    if (reports.length === 0) {
      return;
    }
    const sources = await db
      .select({
        id: views.assetEvidenceSources.id,
        assetEvidenceId: views.assetEvidenceSources.assetEvidenceId,
        connectorId: views.assetEvidenceSources.connectorId,
        sourceFindingId: views.assetEvidenceSources.sourceFindingId,
      })
      .from(views.assetEvidenceSources)
      .where(inUuids(views.assetEvidenceSources.assetEvidenceId, [...new Set(reports.map((report) => report.assetEvidenceId))]));
    const sourceKey = (row: { assetEvidenceId: string, connectorId: string | null, sourceFindingId: string | null }) =>
      JSON.stringify([row.assetEvidenceId, row.connectorId, row.sourceFindingId]);
    const sourceIdByKey = new Map(sources.map((source) => [sourceKey(source), source.id]));

    const reported = reports.flatMap((report) => {
      const assetEvidenceSourceId = sourceIdByKey.get(sourceKey(report));
      return assetEvidenceSourceId === undefined ? [] : [{ assetEvidenceSourceId, software: report.software }];
    });
    const wanted = reported.flatMap(({ assetEvidenceSourceId, software }) => software.map((entry) => ({
      tenantId,
      assetEvidenceSourceId,
      vendor: entry.vendor,
      name: entry.name,
      version: entry.version,
    })));
    const held = await db
      .select({
        id: views.assetEvidenceSourceSoftware.id,
        assetEvidenceSourceId: views.assetEvidenceSourceSoftware.assetEvidenceSourceId,
        vendor: views.assetEvidenceSourceSoftware.vendor,
        name: views.assetEvidenceSourceSoftware.name,
        version: views.assetEvidenceSourceSoftware.version,
      })
      .from(views.assetEvidenceSourceSoftware)
      .where(inUuids(views.assetEvidenceSourceSoftware.assetEvidenceSourceId, reported.map((report) => report.assetEvidenceSourceId)));
    const softwareKey = (row: { assetEvidenceSourceId: string, vendor: string | null, name: string, version: string }) =>
      JSON.stringify([row.assetEvidenceSourceId, row.vendor, row.name, row.version]);
    const { stale, missing } = diffRows(held, wanted, softwareKey, softwareKey);

    if (stale.length > 0) {
      await db.delete(assetEvidenceSourceSoftware).where(inUuids(assetEvidenceSourceSoftware.id, stale.map((row) => row.id)));
    }
    for (let i = 0; i < missing.length; i += SOFTWARE_INSERT_CHUNK) {
      await db.insert(assetEvidenceSourceSoftware).values(missing.slice(i, i + SOFTWARE_INSERT_CHUNK).map((row) => ({ ...row, id: uuidv7() })));
    }
  },
  /**
   * Every source verdict on the given assets, each paired with the mark of the run that could
   * have refreshed it. A finding nobody reported through a connector has no row here and keeps
   * whatever state it was given by hand.
   */
  findEvidenceSourceVerdicts: ({ db, views }, scope: { assetIds: Array<string> } | { evidenceIds: Array<string> }) => {
    const ids = 'assetIds' in scope ? scope.assetIds : scope.evidenceIds;
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({
        id: views.assetEvidenceSources.id,
        assetEvidenceId: views.assetEvidenceSources.assetEvidenceId,
        connectorId: views.assetEvidenceSources.connectorId,
        isExposed: views.assetEvidenceSources.isExposed,
        reason: views.assetEvidenceSources.reason,
        sourceReportedAt: views.assetEvidenceSources.lastReportedAt,
        evaluatedAt: views.assetEvidenceSources.evaluatedAt,
        enumerationReportedAt: views.assetEnumerations.lastReportedAt,
      })
      .from(views.assetEvidenceSources)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceSources.assetEvidenceId))
      .leftJoin(views.assetEnumerations, and(
        eq(views.assetEnumerations.connectorId, views.assetEvidenceSources.connectorId),
        eq(views.assetEnumerations.supportingAssetId, views.assetEvidence.supportingAssetId),
        eq(views.assetEnumerations.scope, views.assetEvidenceSources.scope),
      ))
      .where('assetIds' in scope
        ? inArray(views.assetEvidence.supportingAssetId, ids)
        : inArray(views.assetEvidenceSources.assetEvidenceId, ids));
  },
  /** The verdict each source of these findings holds, which a new observation is compared against before it replaces it. */
  findEvidenceSourceStandings: ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .select({
        assetEvidenceId: views.assetEvidenceSources.assetEvidenceId,
        connectorId: views.assetEvidenceSources.connectorId,
        sourceFindingId: views.assetEvidenceSources.sourceFindingId,
        isExposed: views.assetEvidenceSources.isExposed,
        evaluatedAt: views.assetEvidenceSources.evaluatedAt,
      })
      .from(views.assetEvidenceSources)
      .where(inArray(views.assetEvidenceSources.assetEvidenceId, evidenceIds));
  },
  /**
   * Every distinct (asset, scope) this connector reported CVE evidence under since the given
   * instant: what it already wrote, read back rather than accumulated in memory across pages.
   * `scopes` is bound as one array parameter, since it can hold a whole estate's asset ids.
   */
  findCveScopePairsSince: ({ db, views }, connectorId: string, since: Date, scopes?: ReadonlyArray<string>) =>
    db
      .selectDistinct({ supportingAssetId: views.assetEvidence.supportingAssetId, scope: views.assetEvidenceSources.scope })
      .from(views.assetEvidenceSources)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceSources.assetEvidenceId))
      .where(and(
        eq(views.assetEvidenceSources.connectorId, connectorId),
        isNotNull(views.assetEvidence.cveId),
        gte(views.assetEvidenceSources.lastReportedAt, since),
        scopes === undefined ? undefined : sql`${views.assetEvidenceSources.scope} = any(${sql.param([...scopes])}::text[])`,
      )),
  /**
   * The sources of this connector under each key's scope whose finding is the key's (asset,
   * technique, expectation type) and carries one of the key's security platform types.
   */
  findEvidenceSourceIdsMatchingKeys: async (
    { db, views },
    connectorId: string,
    keys: Array<{ supportingAssetId: string, scope: string, mitreTechniqueId: string, expectationType: string, securityPlatformTypes: Array<string> }>,
  ) => {
    const typedKeys = keys.filter((k) => k.securityPlatformTypes.length > 0);
    if (typedKeys.length === 0) {
      return [];
    }
    // A key with no platform type matches nothing: it stands for a document that wrote no evidence.
    const keyTuples = sql.join(
      typedKeys.flatMap((k) => k.securityPlatformTypes.map(
        (type) => sql`(${k.supportingAssetId}::uuid, ${k.scope}, ${k.mitreTechniqueId}::uuid, ${k.expectationType}, ${type})`,
      )),
      sql`, `,
    );
    const rows = await db
      .select({ id: views.assetEvidenceSources.id })
      .from(views.assetEvidenceSources)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceSources.assetEvidenceId))
      .where(and(
        eq(views.assetEvidenceSources.connectorId, connectorId),
        sql`(${views.assetEvidence.supportingAssetId}, ${views.assetEvidenceSources.scope}, ${views.assetEvidence.mitreTechniqueId}, ${views.assetEvidence.expectationType}, ${views.assetEvidence.securityPlatformType}) in (${keyTuples})`,
      ));
    return rows.map((row) => row.id);
  },
  /** Only the sync clock moves, and never backwards: a stale caller must not make a source look older than it is. */
  setEvidenceSourcesReportedAt: async ({ db }, ids: Array<string>, reportedAt: Date) => {
    if (ids.length === 0) {
      return 0;
    }
    const updated = await db.update(assetEvidenceSources)
      .set({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
        lastReportedAt: sql`GREATEST(${assetEvidenceSources.lastReportedAt}, ${reportedAt.toISOString()}::timestamptz)` as unknown as Date,
      })
      .where(inArray(assetEvidenceSources.id, ids))
      .returning();
    return updated.length;
  },
  findDistinctEvidenceSourceScopePairs: ({ db, views }, connectorId: string) =>
    db
      .selectDistinct({ supportingAssetId: views.assetEvidence.supportingAssetId, scope: views.assetEvidenceSources.scope })
      .from(views.assetEvidenceSources)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceSources.assetEvidenceId))
      .where(and(
        eq(views.assetEvidenceSources.connectorId, connectorId),
        isNotNull(views.assetEvidence.mitreTechniqueId),
      )),
  findEvidenceHistoryByEvidenceId: ({ db, views }, evidenceId: string) =>
    db
      .select({
        id: views.assetEvidenceHistory.id,
        state: views.assetEvidenceHistory.state,
        stateChangedAt: views.assetEvidenceHistory.stateChangedAt,
        observedAt: views.assetEvidenceHistory.observedAt,
        enteredAt: historyRowEnteredAt({ views }),
        reason: views.assetEvidenceHistory.reason,
        dismissalType: views.assetEvidenceHistory.dismissalType,
        dismissalReasonCode: views.assetEvidenceHistory.dismissalReasonCode,
        changedByUserId: views.assetEvidenceHistory.changedByUserId,
        origin: views.assetEvidenceHistory.origin,
        changedByUserName: views.users.name,
      })
      .from(views.assetEvidenceHistory)
      .leftJoin(views.users, eq(views.assetEvidenceHistory.changedByUserId, views.users.id))
      .where(eq(views.assetEvidenceHistory.assetEvidenceId, evidenceId))
      .orderBy(asc(views.assetEvidenceHistory.stateChangedAt), asc(views.assetEvidenceHistory.id)),
  /**
   * The scope's applicable spans, days read in `timeZone`: how many findings went applicable on one
   * day and left that state on another, or never did. A span ending on or before `firstDay` is left
   * out and one opening earlier is clamped to it, so the pairs stay within the window drawn.
   *
   * Grouped in SQL rather than returned per history row: a widespread technique has hundreds of
   * thousands, and the heatmap needs a count per day.
   */
  findApplicableSpans: (
    { db, views },
    scope: EvidenceActivityScope,
    window: { timeZone: string, firstDay: string },
    mappedToOrganizationId: string | null = null,
  ): Promise<Array<ApplicableSpan>> => {
    const history = views.assetEvidenceHistory;
    const firstDay = sql`${window.firstDay}::date`;
    const spans = db
      .select({
        state: history.state,
        fromDay: sql<string>`greatest((${history.stateChangedAt} at time zone ${window.timeZone})::date, ${firstDay})`.as('from_day'),
        // The day the next state change lands, in the order the latest-state read uses.
        toDay: sql<string | null>`(lead(${history.stateChangedAt}) over (partition by ${history.assetEvidenceId} order by ${history.stateChangedAt}, ${history.id}) at time zone ${window.timeZone})::date`.as('to_day'),
      })
      .from(history)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, history.assetEvidenceId))
      .where(and(
        'supportingAssetId' in scope
          ? eq(views.assetEvidence.supportingAssetId, scope.supportingAssetId)
          : affectedAssetsOfFlaw({ db, views }, scope),
        buildEstateFilter({ db, views }, mappedToOrganizationId, views.assetEvidence.supportingAssetId),
      ))
      .as('spans');
    return db
      .select({
        // As text: the driver would read a `date` into a midnight in the server's own time zone.
        fromDay: sql<string>`to_char(${spans.fromDay}, 'YYYY-MM-DD')`,
        toDay: sql<string | null>`to_char(${spans.toDay}, 'YYYY-MM-DD')`,
        findings: count(),
      })
      .from(spans)
      // A finding that left the state the day it entered it never counted on any day.
      .where(and(eq(spans.state, 'applicable'), or(isNull(spans.toDay), sql`${spans.toDay} > ${spans.fromDay}`)))
      .groupBy(spans.fromDay, spans.toDay);
  },
  /**
   * One page of the findings of a CVE or a technique, each with the asset it is found on.
   *
   * Two passes, as `findListedFindingsPage` does: the first cuts the page on narrow ordered ids, and
   * the second reads the reason and the origin of the latest state for those rows alone. The state
   * itself is stored on the finding, so ordering on it walks an index instead of reading the history
   * of every finding of the flaw, which a widespread technique counts in hundreds of thousands.
   */
  findAffectedAssetsPage: async (
    { db, views },
    params: { flaw: AffectedAssetsFlaw, limit: number, offset: number, sortBy: AffectedAssetSortKey, sortDesc: boolean },
  ) => {
    const latest = latestEvidenceState({ db, views }, views.assetEvidence.id);
    const sortColumns: Record<AffectedAssetSortKey, PgColumn | SQL> = {
      assetName: views.supportingAssets.displayName,
      assetCategoryId: views.supportingAssets.categoryId,
      assetCriticality: rankOf(views.supportingAssets.criticality, ASSET_CRITICALITY_SEVERITY),
      currentState: views.assetEvidence.currentState,
      stateChangedAt: views.assetEvidence.currentStateChangedAt,
      expectationType: views.assetEvidence.expectationType,
      securityPlatformType: views.assetEvidence.securityPlatformType,
    };
    const sortColumn = sortColumns[params.sortBy];
    // Ties broken on the id: equal values can otherwise swap between requests. A stored state sorts
    // on its own index, which ends in the id: neither column is null, and the id follows the
    // direction, so a backward walk of the index serves the descending order.
    const sortsOnStoredState = params.sortBy === 'currentState' || params.sortBy === 'stateChangedAt';
    const primaryOrder = params.sortBy === 'assetName'
      ? orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.displayName, params.sortDesc)
      : [params.sortDesc ? sql`${sortColumn} desc nulls last` : sql`${sortColumn} asc nulls last`];
    const ordering: Array<SQL> = sortsOnStoredState
      ? [params.sortDesc ? sql`${sortColumn} desc` : sql`${sortColumn} asc`, params.sortDesc ? desc(views.assetEvidence.id) : asc(views.assetEvidence.id)]
      : [...primaryOrder, asc(views.assetEvidence.id)];

    const narrowed = db
      .select({ assetEvidenceId: views.assetEvidence.id })
      .from(views.assetEvidence)
      // Kept when nothing sorts on it: it drops a finding whose asset the caller cannot see.
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .$dynamic();
    const page = narrowed
      .where(affectedAssetsOfFlaw({ db, views }, params.flaw))
      .orderBy(...ordering)
      .limit(params.limit)
      .offset(params.offset)
      .as('affected_page');

    return db
      .select({
        evidenceId: views.assetEvidence.id,
        supportingAssetId: views.assetEvidence.supportingAssetId,
        assetName: views.supportingAssets.name,
        assetDerivedName: views.supportingAssets.derivedName,
        assetCategoryId: views.supportingAssets.categoryId,
        assetCriticality: views.supportingAssets.criticality,
        expectationType: views.assetEvidence.expectationType,
        securityPlatformType: views.assetEvidence.securityPlatformType,
        currentState: views.assetEvidence.currentState,
        stateChangedAt: views.assetEvidence.currentStateChangedAt,
        stateReason: latest.reason,
        stateOrigin: latest.origin,
        dismissalType: latest.dismissalType,
      })
      .from(page)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, page.assetEvidenceId))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .leftJoinLateral(latest, LATERAL_ON)
      .orderBy(...ordering);
  },
  countAffectedAssets: async ({ db, views }, flaw: AffectedAssetsFlaw) => {
    const rows = await db
      .select({ value: count() })
      .from(views.assetEvidence)
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .where(affectedAssetsOfFlaw({ db, views }, flaw));
    return rows.at(0)?.value ?? 0;
  },
  countBySubcategory: ({ db, views }, mappedToOrganizationId: string | null) =>
    db
      .select({
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        assetCount: count(views.supportingAssets.id),
      })
      .from(views.supportingAssets)
      .where(buildEstateFilter({ db, views }, mappedToOrganizationId))
      .groupBy(views.supportingAssets.categoryId, views.supportingAssets.subcategoryId)
      .orderBy(asc(views.supportingAssets.categoryId), asc(views.supportingAssets.subcategoryId)),
  /** The enabled state is the door's own definition. */
  countBySubcategoryAndIdentityState: ({ db, views }, mappedToOrganizationId: string | null) => {
    const { observedEnabled, identityEnabled } = enabledIdentitiesOf({ db, views });
    return db
      .select({
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        identityEnabled,
        assetCount: count(views.supportingAssets.id),
      })
      .from(views.supportingAssets)
      .leftJoin(observedEnabled, eq(observedEnabled.supportingAssetId, views.supportingAssets.id))
      .where(buildEstateFilter({ db, views }, mappedToOrganizationId))
      .groupBy(views.supportingAssets.categoryId, views.supportingAssets.subcategoryId, identityEnabled);
  },
  upsertAssetEvidenceBatch: async ({ db }, rows: Array<typeof assetEvidence.$inferInsert>) => {
    if (rows.length === 0) {
      return [];
    }
    // Track the UUIDs we're attempting to insert.
    // On conflict DO UPDATE, PostgreSQL RETURNING returns the EXISTING row (with its original id).
    // On a true insert, the returned id matches the one we supplied.
    // This lets us identify newly-created rows without a separate query.
    const attemptedIds = new Set(rows.map((r) => r.id));
    // GREATEST ignores nulls (only null when both sides are null): evaluatedAt can
    // only move forward, regardless of the order sync calls happen to arrive in.
    const evaluatedAt = sql`GREATEST(${assetEvidence.evaluatedAt}, excluded.evaluated_at)`;
    const result = await db
      .insert(assetEvidence)
      .values(rows)
      .onConflictDoUpdate({
        target: ASSET_EVIDENCE_KEY.map(({ column }) => assetEvidence[column]),
        // No `setWhere`: it would drop the unchanged rows from `RETURNING`, which the caller needs.
        set: { evaluatedAt, updatedAt: updatedAtOnDataChange(assetEvidence, { evaluatedAt }) },
      })
      .returning();
    // Return the unique-constraint columns alongside the real (post-upsert) id, so callers
    // can resolve every original row (including duplicates collapsed before this call) to
    // the actual DB id, which differs from the attempted id whenever a conflict occurred.
    return result.map((row) => ({
      id: row.id,
      isNew: attemptedIds.has(row.id),
      supportingAssetId: row.supportingAssetId,
      cveId: row.cveId,
      mitreTechniqueId: row.mitreTechniqueId,
      expectationType: row.expectationType,
      securityPlatformType: row.securityPlatformType,
      sourceScenarioId: row.sourceScenarioId,
    }));
  },
  upsertAssetEvidenceSourceBatch: async ({ db }, rows: Array<typeof assetEvidenceSources.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    // A replay or a late call can carry an observation older than the one the source holds: its
    // verdict must not replace the newer one, which is what the derived state is read from. At the
    // same instant an exposed verdict wins, the tie rule of the sync batch (`supersedes`).
    const isNewer = sql`(asset_evidence_sources.evaluated_at IS NULL
      OR excluded.evaluated_at > asset_evidence_sources.evaluated_at
      OR (excluded.evaluated_at = asset_evidence_sources.evaluated_at AND (excluded.is_exposed OR NOT asset_evidence_sources.is_exposed)))`;
    const written = {
      scope: sql`excluded.scope`,
      isExposed: sql`CASE WHEN ${isNewer} THEN excluded.is_exposed ELSE asset_evidence_sources.is_exposed END`,
      reason: sql`CASE WHEN ${isNewer} THEN excluded.reason ELSE asset_evidence_sources.reason END`,
      externalReference: sql`CASE WHEN ${isNewer} THEN excluded.external_reference ELSE asset_evidence_sources.external_reference END`,
      reportedSeverity: sql`CASE WHEN ${isNewer} THEN excluded.reported_severity ELSE asset_evidence_sources.reported_severity END`,
      firstSeenAt: sql`LEAST(asset_evidence_sources.first_seen_at, excluded.first_seen_at)`,
      lastSeenAt: sql`GREATEST(asset_evidence_sources.last_seen_at, excluded.last_seen_at)`,
      lastReportedAt: sql`excluded.last_reported_at`,
      evaluatedAt: sql`GREATEST(asset_evidence_sources.evaluated_at, excluded.evaluated_at)`,
    };
    await db.insert(assetEvidenceSources).values(rows).onConflictDoUpdate({
      target: [assetEvidenceSources.assetEvidenceId, assetEvidenceSources.connectorId, assetEvidenceSources.sourceFindingId],
      set: { ...written, updatedAt: updatedAtOnDataChange(assetEvidenceSources, written) },
      setWhere: valuesChange(assetEvidenceSources, written),
    });
  },
  /** The mark a run leaves on an asset it walked whole, which is what dates the sources' silence. */
  upsertAssetEnumerationBatch: async ({ db }, rows: Array<typeof assetEnumerations.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(assetEnumerations).values(rows).onConflictDoUpdate({
      target: [assetEnumerations.connectorId, assetEnumerations.supportingAssetId, assetEnumerations.scope],
      // Runs are replayed oldest-first within a sync, but a resumed job may revisit an older one:
      // the mark only ever moves forward.
      set: { lastReportedAt: sql`GREATEST(asset_enumerations.last_reported_at, excluded.last_reported_at)` },
    });
  },
  updateEvidenceSourceRefsBatch: async (
    { db },
    rows: Array<{
      id: string,
      sourceScenarioName: string | null,
      sourceSimulationId: string | null,
      sourceInjectId: string | null,
    }>,
  ) => {
    if (rows.length === 0) {
      return;
    }
    const buildCaseExpression = (
      fallbackColumn:
        | typeof assetEvidence.sourceScenarioName
        | typeof assetEvidence.sourceSimulationId
        | typeof assetEvidence.sourceInjectId,
      getValue: (row: typeof rows[number]) => string | null,
    ) => (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: CASE expressions need explicit casts for text columns
      sql`
        case ${assetEvidence.id}
        ${sql.join(rows.map((row) => sql`when ${row.id} then ${getValue(row)}`), sql` `)}
        else ${fallbackColumn}
        end
      ` as unknown as string
    );

    await db
      .update(assetEvidence)
      .set({
        // sourceScenarioId is part of asset_evidence_uq, so it never changes for an existing row.
        sourceScenarioName: buildCaseExpression(assetEvidence.sourceScenarioName, (row) => row.sourceScenarioName),
        sourceSimulationId: buildCaseExpression(assetEvidence.sourceSimulationId, (row) => row.sourceSimulationId),
        sourceInjectId: buildCaseExpression(assetEvidence.sourceInjectId, (row) => row.sourceInjectId),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
        updatedAt: sql`now()` as unknown as Date,
      })
      .where(inArray(assetEvidence.id, rows.map((row) => row.id)));
  },
  insertEvidenceHistoryBatch: async ({ db }, rows: Array<typeof assetEvidenceHistory.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(assetEvidenceHistory).values(rows);
  },
  insertEvidenceVerdictBatch: async ({ db }, rows: Array<typeof assetEvidenceVerdicts.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(assetEvidenceVerdicts).values(rows);
  },
  /** When each of these findings was last handed back to its connectors, for those ever handed back. */
  findLatestResetsByEvidenceIds: ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return Promise.resolve([]);
    }
    // bounded-by: the given findings, whose history holds a row per change the connectors derive and per person decision
    return db
      .selectDistinctOn([views.assetEvidenceHistory.assetEvidenceId], {
        assetEvidenceId: views.assetEvidenceHistory.assetEvidenceId,
        stateChangedAt: views.assetEvidenceHistory.stateChangedAt,
      })
      .from(views.assetEvidenceHistory)
      .where(and(
        inArray(views.assetEvidenceHistory.assetEvidenceId, evidenceIds),
        eq(views.assetEvidenceHistory.origin, 'reset'),
      ))
      .orderBy(views.assetEvidenceHistory.assetEvidenceId, desc(views.assetEvidenceHistory.stateChangedAt));
  },
  findLatestStatesByEvidenceIds: ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return Promise.resolve([]);
    }
    // bounded-by: the given findings, whose history holds a row per change the connectors derive and per person decision
    return db
      .selectDistinctOn([views.assetEvidenceHistory.assetEvidenceId], {
        assetEvidenceId: views.assetEvidenceHistory.assetEvidenceId,
        state: views.assetEvidenceHistory.state,
        stateChangedAt: views.assetEvidenceHistory.stateChangedAt,
        changedByUserId: views.assetEvidenceHistory.changedByUserId,
        origin: views.assetEvidenceHistory.origin,
      })
      .from(views.assetEvidenceHistory)
      .where(inArray(views.assetEvidenceHistory.assetEvidenceId, evidenceIds))
      .orderBy(views.assetEvidenceHistory.assetEvidenceId, desc(views.assetEvidenceHistory.stateChangedAt), desc(views.assetEvidenceHistory.id));
  },
  /** One row per `sourceTagId` already known to this connector, keyed for the resolution to read before it writes. */
  findTagSourcesForConnector: async (
    { db, views },
    connectorId: string,
    sourceTagIds: Array<string>,
  ): Promise<Map<string, { id: string, tagId: string, reportedName: string, reportedColor: string | null }>> => {
    if (sourceTagIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ id: views.tagSources.id, tagId: views.tagSources.tagId, sourceTagId: views.tagSources.sourceTagId, reportedName: views.tagSources.reportedName, reportedColor: views.tagSources.reportedColor })
      .from(views.tagSources)
      .where(and(eq(views.tagSources.connectorId, connectorId), inArray(views.tagSources.sourceTagId, sourceTagIds)));
    return new Map(rows.map((row) => [row.sourceTagId!, { id: row.id, tagId: row.tagId, reportedName: row.reportedName, reportedColor: row.reportedColor }]));
  },
  /**
   * How many origins each of these tags still has — what tells a rename whether it may rewrite the
   * tag in place or must split off a new one. Only origins that can still speak are counted: a
   * connector origin whose connector was deleted keeps its row (with `connectorId` set null) and
   * its asset links, but no resync will ever reach it again, so counting it would make every later
   * rename split off a duplicate and strand the tag it left. A manual origin has no `sourceTagId`,
   * which is what tells it apart from that dead row.
   */
  countTagSourcesByTagIds: async ({ db, views }, tagIds: Array<string>): Promise<Map<string, number>> => {
    if (tagIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ tagId: views.tagSources.tagId, originCount: count() })
      .from(views.tagSources)
      .where(and(
        inArray(views.tagSources.tagId, tagIds),
        or(isNotNull(views.tagSources.connectorId), isNull(views.tagSources.sourceTagId)),
      ))
      .groupBy(views.tagSources.tagId);
    return new Map(rows.map((row) => [row.tagId, row.originCount]));
  },
  /** The tenant's canonical tag for each of these names, if one already exists — what an unknown origin or a rename reconciles against. */
  findTagsByNames: async ({ db, views }, names: Array<string>): Promise<Map<string, string>> => {
    if (names.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ id: views.tags.id, name: views.tags.name })
      .from(views.tags)
      .where(inArray(views.tags.name, names));
    return new Map(rows.map((row) => [row.name, row.id]));
  },
  insertTag: async ({ db }, row: typeof tags.$inferInsert) => {
    await db.insert(tags).values([row]);
  },
  insertTagSource: async ({ db }, row: typeof tagSources.$inferInsert) => {
    await db.insert(tagSources).values([row]);
  },
  /**
   * Each of these tags' own manual origin, if it has one (`tag_sources_manual_per_tag_uq`
   * guarantees at most one) — what tells a person's tag entry apart from one already attached
   * only through a connector. With `pushedByXtmOne`, the origin an XTM One push gave it instead.
   */
  findManualTagSourcesByTagIds: async ({ db, views }, tagIds: Array<string>, pushedByXtmOne = false): Promise<Map<string, { id: string, reportedName: string }>> => {
    if (tagIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ id: views.tagSources.id, tagId: views.tagSources.tagId, reportedName: views.tagSources.reportedName })
      .from(views.tagSources)
      .where(and(
        inArray(views.tagSources.tagId, tagIds),
        isNull(views.tagSources.connectorId),
        isNull(views.tagSources.sourceTagId),
        eq(views.tagSources.pushedByXtmOne, pushedByXtmOne),
      ));
    return new Map(rows.map((row) => [row.tagId, { id: row.id, reportedName: row.reportedName }]));
  },
  /**
   * The tenant's whole tag vocabulary, merged tags included, not just what an asset already carries.
   * Same colour tie-break as `findTagsByAssetIds`: the newest origin reporting one wins.
   */
  findAllTags: (ctx) => selectTagVocabulary(ctx),
  findTagsByIds: (ctx, tagIds: Array<string>) => {
    if (tagIds.length === 0) {
      return Promise.resolve([]);
    }
    return selectTagVocabulary(ctx, inArray(ctx.views.tags.id, tagIds));
  },
  /** tagId → the tag it is merged into, for the merged tags only. */
  findMergedTagPointers: async ({ db, views }): Promise<Map<string, string>> => {
    const rows = await db
      .select({ id: views.tags.id, mergedIntoTagId: views.tags.mergedIntoTagId })
      .from(views.tags)
      .where(isNotNull(views.tags.mergedIntoTagId));
    return new Map(rows.map((row) => [row.id, row.mergedIntoTagId!]));
  },
  /** Every origin of every tag, with the source of the connector that gave it; a deleted connector leaves `connectorSource` null. */
  findTagOriginsWithConnector: ({ db, views }) =>
    db
      .select({
        tagId: views.tagSources.tagId,
        connectorId: views.tagSources.connectorId,
        sourceTagId: views.tagSources.sourceTagId,
        reportedName: views.tagSources.reportedName,
        pushedByXtmOne: views.tagSources.pushedByXtmOne,
        connectorSource: views.integrationSettings.source,
      })
      .from(views.tagSources)
      .leftJoin(views.integrationSettings, eq(views.integrationSettings.id, views.tagSources.connectorId)),
  /** Distinct assets per tag, whoever linked them. */
  countAssetsByTagIds: async ({ db, views }): Promise<Map<string, number>> => {
    const rows = await db
      .select({ tagId: views.supportingAssetTags.tagId, assetCount: countDistinct(views.supportingAssetTags.supportingAssetId) })
      .from(views.supportingAssetTags)
      .groupBy(views.supportingAssetTags.tagId);
    return new Map(rows.map((row) => [row.tagId, row.assetCount]));
  },
  findTagAssetLinks: ({ db, views }, tagIds: Array<string>): Promise<Array<{ tagId: string, supportingAssetId: string }>> => {
    if (tagIds.length === 0) {
      return Promise.resolve([]);
    }
    return db
      .selectDistinct({ tagId: views.supportingAssetTags.tagId, supportingAssetId: views.supportingAssetTags.supportingAssetId })
      .from(views.supportingAssetTags)
      .where(inArray(views.supportingAssetTags.tagId, tagIds));
  },
  /**
   * Serialises the merges and the orphan cleanups touching these tags: two crossed merges (A into B,
   * B into A) each pass the check on the pointers they read, and committed together they would leave
   * a cycle.
   */
  lockTags: (ctx, tagIds: Array<string>) => lockTagRows(ctx, tagIds),
  setTagMergedInto: async ({ db }, tagId: string, mergedIntoTagId: string | null, mergedAt: Date | null) => {
    await db.update(tags).set({ mergedIntoTagId, mergedAt }).where(eq(tags.id, tagId));
  },
  /** Cascades remove the tags merged into this one, and every link and origin of them all. */
  deleteTag: async ({ db }, tagId: string) => {
    await db.delete(tags).where(eq(tags.id, tagId));
  },
  updateTagName: async ({ db }, tagId: string, name: string) => {
    await db.update(tags).set({ name }).where(eq(tags.id, tagId));
  },
  /** Refreshes an origin's own record, and reattaches it to a different canonical tag when `tagId` is given (a split or a merge). */
  updateTagSource: async (
    { db },
    tagSourceId: string,
    values: { tagId?: string, reportedName: string, reportedColor: string | null },
  ) => {
    await db.update(tagSources).set(values).where(eq(tagSources.id, tagSourceId));
  },
  /**
   * Deletes a tag a merge left with no origin — a split never does, since it only fires when the
   * tag has another origin left behind. Returns whether the row is gone, which is what tells the
   * caller it may stop offering that tag's name: a tag still holding an origin keeps its name, and
   * forgetting it would send the next source tag of that name into a duplicate insert. A tag other
   * tags are merged into is kept too, since the delete would cascade to all of them.
   */
  deleteTagIfOrphan: async (ctx, tagId: string): Promise<boolean> => {
    const { db, views } = ctx;
    await lockTagRows(ctx, [tagId]);
    const [remaining] = await db.select({ originCount: count() }).from(views.tagSources).where(eq(views.tagSources.tagId, tagId));
    if ((remaining?.originCount ?? 0) > 0) {
      return false;
    }
    const [mergedInto] = await db.select({ mergedCount: count() }).from(views.tags).where(eq(views.tags.mergedIntoTagId, tagId));
    if ((mergedInto?.mergedCount ?? 0) > 0) {
      return false;
    }
    await db.delete(tags).where(eq(tags.id, tagId));
    return true;
  },
  /**
   * Replaces, never accumulates, the tags **this connector** asserted on every asset in the batch
   * (`null` for a manual caller or an XTM One push, told apart by `pushedByXtmOne`): a tag OpenAEV removed must disappear here too, but another
   * author's own links must not — only rows carrying this same author are compared, including
   * for an asset whose `tagIds` is now empty, which is what clears this connector's tags down to
   * none rather than leaving the last-known set stuck.
   *
   * Written as a diff, never delete-then-insert: a link the new set keeps is not touched, so an
   * unchanged set writes no row and a link keeps its id. A second row for a kept (asset, tag) —
   * which only a null author can hold, since nulls are distinct in the unique key — is swept with
   * the stale ones. `onConflictDoNothing` on the insert: two authors of the same tag on the same
   * asset are two separate rows, not one fighting over authorship.
   */
  setAssetTagsBatch: async (
    { db, views },
    tenantId: string,
    connectorId: string | null,
    entries: Array<{ supportingAssetId: string, tagIds: Array<string> }>,
    pushedByXtmOne = false,
  ) => {
    if (entries.length === 0) {
      return;
    }
    const wantedByAssetId = new Map<string, Set<string>>();
    for (const entry of entries) {
      const wanted = wantedByAssetId.get(entry.supportingAssetId) ?? new Set<string>();
      entry.tagIds.forEach((tagId) => wanted.add(tagId));
      wantedByAssetId.set(entry.supportingAssetId, wanted);
    }
    const held = await db
      .select({ id: views.supportingAssetTags.id, supportingAssetId: views.supportingAssetTags.supportingAssetId, tagId: views.supportingAssetTags.tagId })
      .from(views.supportingAssetTags)
      .where(and(
        inArray(views.supportingAssetTags.supportingAssetId, [...wantedByAssetId.keys()]),
        connectorId === null ? isNull(views.supportingAssetTags.connectorId) : eq(views.supportingAssetTags.connectorId, connectorId),
        eq(views.supportingAssetTags.pushedByXtmOne, connectorId === null && pushedByXtmOne),
      ));
    const kept = new Set<string>();
    const staleLinkIds: Array<string> = [];
    for (const link of held) {
      const key = `${link.supportingAssetId}::${link.tagId}`;
      if (wantedByAssetId.get(link.supportingAssetId)?.has(link.tagId) === true && !kept.has(key)) {
        kept.add(key);
      } else {
        staleLinkIds.push(link.id);
      }
    }
    if (staleLinkIds.length > 0) {
      // eslint-disable-next-line app/no-unguarded-rewrite -- a diff written by hand: only the stale links are deleted and only the missing ones inserted
      await db.delete(supportingAssetTags).where(inArray(supportingAssetTags.id, staleLinkIds));
    }
    const rows = [...wantedByAssetId].flatMap(([supportingAssetId, wanted]) => [...wanted]
      .filter((tagId) => !kept.has(`${supportingAssetId}::${tagId}`))
      .map((tagId) => ({ id: uuidv7(), tenantId, supportingAssetId, tagId, connectorId, pushedByXtmOne: connectorId === null && pushedByXtmOne })));
    if (rows.length > 0) {
      await db.insert(supportingAssetTags).values(rows).onConflictDoNothing({
        target: [supportingAssetTags.supportingAssetId, supportingAssetTags.tagId, supportingAssetTags.connectorId, supportingAssetTags.pushedByXtmOne],
      });
    }
  },
  /** The description, url and linked person the connector's sources among the given ids report; an id with no source is absent. */
  findReportedOverviewFieldsBySourceAssetIds: ({ db, views }, connectorId: string, sourceAssetIds: Array<string>) =>
    db
      .select({
        sourceAssetId: views.supportingAssetSources.sourceAssetId,
        reportedDescription: views.supportingAssetSources.reportedDescription,
        reportedUrl: views.supportingAssetSources.reportedUrl,
        reportedLinkedPerson: views.supportingAssetSources.reportedLinkedPerson,
      })
      .from(views.supportingAssetSources)
      .where(and(
        eq(views.supportingAssetSources.connectorId, connectorId),
        inArray(views.supportingAssetSources.sourceAssetId, sourceAssetIds),
      )),
  /**
   * Sets the description, url and linked person on the connector's own sources, one statement per
   * chunk, and returns the canonical asset ids of the sources it changed. A source already holding
   * all three values is not rewritten, so its `updated_at` and its change notification stay where
   * they were. The caller passes each source asset id once: a `CASE` over a repeated id would keep
   * one branch arbitrarily.
   */
  updateSourceReportedOverviewFields: async (
    { db },
    connectorId: string,
    entries: Array<{ sourceAssetId: string, description: string | null, url: string | null, linkedPerson: string | null }>,
  ): Promise<Array<string>> => {
    const changedAssetIds = new Set<string>();
    for (let i = 0; i < entries.length; i += REPROJECT_CHUNK_SIZE) {
      const chunk = entries.slice(i, i + REPROJECT_CHUNK_SIZE);
      const caseOf = (getValue: (entry: typeof chunk[number]) => string | null) => sql`
        case ${supportingAssetSources.sourceAssetId}
        ${sql.join(chunk.map((entry) => sql`when ${entry.sourceAssetId} then ${getValue(entry)}::text`), sql` `)}
        end
      `;
      const written = {
        reportedDescription: caseOf((entry) => entry.description),
        reportedUrl: caseOf((entry) => entry.url),
        reportedLinkedPerson: caseOf((entry) => entry.linkedPerson),
      };
      const changed = await db.update(supportingAssetSources).set({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: CASE expressions carry no column type
        reportedDescription: written.reportedDescription as unknown as string | null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: CASE expressions carry no column type
        reportedUrl: written.reportedUrl as unknown as string | null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: CASE expressions carry no column type
        reportedLinkedPerson: written.reportedLinkedPerson as unknown as string | null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
        updatedAt: sql`now()` as unknown as Date,
      }).where(and(
        eq(supportingAssetSources.connectorId, connectorId),
        inArray(supportingAssetSources.sourceAssetId, chunk.map((entry) => entry.sourceAssetId)),
        // `updated_at` is what the write sets, so it stays out of the comparison.
        sql`(${supportingAssetSources.reportedDescription}, ${supportingAssetSources.reportedUrl}, ${supportingAssetSources.reportedLinkedPerson})
          is distinct from (${written.reportedDescription}, ${written.reportedUrl}, ${written.reportedLinkedPerson})`,
      )).returning();
      for (const row of changed) {
        changedAssetIds.add(row.supportingAssetId);
      }
    }
    return [...changedAssetIds];
  },
  /**
   * `sourceAssetId → supportingAssetId` for one connector, read back from what was already
   * written — what a resumed sync rebuilds its inventory map from, instead of carrying that map
   * through every state snapshot of the run.
   */
  findSourceAssetIdMapForConnector: ({ db, views }, connectorId: string) =>
    db
      .select({
        sourceAssetId: views.supportingAssetSources.sourceAssetId,
        supportingAssetId: views.supportingAssetSources.supportingAssetId,
      })
      .from(views.supportingAssetSources)
      .where(eq(views.supportingAssetSources.connectorId, connectorId)),
  /** Every asset group of the tenant, with what a push or a resync matches it on. */
  findAssetGroups: ({ db, views }) =>
    db
      .select({
        id: views.assetGroups.id,
        name: views.assetGroups.name,
        description: views.assetGroups.description,
        externalReference: views.assetGroups.externalReference,
        connectorId: views.assetGroups.connectorId,
        sourceGroupId: views.assetGroups.sourceGroupId,
      })
      .from(views.assetGroups)
      .orderBy(asc(views.assetGroups.name), asc(views.assetGroups.id)),
  insertAssetGroup: async ({ db }, row: typeof assetGroups.$inferInsert) => {
    await db.insert(assetGroups).values([row]);
  },
  /** Writes only when a value changes, so an unchanged resync leaves `updated_at` and its notification alone. */
  updateAssetGroup: async ({ db }, id: string, values: { name?: string, description?: string | null, externalReference?: string | null }) => {
    if (values.name === undefined && values.description === undefined && values.externalReference === undefined) {
      return;
    }
    await db.update(assetGroups).set({
      name: values.name,
      description: values.description,
      externalReference: values.externalReference,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
      updatedAt: sql`now()` as unknown as Date,
    }).where(eq(assetGroups.id, id));
  },
  deleteAssetGroups: async ({ db }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    await db.delete(assetGroups).where(inArray(assetGroups.id, ids));
  },
  /**
   * The membership rows one author holds: a connector's (`connectorId` set) or a non-connector
   * source's, narrowed to the given assets when `supportingAssetIds` is passed.
   */
  findGroupMembershipsOfAuthor: ({ db, views }, author: { source: 'manual' | 'xtm_one' } | { source: 'connector', connectorId: string }, supportingAssetIds?: Array<string>) =>
    db
      .select({
        id: views.assetGroupMembers.id,
        assetGroupId: views.assetGroupMembers.assetGroupId,
        supportingAssetId: views.assetGroupMembers.supportingAssetId,
      })
      .from(views.assetGroupMembers)
      .where(and(
        eq(views.assetGroupMembers.source, author.source),
        author.source === 'connector' ? eq(views.assetGroupMembers.connectorId, author.connectorId) : isNull(views.assetGroupMembers.connectorId),
        supportingAssetIds === undefined ? undefined : inArray(views.assetGroupMembers.supportingAssetId, supportingAssetIds),
      )),
  deleteGroupMembers: async ({ db }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    await db.delete(assetGroupMembers).where(inArray(assetGroupMembers.id, ids));
  },
  insertGroupMembers: async ({ db }, rows: Array<typeof assetGroupMembers.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(assetGroupMembers).values(rows).onConflictDoNothing({
      target: [assetGroupMembers.assetGroupId, assetGroupMembers.supportingAssetId, assetGroupMembers.source, assetGroupMembers.connectorId],
    });
  },
  /** The groups each of these assets belongs to, whoever asserted it, one row per (asset, group). */
  findGroupsByAssetIds: async ({ db, views }, assetIds: Array<string>): Promise<Array<{ supportingAssetId: string, id: string, name: string }>> => {
    if (assetIds.length === 0) {
      return [];
    }
    return db
      .selectDistinct({
        supportingAssetId: views.assetGroupMembers.supportingAssetId,
        id: views.assetGroups.id,
        name: views.assetGroups.name,
      })
      .from(views.assetGroupMembers)
      .innerJoin(views.assetGroups, eq(views.assetGroups.id, views.assetGroupMembers.assetGroupId))
      .where(inArray(views.assetGroupMembers.supportingAssetId, assetIds))
      .orderBy(asc(views.assetGroups.name));
  },
  /** Distinct assets per group, whoever asserted the membership. */
  countAssetsByGroup: async ({ db, views }): Promise<Map<string, number>> => {
    const rows = await db
      .select({ assetGroupId: views.assetGroupMembers.assetGroupId, assets: countDistinct(views.assetGroupMembers.supportingAssetId) })
      .from(views.assetGroupMembers)
      .groupBy(views.assetGroupMembers.assetGroupId);
    return new Map(rows.map((row) => [row.assetGroupId, Number(row.assets)]));
  },
});
