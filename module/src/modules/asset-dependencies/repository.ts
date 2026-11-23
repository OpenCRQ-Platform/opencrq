import type { SQL } from 'drizzle-orm';
import { and, asc, count, eq, exists, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';
import type { SeverityBand } from '../finding-score/bands';
import type { SupportToPrimaryLinkRole } from './link-roles';
import type { DependencyRuleConditions } from './rule-matching';
import type { PrimaryToPrimaryLinkStrength } from './link-strengths';
import type { ReachRow } from './reach';
import { inUuids, notInUuids } from '../../db/uuid-array';
import { defineRepository } from '../../registry';
import { namePatternRegex } from './rule-matching';
import { dependencyRules, dependencyRuleSuppressions, primaryAssetReach, primaryToPrimaryLinks, supportToPrimaryLinks, supportToSupportLinks } from './schema';

/**
 * What a supporting asset has to hold for a rule to match it: every condition the rule sets. The
 * pattern reads the display name and each hostname a source reports; a tag reads its merges too.
 */
const ruleMatchConditions = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, conditions: DependencyRuleConditions): Array<SQL> => {
  const where: Array<SQL> = [];
  if (conditions.categoryId !== null) {
    where.push(sql`${views.supportingAssets.categoryId} = ${conditions.categoryId}`);
  }
  if (conditions.subcategoryId !== null) {
    where.push(sql`${views.supportingAssets.subcategoryId} = ${conditions.subcategoryId}`);
  }
  const regex = namePatternRegex(conditions.namePattern, conditions.namePatternKind);
  if (regex !== null) {
    where.push(or(
      sql`${views.supportingAssets.displayName} ~* ${regex}`,
      exists(db.select({ matched: sql`1` }).from(views.supportingAssetSources)
        .innerJoin(views.supportingAssetMachineProperties, eq(views.supportingAssetMachineProperties.supportingAssetSourceId, views.supportingAssetSources.id))
        .where(and(
          eq(views.supportingAssetSources.supportingAssetId, views.supportingAssets.id),
          sql`${views.supportingAssetMachineProperties.hostname} ~* ${regex}`,
        ))),
    )!);
  }
  if (conditions.tagId !== null) {
    where.push(exists(db.select({ matched: sql`1` }).from(views.supportingAssetTags)
      .innerJoin(views.tags, eq(views.tags.id, views.supportingAssetTags.tagId))
      .where(and(
        eq(views.supportingAssetTags.supportingAssetId, views.supportingAssets.id),
        or(eq(views.tags.id, conditions.tagId), eq(views.tags.mergedIntoTagId, conditions.tagId)),
      ))));
  }
  if (conditions.source !== null) {
    where.push(exists(db.select({ matched: sql`1` }).from(views.supportingAssetSources)
      .innerJoin(views.integrationSettings, eq(views.integrationSettings.id, views.supportingAssetSources.connectorId))
      .where(and(
        eq(views.supportingAssetSources.supportingAssetId, views.supportingAssets.id),
        sql`${views.integrationSettings.source} = ${conditions.source}`,
      ))));
  }
  return where;
};

export const assetDependenciesRepository = defineRepository({
  /** The ids among `ids` of the primary assets the caller can see. */
  findVisiblePrimaryAssetIds: async ({ db, views }, ids: ReadonlyArray<string>) => {
    const unique = [...new Set(ids)];
    const found = unique.length === 0 ? [] : await db.select({ id: views.primaryAssets.id }).from(views.primaryAssets)
      .where(inArray(views.primaryAssets.id, unique));
    return new Set(found.map((row) => row.id));
  },
  findVisiblePrimaryAssetOrganizations: async ({ db, views }, ids: ReadonlyArray<string>) => {
    const unique = [...new Set(ids)];
    const found = unique.length === 0 ? [] : await db.select({ id: views.primaryAssets.id, organizationId: views.primaryAssets.organizationId })
      .from(views.primaryAssets)
      .where(inArray(views.primaryAssets.id, unique));
    return new Map(found.map((row) => [row.id, row.organizationId]));
  },
  /** The ids among `ids` of the supporting assets the caller can see. */
  findVisibleSupportingAssetIds: async ({ db, views }, ids: ReadonlyArray<string>) => {
    const unique = [...new Set(ids)];
    const found = unique.length === 0 ? [] : await db.select({ id: views.supportingAssets.id }).from(views.supportingAssets)
      .where(inArray(views.supportingAssets.id, unique));
    return new Set(found.map((row) => row.id));
  },

  /** The ids of the rows inserted: a row whose pair is already linked is left out, the stored link kept. */
  insertSupportToPrimaryLinks: async ({ db }, values: Array<typeof supportToPrimaryLinks.$inferInsert>) =>
    (await db.insert(supportToPrimaryLinks).values(values)
      .onConflictDoNothing({ target: [supportToPrimaryLinks.supportingAssetId, supportToPrimaryLinks.primaryAssetId] })
      .returning()).map((row) => row.id),
  /**
   * The ids of the links updated, which leaves out one gone or out of the caller's reach. A person's
   * edit of a rule link makes it theirs: no rule rewrites or removes it afterwards.
   */
  updateSupportToPrimaryLinkRoles: async ({ db }, ids: Array<string>, roles: Array<SupportToPrimaryLinkRole>) =>
    (await db.update(supportToPrimaryLinks).set({ roles, ruleId: null }).where(inArray(supportToPrimaryLinks.id, ids)).returning())
      .map((row) => row.id),
  deleteSupportToPrimaryLinks: ({ db }, ids: Array<string>) =>
    db.delete(supportToPrimaryLinks).where(inArray(supportToPrimaryLinks.id, ids)),
  findSupportToPrimaryLinksBySupportingAssetId: async ({ db, views }, supportingAssetId: string) =>
    db.select({
      id: views.supportToPrimaryLinks.id,
      supportingAssetId: views.supportToPrimaryLinks.supportingAssetId,
      primaryAssetId: views.supportToPrimaryLinks.primaryAssetId,
      roles: views.supportToPrimaryLinks.roles,
      ruleId: views.supportToPrimaryLinks.ruleId,
      ruleName: views.dependencyRules.name,
      primaryAssetName: views.primaryAssets.name,
      organizationName: views.organizations.name,
    }).from(views.supportToPrimaryLinks)
      .leftJoin(views.primaryAssets, eq(views.supportToPrimaryLinks.primaryAssetId, views.primaryAssets.id))
      .leftJoin(views.organizations, eq(views.primaryAssets.organizationId, views.organizations.id))
      .leftJoin(views.dependencyRules, eq(views.supportToPrimaryLinks.ruleId, views.dependencyRules.id))
      .where(eq(views.supportToPrimaryLinks.supportingAssetId, supportingAssetId)),
  findSupportToPrimaryLinksByPrimaryAssetId: async ({ db, views }, primaryAssetId: string) =>
    db.select({
      id: views.supportToPrimaryLinks.id,
      supportingAssetId: views.supportToPrimaryLinks.supportingAssetId,
      primaryAssetId: views.supportToPrimaryLinks.primaryAssetId,
      roles: views.supportToPrimaryLinks.roles,
      ruleId: views.supportToPrimaryLinks.ruleId,
      ruleName: views.dependencyRules.name,
      supportingAssetName: views.supportingAssets.name,
      supportingAssetDerivedName: views.supportingAssets.derivedName,
      supportingAssetCategoryId: views.supportingAssets.categoryId,
    }).from(views.supportToPrimaryLinks)
      .leftJoin(views.supportingAssets, eq(views.supportToPrimaryLinks.supportingAssetId, views.supportingAssets.id))
      .leftJoin(views.dependencyRules, eq(views.supportToPrimaryLinks.ruleId, views.dependencyRules.id))
      .where(eq(views.supportToPrimaryLinks.primaryAssetId, primaryAssetId)),

  /** The pairs of the links among `ids` the caller can see, so a person's removal can be kept. */
  findLinkPairsAmong: async ({ db, views }, ids: ReadonlyArray<string>) => {
    if (ids.length === 0) {
      return [];
    }
    return db.select({
      tenantId: views.supportToPrimaryLinks.tenantId,
      supportingAssetId: views.supportToPrimaryLinks.supportingAssetId,
      primaryAssetId: views.supportToPrimaryLinks.primaryAssetId,
    }).from(views.supportToPrimaryLinks)
      .where(inUuids(views.supportToPrimaryLinks.id, ids));
  },
  /** A person linking a pair a rule holds takes the link over, its roles kept. */
  claimRuleLinksOfPairs: async ({ db }, pairs: ReadonlyArray<{ supportingAssetId: string, primaryAssetId: string }>) => {
    if (pairs.length === 0) {
      return;
    }
    await db.update(supportToPrimaryLinks).set({ ruleId: null }).where(and(
      isNotNull(supportToPrimaryLinks.ruleId),
      or(...pairs.map((pair) => and(
        eq(supportToPrimaryLinks.supportingAssetId, pair.supportingAssetId),
        eq(supportToPrimaryLinks.primaryAssetId, pair.primaryAssetId),
      ))),
    ));
  },
  insertRuleSuppressions: async ({ db }, rows: Array<typeof dependencyRuleSuppressions.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(dependencyRuleSuppressions).values(rows).onConflictDoNothing();
  },

  listDependencyRules: ({ db, views }) =>
    db.select({
      id: views.dependencyRules.id,
      name: views.dependencyRules.name,
      primaryAssetId: views.dependencyRules.primaryAssetId,
      primaryAssetName: views.primaryAssets.name,
      roles: views.dependencyRules.roles,
      enabled: views.dependencyRules.enabled,
      categoryId: views.dependencyRules.categoryId,
      subcategoryId: views.dependencyRules.subcategoryId,
      namePattern: views.dependencyRules.namePattern,
      namePatternKind: views.dependencyRules.namePatternKind,
      tagId: views.dependencyRules.tagId,
      tagName: views.tags.name,
      source: views.dependencyRules.source,
    }).from(views.dependencyRules)
      .innerJoin(views.primaryAssets, eq(views.dependencyRules.primaryAssetId, views.primaryAssets.id))
      .leftJoin(views.tags, eq(views.dependencyRules.tagId, views.tags.id))
      .orderBy(asc(views.dependencyRules.name), asc(views.dependencyRules.id)),
  countRuleLinks: async ({ db, views }) => {
    const rows = await db.select({ ruleId: views.supportToPrimaryLinks.ruleId, linkCount: count() })
      .from(views.supportToPrimaryLinks)
      .where(isNotNull(views.supportToPrimaryLinks.ruleId))
      .groupBy(views.supportToPrimaryLinks.ruleId);
    return new Map(rows.map((row) => [row.ruleId!, row.linkCount]));
  },
  findDependencyRule: async ({ db, views }, id: string) => {
    const [row] = await db.select({
      id: views.dependencyRules.id,
      name: views.dependencyRules.name,
      primaryAssetId: views.dependencyRules.primaryAssetId,
      roles: views.dependencyRules.roles,
      enabled: views.dependencyRules.enabled,
      categoryId: views.dependencyRules.categoryId,
      subcategoryId: views.dependencyRules.subcategoryId,
      namePattern: views.dependencyRules.namePattern,
      namePatternKind: views.dependencyRules.namePatternKind,
      tagId: views.dependencyRules.tagId,
      source: views.dependencyRules.source,
    }).from(views.dependencyRules).where(eq(views.dependencyRules.id, id));
    return row ?? null;
  },
  insertDependencyRule: async ({ db }, value: typeof dependencyRules.$inferInsert) => {
    await db.insert(dependencyRules).values(value);
  },
  /** False when the rule is gone or out of the caller's reach. */
  updateDependencyRule: async ({ db }, id: string, value: Omit<Partial<typeof dependencyRules.$inferInsert>, 'id' | 'tenantId'>) =>
    (await db.update(dependencyRules).set({ ...value, updatedAt: new Date() }).where(eq(dependencyRules.id, id)).returning()).length > 0,
  /** Its links cascade with it; the links a person took over are theirs and stay. */
  deleteDependencyRules: async ({ db }, ids: ReadonlyArray<string>) => {
    if (ids.length === 0) {
      return;
    }
    await db.delete(dependencyRules).where(inUuids(dependencyRules.id, ids));
  },

  /** The supporting assets among `ids`, by display name, for a preview's list. */
  findPreviewAssets: async ({ db, views }, ids: ReadonlyArray<string>, limit: number) => {
    if (ids.length === 0) {
      return [];
    }
    return db.select({
      id: views.supportingAssets.id,
      name: views.supportingAssets.name,
      derivedName: views.supportingAssets.derivedName,
      categoryId: views.supportingAssets.categoryId,
      subcategoryId: views.supportingAssets.subcategoryId,
    }).from(views.supportingAssets).where(inUuids(views.supportingAssets.id, ids))
      .orderBy(asc(views.supportingAssets.displayNameFolded), asc(views.supportingAssets.id))
      .limit(limit);
  },
  /** The supporting assets no rule may link to `primaryAssetId`: a person linked or unlinked the pair. */
  findRuleBlockedSupportingAssetIdsOf: async ({ db, views }, primaryAssetId: string) => {
    const [manual, suppressed] = await Promise.all([
      db.select({ id: views.supportToPrimaryLinks.supportingAssetId }).from(views.supportToPrimaryLinks)
        .where(and(eq(views.supportToPrimaryLinks.primaryAssetId, primaryAssetId), isNull(views.supportToPrimaryLinks.ruleId))),
      db.select({ id: views.dependencyRuleSuppressions.supportingAssetId }).from(views.dependencyRuleSuppressions)
        .where(eq(views.dependencyRuleSuppressions.primaryAssetId, primaryAssetId)),
    ]);
    return {
      manual: new Set(manual.map((row) => row.id)),
      suppressed: new Set(suppressed.map((row) => row.id)),
    };
  },
  /** Every supporting asset a rule's conditions match, for the apply pass. */
  findDependencyRuleMatchIds: async (ctx, conditions: DependencyRuleConditions) => {
    const { db, views } = ctx;
    const rows = await db.select({ id: views.supportingAssets.id }).from(views.supportingAssets)
      .where(and(...ruleMatchConditions(ctx, conditions)));
    return rows.map((row) => row.id);
  },
  findEnabledDependencyRules: ({ db, views }) =>
    db.select({
      id: views.dependencyRules.id,
      name: views.dependencyRules.name,
      primaryAssetId: views.dependencyRules.primaryAssetId,
      roles: views.dependencyRules.roles,
      categoryId: views.dependencyRules.categoryId,
      subcategoryId: views.dependencyRules.subcategoryId,
      namePattern: views.dependencyRules.namePattern,
      namePatternKind: views.dependencyRules.namePatternKind,
      tagId: views.dependencyRules.tagId,
      source: views.dependencyRules.source,
    }).from(views.dependencyRules).where(eq(views.dependencyRules.enabled, true)),
  /** Every support-to-primary link of the tenant, with the rule that wrote it, for the apply pass. */
  findAllSupportToPrimaryLinksForRules: ({ db, views }) =>
    db.select({
      id: views.supportToPrimaryLinks.id,
      supportingAssetId: views.supportToPrimaryLinks.supportingAssetId,
      primaryAssetId: views.supportToPrimaryLinks.primaryAssetId,
      roles: views.supportToPrimaryLinks.roles,
      ruleId: views.supportToPrimaryLinks.ruleId,
    }).from(views.supportToPrimaryLinks),
  findRuleSuppressions: ({ db, views }) =>
    db.select({
      supportingAssetId: views.dependencyRuleSuppressions.supportingAssetId,
      primaryAssetId: views.dependencyRuleSuppressions.primaryAssetId,
    }).from(views.dependencyRuleSuppressions),
  insertRuleLinks: async ({ db }, values: Array<typeof supportToPrimaryLinks.$inferInsert>) => {
    if (values.length === 0) {
      return;
    }
    await db.insert(supportToPrimaryLinks).values(values)
      .onConflictDoNothing({ target: [supportToPrimaryLinks.supportingAssetId, supportToPrimaryLinks.primaryAssetId] });
  },
  /** Only a rule link moves: one a person took over meanwhile is left as it is. */
  updateRuleLinks: async ({ db }, ids: ReadonlyArray<string>, ruleId: string, roles: Array<SupportToPrimaryLinkRole>) => {
    if (ids.length === 0) {
      return;
    }
    await db.update(supportToPrimaryLinks).set({ ruleId, roles })
      .where(and(inUuids(supportToPrimaryLinks.id, ids), isNotNull(supportToPrimaryLinks.ruleId)));
  },
  deleteRuleLinks: async ({ db }, ids: ReadonlyArray<string>) => {
    if (ids.length === 0) {
      return;
    }
    await db.delete(supportToPrimaryLinks)
      .where(and(inUuids(supportToPrimaryLinks.id, ids), isNotNull(supportToPrimaryLinks.ruleId)));
  },

  /**
   * The first level of the dependency walk below a set of primary assets, carrying everything a node
   * and its panel show so a level costs one query. Kept beside `findSupportToPrimaryLinksByPrimaryAssetId`
   * rather than widening it: the table on the tab reads that one on every render and needs only the
   * name and the category of these columns.
   */
  findSupportToPrimaryLinksForGraph: async ({ db, views }, primaryAssetIds: Array<string>) => {
    if (primaryAssetIds.length === 0) {
      return [];
    }
    return db.select({
      linkId: views.supportToPrimaryLinks.id,
      dependentAssetId: views.supportToPrimaryLinks.primaryAssetId,
      roles: views.supportToPrimaryLinks.roles,
      id: views.supportingAssets.id,
      name: views.supportingAssets.name,
      derivedName: views.supportingAssets.derivedName,
      categoryId: views.supportingAssets.categoryId,
      criticality: views.supportingAssets.criticality,
      exposure: views.supportingAssets.exposure,
      ownerName: views.users.name,
      firstSeenAt: views.supportingAssets.firstSeenAt,
      lastSeenAt: views.supportingAssets.lastSeenAt,
    }).from(views.supportToPrimaryLinks)
      .innerJoin(views.supportingAssets, eq(views.supportToPrimaryLinks.supportingAssetId, views.supportingAssets.id))
      .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
      .where(inUuids(views.supportToPrimaryLinks.primaryAssetId, primaryAssetIds));
  },
  /**
   * The providers of a whole level at once. A transitive closure would be a `WITH RECURSIVE`, which
   * a ProtectedDB blocks, so the walk expands one level per query and the depth is what bounds it.
   */
  findSupportToSupportLinksAsDependentBatch: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({
      linkId: views.supportToSupportLinks.id,
      dependentAssetId: views.supportToSupportLinks.dependentAssetId,
      id: views.supportingAssets.id,
      name: views.supportingAssets.name,
      derivedName: views.supportingAssets.derivedName,
      categoryId: views.supportingAssets.categoryId,
      criticality: views.supportingAssets.criticality,
      exposure: views.supportingAssets.exposure,
      ownerName: views.users.name,
      firstSeenAt: views.supportingAssets.firstSeenAt,
      lastSeenAt: views.supportingAssets.lastSeenAt,
    }).from(views.supportToSupportLinks)
      .innerJoin(views.supportingAssets, eq(views.supportToSupportLinks.providerAssetId, views.supportingAssets.id))
      .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
      .where(inUuids(views.supportToSupportLinks.dependentAssetId, assetIds));
  },
  findSupportingAssetsForGraph: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({
      id: views.supportingAssets.id,
      name: views.supportingAssets.name,
      derivedName: views.supportingAssets.derivedName,
      categoryId: views.supportingAssets.categoryId,
      criticality: views.supportingAssets.criticality,
      exposure: views.supportingAssets.exposure,
      ownerName: views.users.name,
      firstSeenAt: views.supportingAssets.firstSeenAt,
      lastSeenAt: views.supportingAssets.lastSeenAt,
    }).from(views.supportingAssets)
      .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
      .where(inArray(views.supportingAssets.id, assetIds));
  },
  /** The primary assets a whole level of supporting assets serves, for the walk up from a supporting asset. */
  findSupportToPrimaryLinksOfSupportingAssetsBatch: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({
      linkId: views.supportToPrimaryLinks.id,
      supportingAssetId: views.supportToPrimaryLinks.supportingAssetId,
      primaryAssetId: views.primaryAssets.id,
      primaryAssetName: views.primaryAssets.name,
      roles: views.supportToPrimaryLinks.roles,
    }).from(views.supportToPrimaryLinks)
      .innerJoin(views.primaryAssets, eq(views.supportToPrimaryLinks.primaryAssetId, views.primaryAssets.id))
      .where(inUuids(views.supportToPrimaryLinks.supportingAssetId, assetIds));
  },
  findSupportToSupportLinksAsProviderBatch: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({
      linkId: views.supportToSupportLinks.id,
      providerAssetId: views.supportToSupportLinks.providerAssetId,
      id: views.supportingAssets.id,
      name: views.supportingAssets.name,
      derivedName: views.supportingAssets.derivedName,
      categoryId: views.supportingAssets.categoryId,
      criticality: views.supportingAssets.criticality,
      exposure: views.supportingAssets.exposure,
      ownerName: views.users.name,
      firstSeenAt: views.supportingAssets.firstSeenAt,
      lastSeenAt: views.supportingAssets.lastSeenAt,
    }).from(views.supportToSupportLinks)
      .innerJoin(views.supportingAssets, eq(views.supportToSupportLinks.dependentAssetId, views.supportingAssets.id))
      .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
      .where(inUuids(views.supportToSupportLinks.providerAssetId, assetIds));
  },
  findPosturesOf: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({ supportingAssetId: views.assetPostures.supportingAssetId, score: views.assetPostures.score })
      .from(views.assetPostures)
      .where(inUuids(views.assetPostures.supportingAssetId, assetIds));
  },
  /**
   * Counted on the score's band, the one the Findings lists show, so a node and the asset's Findings
   * tab agree. Not the posture's own counts, which bucket on likelihood.
   */
  countCriticalAndHighFindingsOf: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    const inBand = (band: SeverityBand) => sql<number>`(count(*) filter (where ${views.findingScores.band} = ${band}))::int`;
    return db.select({
      supportingAssetId: views.assetEvidence.supportingAssetId,
      critical: inBand('critical'),
      high: inBand('high'),
    }).from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .where(and(
        inUuids(views.assetEvidence.supportingAssetId, assetIds),
        eq(views.assetEvidence.currentState, 'applicable'),
        inArray(views.findingScores.band, ['critical', 'high']),
      ))
      .groupBy(views.assetEvidence.supportingAssetId);
  },
  /** `drawnProviderIds` are the assets the walk already returned: a provider among them is on screen. */
  countProvidersOf: async ({ db, views }, assetIds: Array<string>, drawnProviderIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({
      dependentAssetId: views.supportToSupportLinks.dependentAssetId,
      providerCount: count(),
    }).from(views.supportToSupportLinks)
      .where(and(
        inUuids(views.supportToSupportLinks.dependentAssetId, assetIds),
        drawnProviderIds.length === 0
          ? undefined
          : notInUuids(views.supportToSupportLinks.providerAssetId, drawnProviderIds),
      ))
      .groupBy(views.supportToSupportLinks.dependentAssetId);
  },
  /** Ids only: the part of the chain past the depth is counted, never drawn. */
  findProviderIdsOf: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({ providerAssetId: views.supportToSupportLinks.providerAssetId })
      .from(views.supportToSupportLinks)
      .where(inUuids(views.supportToSupportLinks.dependentAssetId, assetIds));
  },
  findDependentIdsOf: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({ dependentAssetId: views.supportToSupportLinks.dependentAssetId })
      .from(views.supportToSupportLinks)
      .where(inUuids(views.supportToSupportLinks.providerAssetId, assetIds));
  },
  findRelationsTouchingBatch: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    const read = (ownEnd: 'from' | 'to') => {
      const own = ownEnd === 'from' ? views.supportingAssetRelations.fromAssetId : views.supportingAssetRelations.toAssetId;
      const other = ownEnd === 'from' ? views.supportingAssetRelations.toAssetId : views.supportingAssetRelations.fromAssetId;
      return db.select({
        id: views.supportingAssetRelations.id,
        fromAssetId: views.supportingAssetRelations.fromAssetId,
        toAssetId: views.supportingAssetRelations.toAssetId,
        kind: views.supportingAssetRelations.kind,
        source: views.supportingAssetRelations.source,
        firstSeenAt: views.supportingAssetRelations.firstSeenAt,
        lastReportedAt: views.supportingAssetRelations.lastReportedAt,
        otherAsset: {
          id: views.supportingAssets.id,
          name: views.supportingAssets.name,
          derivedName: views.supportingAssets.derivedName,
          categoryId: views.supportingAssets.categoryId,
          criticality: views.supportingAssets.criticality,
          exposure: views.supportingAssets.exposure,
          ownerName: views.users.name,
          firstSeenAt: views.supportingAssets.firstSeenAt,
          lastSeenAt: views.supportingAssets.lastSeenAt,
        },
      }).from(views.supportingAssetRelations)
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, other))
        .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
        .where(inUuids(own, assetIds));
    };
    const [outgoing, incoming] = await Promise.all([read('from'), read('to')]);
    return [...outgoing, ...incoming];
  },
  /** Ids only, from both ends: the relations past the depth are counted, never drawn. */
  findRelatedIdsOf: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return [];
    }
    const [outgoing, incoming] = await Promise.all([
      db.select({ assetId: views.supportingAssetRelations.fromAssetId, relatedId: views.supportingAssetRelations.toAssetId })
        .from(views.supportingAssetRelations)
        .where(inUuids(views.supportingAssetRelations.fromAssetId, assetIds)),
      db.select({ assetId: views.supportingAssetRelations.toAssetId, relatedId: views.supportingAssetRelations.fromAssetId })
        .from(views.supportingAssetRelations)
        .where(inUuids(views.supportingAssetRelations.toAssetId, assetIds)),
    ]);
    return [...outgoing, ...incoming];
  },
  /** The lifts of `assetIds` whose identity is still in the inventory, with what decides whether each gives the band. */
  findCriticalityLiftsOf: async ({ db, views }, assetIds: Array<string>) => {
    if (assetIds.length === 0) {
      return { lifts: [], connectorReadings: [], setByHand: [] };
    }
    const [lifts, connectorReadings, setByHand] = await Promise.all([
      db.select({
        supportingAssetId: views.supportingAssetCriticalityLifts.supportingAssetId,
        criticality: views.supportingAssetCriticalityLifts.criticality,
        fromAssetId: views.supportingAssetCriticalityLifts.fromAssetId,
      }).from(views.supportingAssetCriticalityLifts)
        .where(and(
          inArray(views.supportingAssetCriticalityLifts.supportingAssetId, assetIds),
          isNotNull(views.supportingAssetCriticalityLifts.fromAssetId),
        )),
      db.select({
        supportingAssetId: views.supportingAssetSources.supportingAssetId,
        criticality: views.supportingAssetSources.reportedCriticality,
      }).from(views.supportingAssetSources)
        .where(and(
          inArray(views.supportingAssetSources.supportingAssetId, assetIds),
          eq(views.supportingAssetSources.origin, 'connector'),
        )),
      db.select({ supportingAssetId: views.supportingAssetManualValues.supportingAssetId })
        .from(views.supportingAssetManualValues)
        .where(and(
          inArray(views.supportingAssetManualValues.supportingAssetId, assetIds),
          eq(views.supportingAssetManualValues.attribute, 'criticality'),
        )),
    ]);
    return { lifts, connectorReadings, setByHand };
  },
  /** A row whose pair is already linked is left out: the link carries nothing else to differ on. */
  insertSupportToSupportLinks: ({ db }, values: Array<typeof supportToSupportLinks.$inferInsert>) =>
    db.insert(supportToSupportLinks).values(values)
      .onConflictDoNothing({ target: [supportToSupportLinks.providerAssetId, supportToSupportLinks.dependentAssetId] }),
  deleteSupportToSupportLinks: ({ db }, ids: Array<string>) =>
    db.delete(supportToSupportLinks).where(inArray(supportToSupportLinks.id, ids)),
  findSupportToSupportLinksAsProvider: async ({ db, views }, assetId: string) =>
    db.select({
      id: views.supportToSupportLinks.id,
      providerAssetId: views.supportToSupportLinks.providerAssetId,
      dependentAssetId: views.supportToSupportLinks.dependentAssetId,
      dependentAssetName: views.supportingAssets.name,
      dependentAssetDerivedName: views.supportingAssets.derivedName,
    }).from(views.supportToSupportLinks)
      .leftJoin(views.supportingAssets, eq(views.supportToSupportLinks.dependentAssetId, views.supportingAssets.id))
      .where(eq(views.supportToSupportLinks.providerAssetId, assetId)),
  findSupportToSupportLinksAsDependent: async ({ db, views }, assetId: string) =>
    db.select({
      id: views.supportToSupportLinks.id,
      providerAssetId: views.supportToSupportLinks.providerAssetId,
      dependentAssetId: views.supportToSupportLinks.dependentAssetId,
      providerAssetName: views.supportingAssets.name,
      providerAssetDerivedName: views.supportingAssets.derivedName,
    }).from(views.supportToSupportLinks)
      .leftJoin(views.supportingAssets, eq(views.supportToSupportLinks.providerAssetId, views.supportingAssets.id))
      .where(eq(views.supportToSupportLinks.dependentAssetId, assetId)),

  /** The ids of the rows inserted: a row whose pair is already linked is left out, the stored link kept. */
  insertPrimaryToPrimaryLinks: async ({ db }, values: Array<typeof primaryToPrimaryLinks.$inferInsert>) =>
    (await db.insert(primaryToPrimaryLinks).values(values)
      .onConflictDoNothing({ target: [primaryToPrimaryLinks.dependentAssetId, primaryToPrimaryLinks.providerAssetId] })
      .returning()).map((row) => row.id),
  /** The ids of the links updated, which leaves out one gone or out of the caller's reach. */
  updatePrimaryToPrimaryLinkStrength: async ({ db }, ids: Array<string>, strength: PrimaryToPrimaryLinkStrength) =>
    (await db.update(primaryToPrimaryLinks).set({ strength }).where(inArray(primaryToPrimaryLinks.id, ids)).returning())
      .map((row) => row.id),
  /** Row locks for the rest of the caller's transaction, taken in id order. */
  lockPrimaryToPrimaryLinks: async ({ db, views }, ids: Array<string>) => {
    await db.select({ id: views.primaryToPrimaryLinks.id }).from(views.primaryToPrimaryLinks)
      .where(inArray(views.primaryToPrimaryLinks.id, ids))
      .orderBy(views.primaryToPrimaryLinks.id)
      .for('update');
  },
  deletePrimaryToPrimaryLinks: ({ db }, ids: Array<string>) =>
    db.delete(primaryToPrimaryLinks).where(inArray(primaryToPrimaryLinks.id, ids)),
  /** `ownEnd` is the end `primaryAssetId` sits at. */
  findPrimaryToPrimaryLinksOf: async ({ db, views }, primaryAssetId: string, ownEnd: 'dependent' | 'provider') => {
    const own = ownEnd === 'dependent' ? views.primaryToPrimaryLinks.dependentAssetId : views.primaryToPrimaryLinks.providerAssetId;
    const other = ownEnd === 'dependent' ? views.primaryToPrimaryLinks.providerAssetId : views.primaryToPrimaryLinks.dependentAssetId;
    return db.select({
      id: views.primaryToPrimaryLinks.id,
      relatedAssetId: other,
      relatedAssetName: views.primaryAssets.name,
      strength: views.primaryToPrimaryLinks.strength,
    }).from(views.primaryToPrimaryLinks)
      .innerJoin(views.primaryAssets, eq(views.primaryAssets.id, other))
      .where(eq(own, primaryAssetId));
  },

  findPrimaryAssetsForReach: ({ db, views }) =>
    db.select({ id: views.primaryAssets.id, organizationId: views.primaryAssets.organizationId }).from(views.primaryAssets),
  findDirectLinksForReach: async ({ db, views }, primaryAssetIds: ReadonlyArray<string>) => {
    if (primaryAssetIds.length === 0) {
      return [];
    }
    return db.select({
      primaryAssetId: views.supportToPrimaryLinks.primaryAssetId,
      supportingAssetId: views.supportToPrimaryLinks.supportingAssetId,
    }).from(views.supportToPrimaryLinks)
      .where(inUuids(views.supportToPrimaryLinks.primaryAssetId, primaryAssetIds));
  },
  findProvidersForReach: async ({ db, views }, dependentIds: ReadonlyArray<string>) => {
    if (dependentIds.length === 0) {
      return [];
    }
    return db.select({
      dependentAssetId: views.supportToSupportLinks.dependentAssetId,
      providerAssetId: views.supportToSupportLinks.providerAssetId,
    }).from(views.supportToSupportLinks)
      .where(inUuids(views.supportToSupportLinks.dependentAssetId, dependentIds));
  },
  /**
   * The `reachable_from` hops leaving `assetIds` that were reported at or after `freshSince`, from any connector,
   * with what showed each one (its source and the OpenAEV simulation) and when it was last reported.
   */
  findAttackPathHopsFrom: async ({ db, views }, assetIds: ReadonlyArray<string>, freshSince: Date) => {
    if (assetIds.length === 0) {
      return [];
    }
    return db.select({
      fromAssetId: views.supportingAssetRelations.fromAssetId,
      toAssetId: views.supportingAssetRelations.toAssetId,
      source: views.supportingAssetRelations.source,
      evidenceRef: views.supportingAssetRelations.evidenceRef,
      lastReportedAt: views.supportingAssetRelations.lastReportedAt,
    }).from(views.supportingAssetRelations)
      .where(and(
        eq(views.supportingAssetRelations.kind, 'reachable_from'),
        inUuids(views.supportingAssetRelations.toAssetId, assetIds),
        gte(views.supportingAssetRelations.lastReportedAt, freshSince),
      ));
  },
  /** The primary assets whose reach holds any of `supportingAssetIds`, by name. */
  findPrimaryAssetsReaching: async ({ db, views }, supportingAssetIds: ReadonlyArray<string>) => {
    if (supportingAssetIds.length === 0) {
      return [];
    }
    return db.select({
      primaryAssetId: views.primaryAssetReach.primaryAssetId,
      primaryAssetName: views.primaryAssets.name,
      supportingAssetId: views.primaryAssetReach.supportingAssetId,
    }).from(views.primaryAssetReach)
      .innerJoin(views.primaryAssets, eq(views.primaryAssetReach.primaryAssetId, views.primaryAssets.id))
      .where(inUuids(views.primaryAssetReach.supportingAssetId, supportingAssetIds));
  },
  findReachOf: ({ db, views }, primaryAssetId: string): Promise<Array<ReachRow>> =>
    db.select({
      organizationId: views.primaryAssetReach.organizationId,
      primaryAssetId: views.primaryAssetReach.primaryAssetId,
      supportingAssetId: views.primaryAssetReach.supportingAssetId,
      depth: views.primaryAssetReach.depth,
    }).from(views.primaryAssetReach)
      .where(eq(views.primaryAssetReach.primaryAssetId, primaryAssetId)),
  upsertReach: async ({ db }, rows: Array<typeof primaryAssetReach.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(primaryAssetReach).values(rows).onConflictDoOverwrite({
      target: [primaryAssetReach.tenantId, primaryAssetReach.primaryAssetId, primaryAssetReach.supportingAssetId],
      columns: ['organizationId', 'depth'],
    });
  },
  deleteReach: async ({ db }, primaryAssetId: string, supportingAssetIds: ReadonlyArray<string>) => {
    if (supportingAssetIds.length === 0) {
      return;
    }
    await db.delete(primaryAssetReach).where(and(
      eq(primaryAssetReach.primaryAssetId, primaryAssetId),
      inUuids(primaryAssetReach.supportingAssetId, supportingAssetIds),
    ));
  },
});
