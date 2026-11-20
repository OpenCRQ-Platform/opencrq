import { newError } from '@app/utils';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { CvssSeverityBucket } from '../cve/severity';
import type { SeverityBand } from '../finding-score/bands';
import type { RiskTolerance } from '../organizations/constants';
import type { ReachWaysIn } from './finding-ways-in';
import type { ScenarioFindingSeverities, ScenarioFindingsSummary } from './scenario-findings';
import type { ScenarioFindingsQuery } from './scenario-lists';
import type { ScenarioLifelinePoint } from './lifeline';
import type { TefMode } from './schema';
import { LATERAL_ON } from '../../db/lateral';
import { inUuids } from '../../db/uuid-array';
import { defineRepository } from '../../registry';
import { resolveScopePosture } from '../controls/capability/scope-posture';
import { cvssSeverityBucketSql } from '../cve/severity';
import { lossAnswersVersion } from '../financial-profiles/answers-version';
import { latestRunOf } from '../crq-indicators/latest-run';
import { supportingAssets } from '../supporting-assets/schema';
import { playedTechniquesOf } from '../threat-analyses/played-techniques';
import { LIFELINE_SAMPLES } from './lifeline';
import { inputFreshnessOf, noMappedAssetOf } from './readiness-probes';
import {
  applicableFinding,
  NO_SCENARIO_FINDING_SEVERITIES,
  NO_SCENARIO_FINDINGS,
  scenarioFindingColumns,
  scenarioFindings,
  scenarioFindingsOrder,
  scenarioFindingsWhere,
} from './scenario-findings';
import { sampleRunsAsOf } from './run-samples';
import { riskScenarioBusinessValueCategories, riskScenarioPrimaryAssets, riskScenarioRiskTolerances, riskScenarios } from './schema';

export const riskScenariosRepository = defineRepository({
  insertRiskScenario: ({ db }, values: {
    id: string,
    tenantId: string,
    organizationId: string,
    name: string,
    description: string | null,
    ownerId?: string | null,
    attackOutcomeId: string,
  }) => db.insert(riskScenarios).values([values]),

  // The outcome and the tenant are fixed at creation, so they stay outside the updatable set.
  updateRiskScenario: ({ db }, id: string, values: Partial<Omit<typeof riskScenarios.$inferInsert, 'attackOutcomeId' | 'tenantId'>>) =>
    db.update(riskScenarios).set(values).where(eq(riskScenarios.id, id)),

  findAutoModeRiskScenarioIds: async ({ db, views }, organizationId: string) => {
    const rows = await db
      .select({ id: views.riskScenarios.id })
      .from(views.riskScenarios)
      .where(and(eq(views.riskScenarios.organizationId, organizationId), eq(views.riskScenarios.tefMode, 'auto')));
    return rows.map((r) => r.id);
  },

  deleteRiskScenarios: ({ db }, ids: Array<string>) =>
    db.delete(riskScenarios).where(inArray(riskScenarios.id, ids)),

  validatePrimaryAssetIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    const found = await db
      .select({ id: views.primaryAssets.id })
      .from(views.primaryAssets)
      .where(inArray(views.primaryAssets.id, ids));
    const uniqueRequestedCount = new Set(ids).size;
    if (found.length !== uniqueRequestedCount) {
      throw newError('One or more primary asset IDs are invalid');
    }
  },

  /** The secured users view holds the caller's tenant members only, so an owner outside it is refused rather than stored. */
  validateOwnerId: async ({ db, views }, ownerId: string) => {
    const found = await db
      .select({ id: views.users.id })
      .from(views.users)
      .where(eq(views.users.id, ownerId))
      .limit(1);
    if (found.length === 0) {
      throw newError('The owner is not a member of this tenant');
    }
  },

  validateOrganizationId: async ({ db, views }, organizationId: string) => {
    const found = await db
      .select({ id: views.organizations.id })
      .from(views.organizations)
      .where(eq(views.organizations.id, organizationId))
      .limit(1);
    if (found.length === 0) {
      throw newError('The risk scope does not belong to this tenant');
    }
  },

  validateAttackOutcomeId: async ({ db, views }, attackOutcomeId: string) => {
    const found = await db
      .select({ id: views.attackOutcomes.id })
      .from(views.attackOutcomes)
      .where(eq(views.attackOutcomes.id, attackOutcomeId))
      .limit(1);
    if (found.length === 0) {
      throw newError('The attack outcome does not belong to this tenant');
    }
  },

  insertRiskScenarioPrimaryAssets: ({ db }, values: Array<{ riskScenarioId: string, primaryAssetId: string }>) =>
    db.insert(riskScenarioPrimaryAssets).values(values),

  findRiskScenarioPrimaryAssetIds: async ({ db, views }, riskScenarioId: string) => {
    const rows = await db
      .select({ primaryAssetId: views.riskScenarioPrimaryAssets.primaryAssetId })
      .from(views.riskScenarioPrimaryAssets)
      .where(eq(views.riskScenarioPrimaryAssets.riskScenarioId, riskScenarioId));
    return rows.map((r) => r.primaryAssetId);
  },

  deleteRiskScenarioPrimaryAssetsByIds: ({ db }, riskScenarioId: string, primaryAssetIds: Array<string>) =>
    db.delete(riskScenarioPrimaryAssets).where(
      and(
        eq(riskScenarioPrimaryAssets.riskScenarioId, riskScenarioId),
        inArray(riskScenarioPrimaryAssets.primaryAssetId, primaryAssetIds),
      ),
    ),

  validateBusinessValueCategoryIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    const found = await db
      .select({ id: views.businessValueCategories.id })
      .from(views.businessValueCategories)
      .where(inArray(views.businessValueCategories.id, ids));
    if (found.length !== new Set(ids).size) {
      throw newError('One or more business value category IDs are invalid');
    }
  },

  insertRiskScenarioBusinessValueCategories: ({ db }, values: Array<{ riskScenarioId: string, businessValueCategoryId: string }>) =>
    db.insert(riskScenarioBusinessValueCategories).values(values),

  findRiskScenarioBusinessValueCategoryIds: async ({ db, views }, riskScenarioId: string) => {
    const rows = await db
      .select({ businessValueCategoryId: views.riskScenarioBusinessValueCategories.businessValueCategoryId })
      .from(views.riskScenarioBusinessValueCategories)
      .where(eq(views.riskScenarioBusinessValueCategories.riskScenarioId, riskScenarioId));
    return rows.map((r) => r.businessValueCategoryId);
  },

  deleteRiskScenarioBusinessValueCategoriesByIds: ({ db }, riskScenarioId: string, businessValueCategoryIds: Array<string>) =>
    db.delete(riskScenarioBusinessValueCategories).where(
      and(
        eq(riskScenarioBusinessValueCategories.riskScenarioId, riskScenarioId),
        inArray(riskScenarioBusinessValueCategories.businessValueCategoryId, businessValueCategoryIds),
      ),
    ),

  /** The union of the resources the given primary assets hold, the default loss scope of a scenario. */
  findBusinessValueCategoryIdsForPrimaryAssets: async ({ db, views }, primaryAssetIds: Array<string>) => {
    if (primaryAssetIds.length === 0) {
      return [];
    }
    const rows = await db
      .selectDistinct({ businessValueCategoryId: views.primaryAssetBusinessValueCategories.businessValueCategoryId })
      .from(views.primaryAssetBusinessValueCategories)
      .where(inArray(views.primaryAssetBusinessValueCategories.primaryAssetId, primaryAssetIds));
    return rows.map((r) => r.businessValueCategoryId);
  },

  findRiskScenarioNamesByIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select({ id: views.riskScenarios.id, name: views.riskScenarios.name })
      .from(views.riskScenarios)
      .where(inArray(views.riskScenarios.id, ids));
  },

  findRiskScenarioById: async ({ db, views }, id: string) => {
    const result = await db
      .select({
        id: views.riskScenarios.id,
        organizationId: views.riskScenarios.organizationId,
        name: views.riskScenarios.name,
        description: views.riskScenarios.description,
        ownerId: views.riskScenarios.ownerId,
        attackOutcomeId: views.riskScenarios.attackOutcomeId,
        tefMode: views.riskScenarios.tefMode,
        organization: {
          id: views.organizations.id,
          name: views.organizations.name,
        },
        attackOutcome: {
          id: views.attackOutcomes.id,
          name: views.attackOutcomes.name,
        },
        owner: {
          id: views.users.id,
          name: sql<string>`coalesce(nullif(btrim(${views.users.name}), ''), ${views.users.email})`,
        },
      })
      .from(views.riskScenarios)
      .leftJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
      .innerJoin(views.attackOutcomes, eq(views.riskScenarios.attackOutcomeId, views.attackOutcomes.id))
      .leftJoin(views.users, eq(views.riskScenarios.ownerId, views.users.id))
      .where(eq(views.riskScenarios.id, id))
      .limit(1);

    const row = result.at(0);
    if (!row) {
      return undefined;
    }

    const linkedPrimaryAssets = await db
      .select({
        id: views.primaryAssets.id,
        name: views.primaryAssets.name,
      })
      .from(views.riskScenarioPrimaryAssets)
      .innerJoin(views.primaryAssets, eq(views.riskScenarioPrimaryAssets.primaryAssetId, views.primaryAssets.id))
      .where(eq(views.riskScenarioPrimaryAssets.riskScenarioId, id));

    const linkedBusinessValueCategories = await db
      .select({
        id: views.businessValueCategories.id,
        code: views.businessValueCategories.code,
        name: views.businessValueCategories.name,
      })
      .from(views.riskScenarioBusinessValueCategories)
      .innerJoin(views.businessValueCategories, eq(views.riskScenarioBusinessValueCategories.businessValueCategoryId, views.businessValueCategories.id))
      .where(eq(views.riskScenarioBusinessValueCategories.riskScenarioId, id))
      .orderBy(asc(views.businessValueCategories.displayOrder));

    return {
      ...row,
      primaryAssets: linkedPrimaryAssets,
      businessValueCategories: linkedBusinessValueCategories,
    };
  },

  findActorTechniqueExternalIds: async (context, analysisIds: Array<string>) => playedTechniquesOf(context, analysisIds),

  findTechniqueIdsByExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return [];
    }
    return db
      .select({ id: views.mitreTechniques.id })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.externalId, externalIds));
  },

  /** The posture is the one of `organizationId`, the scope the engine prices the scenario on. */
  findControlCapabilitiesByTechniqueIds: async ({ db, views }, techniqueIds: Array<string>, organizationId: string) => {
    if (techniqueIds.length === 0) {
      return [];
    }

    // Capabilities with an edge on any of the scenario techniques; the tenant's
    // assessment (RLS-scoped via views) gives the current two-axis state, L0/L0 if absent.
    const rows = await db
      .selectDistinct({
        id: views.controlCapabilities.id,
        externalId: views.controlCapabilities.externalId,
        name: views.controlCapabilities.name,
        strengthRung: views.controlCapabilityAssessments.strengthRung,
        coverageBucket: views.controlCapabilityAssessments.coverageBucket,
      })
      .from(views.controlCapabilityEdges)
      .innerJoin(views.controlCapabilities, eq(views.controlCapabilities.id, views.controlCapabilityEdges.capabilityId))
      .leftJoin(views.controlCapabilityAssessments, eq(views.controlCapabilityAssessments.capabilityId, views.controlCapabilities.id))
      .where(inArray(views.controlCapabilityEdges.mitreTechniqueId, techniqueIds))
      .orderBy(asc(views.controlCapabilities.externalId));

    if (rows.length === 0) {
      return [];
    }

    const capabilityIds = rows.map((row) => row.id);
    // Reuse the capability ids already resolved above instead of re-deriving them via a subquery.
    const [ttpRows, overrideRows] = await Promise.all([
      db
        .select({
          capabilityId: views.controlCapabilityEdges.capabilityId,
          mitreTechniqueId: views.controlCapabilityEdges.mitreTechniqueId,
        })
        .from(views.controlCapabilityEdges)
        .where(inArray(views.controlCapabilityEdges.capabilityId, capabilityIds)),
      db
        .select({
          capabilityId: views.controlCapabilityScopeOverrides.capabilityId,
          strengthRung: views.controlCapabilityScopeOverrides.strengthRung,
          coverageBucket: views.controlCapabilityScopeOverrides.coverageBucket,
        })
        .from(views.controlCapabilityScopeOverrides)
        .where(and(
          inArray(views.controlCapabilityScopeOverrides.capabilityId, capabilityIds),
          eq(views.controlCapabilityScopeOverrides.organizationId, organizationId),
        )),
    ]);

    const ttpsByCapability = new Map<string, Array<string>>();
    for (const row of ttpRows) {
      const list = ttpsByCapability.get(row.capabilityId) ?? [];
      list.push(row.mitreTechniqueId);
      ttpsByCapability.set(row.capabilityId, list);
    }

    const overrideByCapability = new Map(overrideRows.map((row) => [row.capabilityId, row]));

    return rows.map((row) => {
      const tenant = row.strengthRung === null || row.coverageBucket === null
        ? undefined
        : {
          strengthRung: row.strengthRung,
          coverageBucket: row.coverageBucket,
        };
      const { strengthRung, coverageBucket, strengthSource, coverageSource } = resolveScopePosture(tenant, overrideByCapability.get(row.id));
      return {
        id: row.id,
        externalId: row.externalId,
        name: row.name,
        strengthRung,
        coverageBucket,
        strengthSource,
        coverageSource,
        isAssessed: tenant !== undefined || strengthSource === 'scope' || coverageSource === 'scope',
        mitreTechniqueIds: ttpsByCapability.get(row.id) ?? [],
      };
    });
  },

  findAllRiskScenarios: async ({ db, views }, organizationId?: string) => {
    const scenarioFilter = organizationId
      ? eq(views.riskScenarios.organizationId, organizationId)
      : undefined;

    const result = await db
      .select({
        id: views.riskScenarios.id,
        organizationId: views.riskScenarios.organizationId,
        name: views.riskScenarios.name,
        description: views.riskScenarios.description,
        ownerId: views.riskScenarios.ownerId,
        attackOutcomeId: views.riskScenarios.attackOutcomeId,
        tefMode: views.riskScenarios.tefMode,
        noMappedAsset: noMappedAssetOf({ db, views }),
        organization: {
          id: views.organizations.id,
          name: views.organizations.name,
        },
        attackOutcome: {
          id: views.attackOutcomes.id,
          name: views.attackOutcomes.name,
        },
        owner: {
          id: views.users.id,
          name: sql<string>`coalesce(nullif(btrim(${views.users.name}), ''), ${views.users.email})`,
        },
      })
      .from(views.riskScenarios)
      .leftJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
      .innerJoin(views.attackOutcomes, eq(views.riskScenarios.attackOutcomeId, views.attackOutcomes.id))
      .leftJoin(views.users, eq(views.riskScenarios.ownerId, views.users.id))
      .where(scenarioFilter);

    const allLinkedPrimaryAssets = result.length > 0
      ? await db
        .select({
          riskScenarioId: views.riskScenarioPrimaryAssets.riskScenarioId,
          id: views.primaryAssets.id,
          name: views.primaryAssets.name,
        })
        .from(views.riskScenarioPrimaryAssets)
        .innerJoin(views.primaryAssets, eq(views.riskScenarioPrimaryAssets.primaryAssetId, views.primaryAssets.id))
        .where(inArray(
          views.riskScenarioPrimaryAssets.riskScenarioId,
          db
            .select({ id: views.riskScenarios.id })
            .from(views.riskScenarios)
            .innerJoin(views.attackOutcomes, eq(views.riskScenarios.attackOutcomeId, views.attackOutcomes.id))
            .where(scenarioFilter),
        ))
      : [];

    const primaryAssetsByScenarioId = new Map<string, Array<{ id: string, name: string }>>();
    for (const r of allLinkedPrimaryAssets) {
      const list = primaryAssetsByScenarioId.get(r.riskScenarioId) ?? [];
      list.push({ id: r.id, name: r.name });
      primaryAssetsByScenarioId.set(r.riskScenarioId, list);
    }

    return result.map((row) => ({
      ...row,
      primaryAssets: primaryAssetsByScenarioId.get(row.id) ?? [],
    }));
  },

  findDirectSupportingAssetsForPrimaryAssets: async ({ db, views }, primaryAssetIds: Array<string>) =>
    db.select({
      supportingAssetId: views.supportToPrimaryLinks.supportingAssetId,
      primaryAssetId: views.supportToPrimaryLinks.primaryAssetId,
      roles: views.supportToPrimaryLinks.roles,
      supportingAssetName: supportingAssets.name,
      supportingAssetDerivedName: supportingAssets.derivedName,
    })
      .from(views.supportToPrimaryLinks)
      // eslint-disable-next-line app/no-raw-table-in-reads -- enrichment join for asset name
      .leftJoin(supportingAssets, eq(views.supportToPrimaryLinks.supportingAssetId, supportingAssets.id))
      .where(inUuids(views.supportToPrimaryLinks.primaryAssetId, primaryAssetIds)),

  findSupportingAssetProviders: async ({ db, views }, dependentAssetIds: Array<string>) =>
    db.select({
      providerAssetId: views.supportToSupportLinks.providerAssetId,
      dependentAssetId: views.supportToSupportLinks.dependentAssetId,
      providerAssetName: supportingAssets.name,
      providerAssetDerivedName: supportingAssets.derivedName,
    })
      .from(views.supportToSupportLinks)
      // eslint-disable-next-line app/no-raw-table-in-reads -- enrichment join for asset name
      .leftJoin(supportingAssets, eq(views.supportToSupportLinks.providerAssetId, supportingAssets.id))
      .where(inUuids(views.supportToSupportLinks.dependentAssetId, dependentAssetIds))
      // The Targets list names a provider's dependents in this order, and sorts on that text.
      .orderBy(asc(views.supportToSupportLinks.dependentAssetId), asc(views.supportToSupportLinks.providerAssetId)),

  findScenarioImpactContext: async ({ db, views }, riskScenarioId: string) => (await db
    .select({
      organizationId: views.riskScenarios.organizationId,
      estateMode: views.organizations.estateMode,
      attackOutcomeId: views.attackOutcomes.id,
      attackOutcomeName: views.attackOutcomes.name,
      reachesAvailability: views.attackOutcomes.reachesAvailability,
      reachesIntegrity: views.attackOutcomes.reachesIntegrity,
      reachesConfidentiality: views.attackOutcomes.reachesConfidentiality,
      reachesTraceability: views.attackOutcomes.reachesTraceability,
    })
    .from(views.riskScenarios)
    .innerJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
    .innerJoin(views.attackOutcomes, eq(views.riskScenarios.attackOutcomeId, views.attackOutcomes.id))
    .where(eq(views.riskScenarios.id, riskScenarioId))
    .limit(1)).at(0),

  findAssetIdsMappedToScope: async ({ db, views }, organizationId: string, supportingAssetIds: Array<string>) => {
    if (supportingAssetIds.length === 0) {
      return [];
    }
    const rows = await db.select({ supportingAssetId: views.organizationAssets.supportingAssetId })
      .from(views.organizationAssets)
      .where(and(
        eq(views.organizationAssets.organizationId, organizationId),
        inUuids(views.organizationAssets.supportingAssetId, supportingAssetIds),
      ));
    return rows.map((row) => row.supportingAssetId);
  },

  /**
   * What `placeFindingRows` needs for the assets a page of findings sits on, read from the reach of
   * `primaryAssetIds`, and the names of the assets and of their first way in. A provider comes back
   * as one row however many assets depend on it, so the reads stay bounded by the page.
   */
  findReachWaysIn: async ({ db, views }, primaryAssetIds: Array<string>, assetIds: Array<string>) => {
    if (primaryAssetIds.length === 0 || assetIds.length === 0) {
      return { waysIn: { depths: [], directLinks: [], dependentWays: [] } satisfies ReachWaysIn, names: [] };
    }
    const reach = views.primaryAssetReach;
    const links = views.supportToSupportLinks;
    const depths = await db
      .select({ supportingAssetId: reach.supportingAssetId, depth: sql<number>`min(${reach.depth})::int` })
      .from(reach)
      .where(and(inUuids(reach.primaryAssetId, primaryAssetIds), inUuids(reach.supportingAssetId, assetIds)))
      .groupBy(reach.supportingAssetId);

    const directIds = depths.filter((row) => row.depth === 0).map((row) => row.supportingAssetId);
    // A dependent of a provider at depth d sits at d - 1 or deeper, so one reached at d - 1 is first reached there.
    const reachedAbove = [...Map.groupBy(depths.filter((row) => row.depth > 0), (row) => row.depth)].map(([depth, rows]) => and(
      inUuids(links.providerAssetId, rows.map((row) => row.supportingAssetId)),
      eq(reach.depth, depth - 1),
    ));

    const [directLinks, dependentWays] = await Promise.all([
      directIds.length === 0
        ? []
        : db.select({ supportingAssetId: views.supportToPrimaryLinks.supportingAssetId, primaryAssetId: views.supportToPrimaryLinks.primaryAssetId })
          .from(views.supportToPrimaryLinks)
          .where(and(inUuids(views.supportToPrimaryLinks.primaryAssetId, primaryAssetIds), inUuids(views.supportToPrimaryLinks.supportingAssetId, directIds))),
      reachedAbove.length === 0
        ? []
        : db.select({
          providerAssetId: links.providerAssetId,
          count: sql<number>`count(distinct ${links.dependentAssetId})::int`,
          // Postgres has no `min(uuid)`; the uuid order is the order of their canonical text.
          firstDependentAssetId: sql<string>`(array_agg(${links.dependentAssetId} order by ${links.dependentAssetId}))[1]`,
        })
          .from(links)
          .innerJoin(reach, and(eq(reach.supportingAssetId, links.dependentAssetId), inUuids(reach.primaryAssetId, primaryAssetIds)))
          .where(or(...reachedAbove))
          .groupBy(links.providerAssetId),
    ]);

    const names = await db
      .select({ id: views.supportingAssets.id, name: views.supportingAssets.name, derivedName: views.supportingAssets.derivedName })
      .from(views.supportingAssets)
      .where(inUuids(views.supportingAssets.id, [...assetIds, ...dependentWays.map((ways) => ways.firstDependentAssetId)]));

    return { waysIn: { depths, directLinks, dependentWays } satisfies ReachWaysIn, names };
  },

  /** A page of `scenarioFindings`, ordered as `query` asks, by score down by default. */
  findScenarioFindingsPage: async ({ db, views }, primaryAssetIds: Array<string>, query: ScenarioFindingsQuery) => {
    const findings = scenarioFindings({ db, views }, primaryAssetIds);
    return db
      .select(scenarioFindingColumns(findings))
      .from(findings)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, findings.id))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, findings.supportingAssetId))
      .where(scenarioFindingsWhere({ views }, findings, query))
      .orderBy(...scenarioFindingsOrder({ views }, findings, query.sortBy ?? 'score', query.sortDesc))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
  },

  /** Every finding `query` keeps, by the band of its score, and every finding whatever the filters. */
  countScenarioFindings: async ({ db, views }, primaryAssetIds: Array<string>, query: Pick<ScenarioFindingsQuery, 'state' | 'severity'>): Promise<ScenarioFindingsSummary> => {
    const findings = scenarioFindings({ db, views }, primaryAssetIds);
    const kept = scenarioFindingsWhere({ views }, findings, query) ?? sql`true`;
    const keptAnd = (condition: SQL) => sql<number>`(count(*) filter (where ${kept} and ${condition}))::int`;
    const inBand = (band: SeverityBand) => keptAnd(sql`${views.findingScores.band} = ${band}`);
    const [row] = await db
      .select({
        critical: inBand('critical'),
        high: inBand('high'),
        medium: inBand('medium'),
        low: inBand('low'),
        unscored: keptAnd(sql`${views.findingScores.band} is null`),
        dismissed: keptAnd(sql`${findings.currentState} = 'dismissed'`),
        total: sql<number>`(count(*) filter (where ${kept}))::int`,
        unfiltered: sql<number>`count(*)::int`,
      })
      .from(findings)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, findings.id));
    return row ?? NO_SCENARIO_FINDINGS;
  },

  countScenarioFindingSeverities: async ({ db, views }, primaryAssetIds: Array<string>): Promise<ScenarioFindingSeverities> => {
    const findings = scenarioFindings({ db, views }, primaryAssetIds);
    const applicable = applicableFinding(findings);
    const bucket = cvssSeverityBucketSql(findings.cvss);
    const inBucket = (severity: CvssSeverityBucket) => sql<number>`(count(*) filter (where ${applicable} and ${bucket} = ${severity}))::int`;
    const [row] = await db
      .select({
        critical: inBucket('critical'),
        high: inBucket('high'),
        medium: inBucket('medium'),
        low: inBucket('low'),
        none: inBucket('none'),
        unscored: inBucket('unscored'),
        kev: sql<number>`(count(*) filter (where ${applicable} and ${findings.kev}))::int`,
        dismissed: sql<number>`(count(*) filter (where not (${applicable})))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(findings);
    return row ?? NO_SCENARIO_FINDING_SEVERITIES;
  },

  /** The applicable findings to look at first: known exploited, then by CVSS, then by EPSS. */
  findTopScenarioFindings: async ({ db, views }, primaryAssetIds: Array<string>, limit: number) => {
    const findings = scenarioFindings({ db, views }, primaryAssetIds);
    return db
      .select(scenarioFindingColumns(findings))
      .from(findings)
      .where(applicableFinding(findings))
      .orderBy(desc(findings.kev), sql`${findings.cvss} desc nulls last`, sql`${findings.epss} desc nulls last`, asc(findings.id))
      .limit(limit);
  },

  findRiskScenariosByAttackOutcomeIds: async ({ db, views }, attackOutcomeIds: Array<string>, organizationId?: string) => {
    if (attackOutcomeIds.length === 0) {
      return [];
    }
    return db.select({
      id: views.riskScenarios.id,
      name: views.riskScenarios.name,
      organizationId: views.riskScenarios.organizationId,
      organizationName: views.organizations.name,
      attackOutcomeId: views.riskScenarios.attackOutcomeId,
    })
      .from(views.riskScenarios)
      .innerJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
      .where(and(
        inArray(views.riskScenarios.attackOutcomeId, attackOutcomeIds),
        organizationId ? eq(views.riskScenarios.organizationId, organizationId) : undefined,
      ));
  },

  /**
   * The scenarios of the risk scopes named: the closed ones by id, the open ones all together, since
   * an open scope reads the whole tenant estate. `onlyOrganizationId` narrows to one scope.
   */
  findRiskScenariosInScopes: async (
    { db, views },
    scopes: { closedOrganizationIds: Array<string>, includeOpenScopes: boolean, onlyOrganizationId: string | null },
  ) => {
    const inScope = [
      scopes.closedOrganizationIds.length > 0 ? inArray(views.riskScenarios.organizationId, scopes.closedOrganizationIds) : undefined,
      scopes.includeOpenScopes ? eq(views.organizations.estateMode, 'open') : undefined,
    ].filter((condition) => condition !== undefined);
    if (inScope.length === 0) {
      return [];
    }
    return db
      .select({
        id: views.riskScenarios.id,
        name: views.riskScenarios.name,
        organizationId: views.riskScenarios.organizationId,
        attackOutcomeId: views.riskScenarios.attackOutcomeId,
        noMappedAsset: noMappedAssetOf({ db, views }),
      })
      .from(views.riskScenarios)
      .innerJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
      .where(and(
        or(...inScope),
        scopes.onlyOrganizationId === null ? undefined : eq(views.riskScenarios.organizationId, scopes.onlyOrganizationId),
      ));
  },

  /**
   * What the list prices each scenario from, one row per scenario and bounded whatever the run
   * history: the latest run, the lifeline read as of `LIFELINE_SAMPLES` instants from the first
   * quantified run since `since` to `now`, and the freshness of the three inputs. The runs are probed
   * per scenario through `crq_indicator_runs_risk_scenario_created_idx`, never ranked across the
   * whole history.
   */
  findOverviewFigures: ({ db, views }, since: Date, now: Date, organizationId?: string) => {
    const runs = views.crqIndicatorRuns;
    const scenario = views.riskScenarios;

    const latestRun = latestRunOf({ db, views }, {
      runId: runs.id,
      createdAt: runs.createdAt,
      aleMean: runs.aleMean,
      aleP10: runs.aleP10,
      aleP90: runs.aleP90,
      lefMean: runs.lefMean,
      techniqueCount: runs.techniqueCount,
      coveredTechniqueCount: runs.coveredTechniqueCount,
    });

    const samples = sampleRunsAsOf(
      { db, views },
      scenario.id,
      { since, now, samples: LIFELINE_SAMPLES },
      (scenarioRuns) => ({ aleMean: scenarioRuns.aleMean, aleP10: scenarioRuns.aleP10, aleP90: scenarioRuns.aleP90 }),
      'samples',
    );
    const lifeline = db
      .select({
        points: sql<Array<ScenarioLifelinePoint>>`coalesce(jsonb_agg(jsonb_build_object(
          'at', ${samples.at},
          'aleMean', ${samples.aleMean},
          'aleP10', ${samples.aleP10},
          'aleP90', ${samples.aleP90}
        ) order by ${samples.at}, ${samples.runId}), '[]'::jsonb)`
          // jsonb carries the instant as an ISO string.
          .mapWith((points: Array<Omit<ScenarioLifelinePoint, 'at'> & { at: string }>) => points.map((point) => ({ ...point, at: new Date(point.at) })))
          .as('points'),
      })
      .from(samples)
      .as('lifeline');

    const { pricing, tefInput, tefEstimate } = inputFreshnessOf({ db, views }, organizationId);

    return db
      .select({
        riskScenarioId: scenario.id,
        latestRun: {
          runId: latestRun.runId,
          createdAt: latestRun.createdAt,
          aleMean: latestRun.aleMean,
          aleP10: latestRun.aleP10,
          aleP90: latestRun.aleP90,
          lefMean: latestRun.lefMean,
          techniqueCount: latestRun.techniqueCount,
          coveredTechniqueCount: latestRun.coveredTechniqueCount,
        },
        lifeline: lifeline.points,
        tefInputUpdatedAt: tefInput.updatedAt,
        tefEstimateCreatedAt: tefEstimate.createdAt,
        lossExpectedValue: pricing.expectedValue,
        lossUpdatedAt: pricing.updatedAt,
      })
      .from(scenario)
      .leftJoinLateral(latestRun, LATERAL_ON)
      .leftJoinLateral(lifeline, LATERAL_ON)
      .leftJoinLateral(pricing, LATERAL_ON)
      .leftJoinLateral(tefInput, LATERAL_ON)
      .leftJoin(tefEstimate, eq(tefEstimate.riskScenarioId, scenario.id))
      .where(organizationId ? eq(scenario.organizationId, organizationId) : undefined);
  },

  /**
   * The overview's scenarios with only what readiness is computed from: the latest run's timestamp
   * and the freshness of the inputs. No run figure and no lifeline.
   */
  findReadinessFigures: ({ db, views }, organizationId?: string) => {
    const scenario = views.riskScenarios;
    const latestRun = latestRunOf({ db, views }, { createdAt: views.crqIndicatorRuns.createdAt });
    const { pricing, tefInput, tefEstimate } = inputFreshnessOf({ db, views }, organizationId);

    return db
      .select({
        id: scenario.id,
        organizationId: scenario.organizationId,
        name: scenario.name,
        tefMode: scenario.tefMode,
        noMappedAsset: noMappedAssetOf({ db, views }),
        lastRunAt: latestRun.createdAt,
        tefInputUpdatedAt: tefInput.updatedAt,
        tefEstimateCreatedAt: tefEstimate.createdAt,
        lossExpectedValue: pricing.expectedValue,
        lossUpdatedAt: pricing.updatedAt,
      })
      .from(scenario)
      .leftJoin(views.organizations, eq(scenario.organizationId, views.organizations.id))
      // The overview's own join, so both read the same scenarios.
      .innerJoin(views.attackOutcomes, eq(scenario.attackOutcomeId, views.attackOutcomes.id))
      .leftJoinLateral(latestRun, LATERAL_ON)
      .leftJoinLateral(pricing, LATERAL_ON)
      .leftJoinLateral(tefInput, LATERAL_ON)
      .leftJoin(tefEstimate, eq(tefEstimate.riskScenarioId, scenario.id))
      .where(organizationId ? eq(scenario.organizationId, organizationId) : undefined);
  },

  /** Just the mode, for a caller that needs no more than that — never `findRiskScenarioById`'s three statements. */
  findScenarioTefMode: async ({ db, views }, riskScenarioId: string): Promise<TefMode | undefined> => {
    const scenario = (await db
      .select({ tefMode: views.riskScenarios.tefMode })
      .from(views.riskScenarios)
      .where(eq(views.riskScenarios.id, riskScenarioId))
      .limit(1)).at(0);
    return scenario?.tefMode;
  },

  /**
   * Records which answers this scenario's estimates now cover. The version arrives as text and is
   * cast back here, so the stored value is the profile row's own timestamp to the microsecond: a
   * value that travelled as a `Date` would come back truncated and read as forever behind.
   *
   * The guard is what stops the recompute waking itself: this job reads `risk_scenarios`, so the
   * dispatcher books it again whenever that table is written, and an unconditional stamp would
   * re-ask at debounce cadence for ever. The change trigger fires per row, so a stamp that finds
   * the version already recorded writes nothing and rings nothing — the run after a real answer
   * change is the only one that wakes a successor, and that successor settles.
   */
  stampDerivedAnswers: async ({ db }, riskScenarioId: string, answersVersion: string): Promise<boolean> =>
    (await db
      .update(riskScenarios)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: a sql template literal must be cast to Date for a timestamp column
      .set({ derivedAnswersUpdatedAt: sql`${answersVersion}::timestamptz` as unknown as Date })
      .where(and(
        eq(riskScenarios.id, riskScenarioId),
        sql`${riskScenarios.derivedAnswersUpdatedAt} is distinct from ${answersVersion}::timestamptz`,
      ))
      .returning()).length > 0,

  /**
   * Whether the answers have moved on since this scenario's own estimates were derived. Compared
   * in SQL, never in the application: both sides are microsecond timestamps a `Date` truncates.
   * An organization with no profile joins nothing, which is the right answer — no profile means
   * nothing derives from answers, so no recompute is owed.
   */
  findEstimatesRecomputePending: async ({ db, views }, riskScenarioId: string): Promise<boolean> => (await db
    .select({
      pending: sql<boolean>`${views.riskScenarios.derivedAnswersUpdatedAt} is null or ${lossAnswersVersion({ views })} > ${views.riskScenarios.derivedAnswersUpdatedAt}`,
    })
    .from(views.riskScenarios)
    .innerJoin(views.financialProfiles, eq(views.financialProfiles.organizationId, views.riskScenarios.organizationId))
    .where(eq(views.riskScenarios.id, riskScenarioId))
    .limit(1)).at(0)?.pending ?? false,

  /** Just the owning organization, for a caller that needs no more than that — never the whole activation context's two statements. */
  findScenarioOrganizationId: async ({ db, views }, riskScenarioId: string): Promise<string | undefined> => {
    const scenario = (await db
      .select({ organizationId: views.riskScenarios.organizationId })
      .from(views.riskScenarios)
      .where(eq(views.riskScenarios.id, riskScenarioId))
      .limit(1)).at(0);
    return scenario?.organizationId;
  },

  upsertRiskTolerance: ({ db }, riskScenarioId: string, tolerance: RiskTolerance) => db
    .insert(riskScenarioRiskTolerances)
    .values([{ id: riskScenarioId, riskScenarioId, ...tolerance }])
    .onConflictDoUpdate({ target: riskScenarioRiskTolerances.riskScenarioId, set: tolerance }),

  deleteRiskTolerance: ({ db }, riskScenarioId: string) =>
    db.delete(riskScenarioRiskTolerances).where(eq(riskScenarioRiskTolerances.riskScenarioId, riskScenarioId)),

  /**
   * A scenario's activation set for the loss-estimate kernel: its own attack outcome crossed with
   * its own loss scope, the table the driver recommendation reads too. Never through the primary
   * assets: the scope is owned by the scenario and stops following a retagged or deleted asset, so
   * the two would disagree and the recompute would delete amounts the screen still recommends.
   *
   * A dedicated, narrow query — not a reuse of a decorated read-surface query — since the recompute
   * job's own subscriptions are exactly the tables this statement touches.
   */
  findScenarioActivationContext: async ({ db, views }, riskScenarioId: string) => {
    const scenario = (await db
      .select({
        organizationId: views.riskScenarios.organizationId,
        attackOutcomeId: views.riskScenarios.attackOutcomeId,
      })
      .from(views.riskScenarios)
      .where(eq(views.riskScenarios.id, riskScenarioId))
      .limit(1)).at(0);
    if (!scenario) {
      return undefined;
    }

    const categories = await db
      .select({ businessValueCategoryId: views.riskScenarioBusinessValueCategories.businessValueCategoryId })
      .from(views.riskScenarioBusinessValueCategories)
      .where(eq(views.riskScenarioBusinessValueCategories.riskScenarioId, riskScenarioId));

    return {
      organizationId: scenario.organizationId,
      activationSet: categories.map((category) => ({
        attackOutcomeId: scenario.attackOutcomeId,
        businessValueCategoryId: category.businessValueCategoryId,
      })),
    };
  },

  findAllRiskScenarioIds: async ({ db, views }, after?: string) => {
    const rows = await db
      .select({ id: views.riskScenarios.id })
      .from(views.riskScenarios)
      .where(after === undefined ? undefined : gt(views.riskScenarios.id, after))
      .orderBy(asc(views.riskScenarios.id));
    return rows.map((row) => row.id);
  },

  /**
   * The scenario's own columns a run prices from, and nothing joined: the list's owner name would
   * subscribe the price job to the global `users` table.
   */
  findRiskScenarioPricingSubject: async ({ db, views }, riskScenarioId: string) => (await db
    .select({
      organizationId: views.riskScenarios.organizationId,
      attackOutcomeId: views.riskScenarios.attackOutcomeId,
      tefMode: views.riskScenarios.tefMode,
    })
    .from(views.riskScenarios)
    .where(eq(views.riskScenarios.id, riskScenarioId))
    .limit(1)).at(0),

  /** Narrow scenario listing for the recompute sweep: ids only, scoped to a set of organizations. */
  findRiskScenarioIdsByOrganizationIds: async ({ db, views }, organizationIds: Array<string>) => {
    if (organizationIds.length === 0) {
      return [];
    }
    return db
      .select({ id: views.riskScenarios.id, organizationId: views.riskScenarios.organizationId })
      .from(views.riskScenarios)
      .where(inArray(views.riskScenarios.organizationId, organizationIds));
  },
});
