import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { and, asc, count, countDistinct, desc, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, lt, max, ne, notExists, notInArray, or, sql } from 'drizzle-orm';
import type { EvidenceState, SupportingAssetExposure } from '../supporting-assets/schema';
import type { AssetCategory, ExpectationType } from '../supporting-assets/constants';
import type { RepositoryContext } from '../../registry';
import type { SeverityBand } from './bands';
import type { EntryOpeningKey, TechniqueScoreCellKey } from './technique-scores';
import type { VulnerabilityFilter } from './vulnerability-filter';
import { LATERAL_ON } from '../../db/lateral';
import { foldedLike, orderByFolded } from '../../db/fold-text';
import { escapeLikePattern } from '../../db/like-pattern';
import { inUuids } from '../../db/uuid-array';
import { cisaListedSql } from '../cve/cisa-listing';
import { entryOpenings } from '../entry-openings/schema';
import { isIntegrationSource } from '../integration-settings/schema';
import { defineRepository } from '../../registry';
import { estateFilter, estateOfMappedScope } from '../organizations/estate-filter';
import { enabledIdentitiesOf } from '../supporting-assets/enabled-identities';
import { latestEvidenceState, latestVerdictsOf, storedFindingVerdict } from '../supporting-assets/latest-evidence-state';
import { SEVERITY_BAND_MINIMUMS } from './bands';
import {
  assetPostureHistory,
  assetPostures,
  assetTechniqueScores,
  findingMetricDaily,
  findingScoreHistory,
  findingScores,
  uniqueFindingScoreHistory,
  uniqueFindingScores,
} from './schema';

export interface EvidenceScope {
  evidenceId?: string,
  /** Only ever a bounded list, never the whole estate. */
  evidenceIds?: Array<string>,
}

export const FINDING_SORT_KEYS = [
  'score',
  'name',
  'kind',
  'currentState',
  'assetName',
  'assetCategoryId',
  'lastEvaluatedAt',
  'firstSeenAt',
] as const;

export type FindingSortKey = (typeof FINDING_SORT_KEYS)[number];

/** A row no recompute has filled carries no exploitability, and is left out rather than read as zero. */
const applicableWithExploitability = (views: RepositoryContext['views']) => and(
  eq(views.assetEvidence.currentState, 'applicable'),
  isNotNull(views.findingScores.exploitability),
);

/**
 * The band of the exploitability's 0 to 100 figure. The minimums are whole numbers, so comparing
 * the untruncated figure places a row exactly where `partFigure` would.
 */
const exploitabilityBandConditions = (views: RepositoryContext['views']): Record<SeverityBand, SQL> => {
  const figure = sql`(100 * ${views.findingScores.exploitability})`;
  return {
    critical: sql`${figure} >= ${SEVERITY_BAND_MINIMUMS.critical}`,
    high: sql`${figure} >= ${SEVERITY_BAND_MINIMUMS.high} and ${figure} < ${SEVERITY_BAND_MINIMUMS.critical}`,
    medium: sql`${figure} >= ${SEVERITY_BAND_MINIMUMS.medium} and ${figure} < ${SEVERITY_BAND_MINIMUMS.high}`,
    low: sql`${figure} < ${SEVERITY_BAND_MINIMUMS.medium}`,
  };
};

/**
 * The findings the score reads: CVE findings only. A technique finding is a control's answer to a
 * test, read as the asset's prevention and detection ratios, and scoring it as a vulnerability
 * would count the same verdict twice.
 */
const isScoredFinding = (views: RepositoryContext['views']) => isNotNull(views.assetEvidence.cveId);

const evidenceScopeWhere = (views: RepositoryContext['views'], scope: EvidenceScope) => and(
  isScoredFinding(views),
  scope.evidenceId ? eq(views.assetEvidence.id, scope.evidenceId) : undefined,
  scope.evidenceIds ? inArray(views.assetEvidence.id, scope.evidenceIds) : undefined,
);

/** Names no connector: a finding attached by hand, with no row in `asset_evidence_sources` at all. */
const NO_SOURCE = 'user';

/**
 * A finding no connector reports. Correlated on the row under test rather than tested against the
 * set of reported ids, because a `NOT IN` over the secured view cannot become an anti-join: the
 * view hides the column's `NOT NULL`, so Postgres keeps a per-row rescan of the whole set.
 */
const findingReportedByNobody = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>) =>
  notExists(
    db.select({ reported: sql`1` })
      .from(views.assetEvidenceSources)
      .where(eq(views.assetEvidenceSources.assetEvidenceId, views.assetEvidence.id)),
  );

/**
 * The findings one integration source reports: the list's source filter and its count share it.
 * `user` is checked before `isIntegrationSource`, which otherwise silently drops any value it does
 * not recognise — `user` names no connector and would vanish there.
 */
const findingsReportedBySource = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  source: string | null,
) => {
  if (source === NO_SOURCE) {
    return findingReportedByNobody({ db, views });
  }
  if (source === null || !isIntegrationSource(source)) {
    return undefined;
  }
  const sourceFilterSq = db.select({ assetEvidenceId: views.assetEvidenceSources.assetEvidenceId })
    .from(views.assetEvidenceSources)
    .innerJoin(views.integrationSettings, eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId))
    .where(eq(views.integrationSettings.source, source));
  return inArray(views.assetEvidence.id, sourceFilterSq);
};

/** A row the recompute wrote with no score. */
const findingPendingVector = (views: RepositoryContext['views']) =>
  sql<boolean>`(${views.findingScores.assetEvidenceId} is not null and ${views.findingScores.score} is null)`;

/** Every scored finding and every technique finding. A CVE finding not scored yet is counted apart, never listed. */
const isListedFinding = (views: RepositoryContext['views']) => or(
  isNotNull(views.findingScores.assetEvidenceId),
  isNotNull(views.assetEvidence.mitreTechniqueId),
);

/**
 * What narrows the findings list. `asset` reads one asset's findings: there, a CVE finding not scored
 * yet is listed too, with no score, since an asset page shows a finding it just had attached.
 */
export interface ListedFindingsFilter {
  state: EvidenceState | null,
  source: string | null,
  mappedToOrganizationId: string | null,
  vulnerability?: VulnerabilityFilter | null,
  /** The assets a way in holds on, by their exposure and their family. No exposure matches nothing. */
  wayIn?: { exposures: Array<SupportingAssetExposure>, setAsideOn: Array<AssetCategory> } | null,
  /** Matches the flaw's id or name, and the asset's name outside one asset's list. */
  search?: string | null,
  asset?: {
    supportingAssetId: string,
    mitreTechniqueExternalId: string | null,
    expectationType: ExpectationType | null,
  },
}

/** Subqueries, so a count needs no flaw table joined to every finding it reads. */
const flawsMatchingSearch = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, search: string) => {
  const needle = `%${escapeLikePattern(search)}%`;
  return {
    cves: db.select({ id: views.cve.id }).from(views.cve).where(or(
      ilike(views.cve.cveId, needle),
      foldedLike(views.cve.cveTitleFolded, search, 'contains'),
    )),
    techniques: db.select({ id: views.mitreTechniques.id }).from(views.mitreTechniques).where(or(
      ilike(views.mitreTechniques.externalId, needle),
      foldedLike(views.mitreTechniques.nameFolded, search, 'contains'),
    )),
  };
};

const findingsMatchingSearch = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  search: string | null | undefined,
  matchesAssetName: boolean,
) => {
  if (!search) {
    return undefined;
  }
  const { cves, techniques } = flawsMatchingSearch({ db, views }, search);
  return or(
    inArray(views.assetEvidence.cveId, cves),
    inArray(views.assetEvidence.mitreTechniqueId, techniques),
    matchesAssetName
      ? inArray(
        views.assetEvidence.supportingAssetId,
        db.select({ id: views.supportingAssets.id }).from(views.supportingAssets).where(foldedLike(views.supportingAssets.displayNameFolded, search, 'contains')),
      )
      : undefined,
  );
};

const listedFindingsWhere = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  filter: ListedFindingsFilter,
) => {
  const { asset } = filter;
  return and(
    asset ? eq(views.assetEvidence.supportingAssetId, asset.supportingAssetId) : isListedFinding(views),
    findingsInFilteredState(views, filter),
    findingsReportedBySource({ db, views }, filter.source),
    findingsOnEstate({ db, views }, filter.mappedToOrganizationId),
    findingsOfVulnerability({ db, views }, filter.vulnerability ?? null),
    findingsOnWayIn({ db, views }, filter.wayIn ?? null),
    asset?.mitreTechniqueExternalId
      ? inArray(
        views.assetEvidence.mitreTechniqueId,
        db.select({ id: views.mitreTechniques.id }).from(views.mitreTechniques).where(eq(views.mitreTechniques.externalId, asset.mitreTechniqueExternalId)),
      )
      : undefined,
    asset?.expectationType ? eq(views.assetEvidence.expectationType, asset.expectationType) : undefined,
    findingsMatchingSearch({ db, views }, filter.search, asset === undefined),
  );
};

const findingsInState = (views: RepositoryContext['views'], state: EvidenceState) =>
  eq(views.assetEvidence.currentState, state);

const findingsInFilteredState = (views: RepositoryContext['views'], filter: ListedFindingsFilter) =>
  (filter.state === null ? undefined : findingsInState(views, filter.state));

/** `null` for a scope measured over the whole tenant estate: the caller resolves the mode. */
const findingsOnEstate = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  mappedToOrganizationId: string | null,
) => estateFilter({ db, views }, estateOfMappedScope(mappedToOrganizationId), views.assetEvidence.supportingAssetId);

const findingsOfVulnerability = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  vulnerability: VulnerabilityFilter | null,
) => {
  if (vulnerability === null) {
    return undefined;
  }
  if (vulnerability.kind === 'cve') {
    return inArray(
      views.assetEvidence.cveId,
      db.select({ id: views.cve.id }).from(views.cve).where(eq(views.cve.cveId, vulnerability.cveId)),
    );
  }
  return and(
    inArray(
      views.assetEvidence.mitreTechniqueId,
      db.select({ id: views.mitreTechniques.id }).from(views.mitreTechniques).where(eq(views.mitreTechniques.externalId, vulnerability.externalId)),
    ),
    eq(views.assetEvidence.expectationType, vulnerability.expectationType),
  );
};

const findingsOnWayIn = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  wayIn: ListedFindingsFilter['wayIn'] | null,
) => {
  if (wayIn === null || wayIn === undefined) {
    return undefined;
  }
  if (wayIn.exposures.length === 0) {
    return sql`false`;
  }
  return inArray(
    views.assetEvidence.supportingAssetId,
    db.select({ id: views.supportingAssets.id }).from(views.supportingAssets).where(and(
      inArray(views.supportingAssets.exposure, wayIn.exposures),
      wayIn.setAsideOn.length === 0 ? undefined : notInArray(views.supportingAssets.categoryId, wayIn.setAsideOn),
    )),
  );
};

/** What the Findings page sorts by: `gain` reads a run's figures, which only a caller naming one has. */
export const UNIQUE_FINDING_PAGE_SORT_KEYS = ['score', 'affectedAssets', 'name', 'age'] as const;

export const UNIQUE_FINDING_SORT_KEYS = ['gain', ...UNIQUE_FINDING_PAGE_SORT_KEYS] as const;

export type UniqueFindingSortKey = (typeof UNIQUE_FINDING_SORT_KEYS)[number];

export interface UniqueFindingScope {
  source: string | null,
  mappedToOrganizationId: string | null,
  /** Matches the CVE's id or title, or the technique's id or name. */
  search?: string | null,
}

const uniqueFindingsMatchingSearch = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, search: string | null | undefined) => {
  if (!search) {
    return undefined;
  }
  const { cves, techniques } = flawsMatchingSearch({ db, views }, search);
  return or(
    inArray(views.uniqueFindingScores.cveId, cves),
    inArray(views.uniqueFindingScores.mitreTechniqueId, techniques),
  );
};

export interface UniqueFindingListOptions {
  /** Leaves out the technique groups. */
  cveOnly?: boolean,
  /** The run whose `crq_cve_what_if_results` rows give each CVE group its gain; groups it has no row for read null. */
  gainRunId?: string | null,
}

/** A unique finding's members in one estate: its applicable findings. Reads `assetEvidence`, `findingScores` and `supportingAssets`. */
const uniqueFindingMemberWhere = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, mappedToOrganizationId: string | null) => and(
  isListedFinding(views),
  findingsInState(views, 'applicable'),
  findingsOnEstate({ db, views }, mappedToOrganizationId),
);

/** A CVE group no member of which is scored, while one is pending a vector. */
const uniqueCvePendingVector = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  group: { cveRef: SQL | PgColumn, uniqueScore: SQL | PgColumn },
  mappedToOrganizationId: string | null,
) => sql<boolean>`(${group.uniqueScore} is null and exists (${db
  .select({ one: sql`1` })
  .from(views.assetEvidence)
  .innerJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
  .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
  .where(and(
    sql`${views.assetEvidence.cveId} = ${group.cveRef}`,
    isNull(views.findingScores.score),
    uniqueFindingMemberWhere({ db, views }, mappedToOrganizationId),
  ))}))`;

const uniqueFindingInScope = (views: RepositoryContext['views'], mappedToOrganizationId: string | null) => (mappedToOrganizationId === null
  ? isNull(views.uniqueFindingScores.organizationId)
  : eq(views.uniqueFindingScores.organizationId, mappedToOrganizationId));

const uniqueFindingInputColumns = (views: RepositoryContext['views']) => ({
  cveRef: views.assetEvidence.cveId,
  mitreTechniqueRef: views.assetEvidence.mitreTechniqueId,
  expectationType: views.assetEvidence.expectationType,
  scores: sql<Array<number>>`coalesce(array_agg(${views.findingScores.score}) filter (where ${views.findingScores.score} is not null), array[]::double precision[])`,
  affectedAssetCount: countDistinct(views.assetEvidence.supportingAssetId),
  firstSeenAt: sql<Date>`min(${views.assetEvidence.createdAt})`.mapWith((value: string) => new Date(value)),
});

const uniqueFindingHistoryWhere = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  params: { cveId: string, mappedToOrganizationId: string | null },
) => and(
  inArray(views.uniqueFindingScoreHistory.cveId, db.select({ id: views.cve.id }).from(views.cve).where(eq(views.cve.cveId, params.cveId))),
  params.mappedToOrganizationId === null
    ? isNull(views.uniqueFindingScoreHistory.organizationId)
    : eq(views.uniqueFindingScoreHistory.organizationId, params.mappedToOrganizationId),
);

/** The stored unique findings the source reports at least one applicable member of, in the estate. */
const uniqueFindingsReportedBySource = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, scope: UniqueFindingScope) => {
  const reporting = findingsReportedBySource({ db, views }, scope.source);
  if (reporting === undefined) {
    return undefined;
  }
  const reportedMemberWhere = (kind: PgColumn) => and(
    isNotNull(kind),
    uniqueFindingMemberWhere({ db, views }, scope.mappedToOrganizationId),
    reporting,
  );
  // Distinct, or a large estate's list outgrows the hash a subplan under `or` needs and is rescanned per row.
  const reportedCves = db
    .selectDistinct({ cveId: views.assetEvidence.cveId })
    .from(views.assetEvidence)
    .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
    .where(reportedMemberWhere(views.assetEvidence.cveId));
  const reportedTechniques = db
    .selectDistinct({ mitreTechniqueId: views.assetEvidence.mitreTechniqueId, expectationType: views.assetEvidence.expectationType })
    .from(views.assetEvidence)
    .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
    .where(reportedMemberWhere(views.assetEvidence.mitreTechniqueId));
  return or(
    inArray(views.uniqueFindingScores.cveId, reportedCves),
    sql`(${views.uniqueFindingScores.mitreTechniqueId}, ${views.uniqueFindingScores.expectationType}) in (${reportedTechniques})`,
  );
};

/**
 * Each technique finding of an estate with the verdict it carried at `upTo`, which the stored
 * verdict cannot answer, for a read that tallies the whole estate.
 */
const estateRunVerdictsUpTo = (
  ctx: Pick<RepositoryContext, 'db' | 'views'>,
  mappedToOrganizationId: string | null,
  upTo: Date,
) => latestVerdictsOf(
  ctx,
  and(isNotNull(ctx.views.assetEvidence.mitreTechniqueId), findingsOnEstate(ctx, mappedToOrganizationId))!,
  { upTo },
);

/**
 * Every source that reports a finding, as an array on the row. One canonical finding can carry
 * several reporting connectors (CAP-3); a scalar subquery avoids grouping the whole projection
 * just to aggregate this one column.
 */
const reportingSources = ({ views }: Pick<RepositoryContext, 'views'>) => sql<Array<string>>`(
  select coalesce(array_agg(distinct ${views.integrationSettings.source}) filter (where ${views.integrationSettings.source} is not null), array[]::text[])
  from ${views.assetEvidenceSources}
  left join ${views.integrationSettings} on ${views.integrationSettings.id} = ${views.assetEvidenceSources.connectorId}
  where ${views.assetEvidenceSources.assetEvidenceId} = ${views.assetEvidence.id}
)`;

/** Two sources may report different OS families, and neither is preferred. */
const assetPlatforms = ({ views }: Pick<RepositoryContext, 'views'>) => sql<Array<string>>`(
  select coalesce(array_agg(distinct ${views.supportingAssetMachineProperties.platform} order by ${views.supportingAssetMachineProperties.platform}) filter (where ${views.supportingAssetMachineProperties.platform} is not null), array[]::text[])
  from ${views.supportingAssetSources}
  inner join ${views.supportingAssetMachineProperties} on ${views.supportingAssetMachineProperties.supportingAssetSourceId} = ${views.supportingAssetSources.id}
  where ${views.supportingAssetSources.supportingAssetId} = ${views.assetEvidence.supportingAssetId}
)`;

/**
 * The columns the score is computed from, and none of the labels a screen puts beside them.
 *
 * The recompute subscribes to every table its statements touch, so a column joined in here for a
 * surface buys a full-estate recompute on every change of the table it came from.
 */
const scoringColumns = (views: RepositoryContext['views']) => ({
  evidenceId: views.assetEvidence.id,
  supportingAssetId: views.assetEvidence.supportingAssetId,
  assetExposure: views.supportingAssets.exposure,
  assetCriticality: views.supportingAssets.criticality,
  assetCategoryId: views.supportingAssets.categoryId,
  assetSubcategoryId: views.supportingAssets.subcategoryId,
  evaluatedAt: views.assetEvidence.evaluatedAt,
  evidenceCreatedAt: views.assetEvidence.createdAt,
  cveRowId: views.cve.id,
  cveId: views.cve.cveId,
  cvssVector: views.cve.cvssVector,
  cvssV2UserInteractionRequired: views.cve.cvssV2UserInteractionRequired,
  epss: views.cve.epss,
  kevUpdatedAt: views.cve.kevUpdatedAt,
  currentState: views.assetEvidence.currentState,
  currentStateSince: views.assetEvidence.currentStateSince,
});

const findScoringInputsQuery = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>) =>
  db
    .select(scoringColumns(views))
    .from(views.assetEvidence)
    .innerJoin(views.supportingAssets, eq(views.assetEvidence.supportingAssetId, views.supportingAssets.id))
    .leftJoin(views.cve, eq(views.assetEvidence.cveId, views.cve.id))
    .$dynamic();

const findScoredEvidenceQuery = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>) =>
  db
    .select({
      ...scoringColumns(views),
      assetName: views.supportingAssets.name,
      assetDerivedName: views.supportingAssets.derivedName,
      assetLastSeenAt: views.supportingAssets.lastSeenAt,
      assetOwnerName: views.users.name,
      sources: reportingSources({ views }),
      cveTitle: views.cve.cveTitle,
    })
    .from(views.assetEvidence)
    .innerJoin(views.supportingAssets, eq(views.assetEvidence.supportingAssetId, views.supportingAssets.id))
    .leftJoin(views.users, eq(views.supportingAssets.ownerId, views.users.id))
    .leftJoin(views.cve, eq(views.assetEvidence.cveId, views.cve.id))
    .$dynamic();

/**
 * Reads over other modules' views: the finding score owns no table, and every row it scores lives
 * in the supporting-assets, cve and mitre-attack modules.
 */
export const findingScoreRepository = defineRepository({
  /** Every finding in scope with the asset attributes, the flaw signals and the latest state the score reads. */
  findScoredEvidence: async ({ db, views }, scope: EvidenceScope = {}) =>
    findScoredEvidenceQuery({ db, views }).where(evidenceScopeWhere(views, scope)),

  /** The rows of `findScoredEvidence` cut to the scoring columns: what the recompute runs. */
  findScoringInputs: async ({ db, views }, scope: EvidenceScope = {}) =>
    findScoringInputsQuery({ db, views }).where(evidenceScopeWhere(views, scope)),

  /** Keyset rather than `offset`, which would re-scan everything already written. Short batch means last. */
  findEvidenceIdBatch: async ({ db, views }, params: { afterEvidenceId: string | null, limit: number }) => {
    const rows = await db
      .select({ id: views.assetEvidence.id })
      .from(views.assetEvidence)
      .where(and(
        isScoredFinding(views),
        params.afterEvidenceId === null ? undefined : gt(views.assetEvidence.id, params.afterEvidenceId),
      ))
      .orderBy(asc(views.assetEvidence.id))
      .limit(params.limit);
    return rows.map((row) => row.id);
  },

  /** Read as a set rather than folded out of the rows, which would mean holding every row. */
  findScoringKeysInScope: async ({ db, views }, scope: EvidenceScope = {}) => {
    const where = evidenceScopeWhere(views, scope);
    const [cveRows, categoryRows] = await Promise.all([
      db.selectDistinct({ id: views.assetEvidence.cveId }).from(views.assetEvidence).where(where),
      db
        .selectDistinct({ categoryId: views.supportingAssets.categoryId })
        .from(views.assetEvidence)
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
        .where(where),
    ]);
    return {
      cveRowIds: cveRows.map((row) => row.id).filter((id): id is string => id !== null),
      categoryIds: categoryRows.map((row) => row.categoryId),
    };
  },

  /**
   * The stock of findings as it stood at `before`, replayed from creation and dismissal history.
   *
   * A finding counted at that instant when it already existed and the last state written before it
   * was applicable. A finding with no earlier history row has never left the state it was created
   * in, so it counted too. Every history row counts whatever wrote it: a person's decision and a
   * reset handing control back to automation moved the stock exactly as a connector's verdict did,
   * which is why `origin` is not filtered here.
   *
   * `windowStart` narrows the third figure to the findings born inside the window ending at
   * `before`, on the same applicable-at-`before` set, so it compares with a live new-count taken
   * over applicable findings alone.
   */
  findApplicableStockBefore: async ({ db, views }, before: Date, windowStart: Date) => {
    // eslint-disable-next-line app/no-distinct-on-subquery -- tenant-wide, joining the CVE findings inside measured no faster
    const stateBefore = db
      .selectDistinctOn([views.assetEvidenceHistory.assetEvidenceId], {
        assetEvidenceId: views.assetEvidenceHistory.assetEvidenceId,
        state: views.assetEvidenceHistory.state,
      })
      .from(views.assetEvidenceHistory)
      .where(lt(views.assetEvidenceHistory.stateChangedAt, before))
      .orderBy(
        views.assetEvidenceHistory.assetEvidenceId,
        desc(views.assetEvidenceHistory.stateChangedAt),
        desc(views.assetEvidenceHistory.id),
      )
      .as('state_before');

    const [row] = await db
      .select({
        findingCount: count(),
        impactedAssetCount: countDistinct(views.assetEvidence.supportingAssetId),
        createdInWindowCount: sql<number>`count(*) filter (where ${gte(views.assetEvidence.createdAt, windowStart)})`,
      })
      .from(views.assetEvidence)
      .leftJoin(stateBefore, eq(stateBefore.assetEvidenceId, views.assetEvidence.id))
      .where(and(
        isScoredFinding(views),
        lt(views.assetEvidence.createdAt, before),
        or(isNull(stateBefore.state), eq(stateBefore.state, 'applicable')),
      ));

    return {
      findingCount: Number(row?.findingCount ?? 0),
      impactedAssetCount: Number(row?.impactedAssetCount ?? 0),
      createdInWindowCount: Number(row?.createdInWindowCount ?? 0),
    };
  },

  /**
   * Which controls each security-platform family implements, one row per pair.
   *
   * The junction is a platform reference table with no tenant column, so every tenant reads the
   * same mapping. It is what scopes a test result: a platform's verdict speaks for the controls it
   * implements and stays silent on the others.
   */
  findControlsByPlatformType: async ({ db, views }) =>
    db
      .select({
        platformTypeKey: views.securityPlatformFamilies.platformTypeKey,
        capabilityId: views.securityPlatformFamilyControls.capabilityId,
      })
      .from(views.securityPlatformFamilyControls)
      .innerJoin(
        views.securityPlatformFamilies,
        eq(views.securityPlatformFamilies.id, views.securityPlatformFamilyControls.familyId),
      ),

  /** The tenant's inventory, by asset family and exposure, which is what weighs each family. */
  findAssetCountsByCategoryAndExposure: async ({ db, views }) =>
    db
      .select({
        categoryId: views.supportingAssets.categoryId,
        exposure: views.supportingAssets.exposure,
        assetCount: count(),
      })
      .from(views.supportingAssets)
      .groupBy(views.supportingAssets.categoryId, views.supportingAssets.exposure),

  /**
   * What the platform's expectation runs observed on the given techniques, at one scope.
   *
   * Every row of `asset_evidence` carrying an expectation type is one technique tried on one asset
   * by one platform, and the tally counts those rows, never their verdicts. A source logs a verdict
   * only when it changes, so counting verdicts would report three identical failed runs as one and
   * would move the tally whenever a result flipped rather than whenever the platform ran.
   *
   * The verdict read is the latest test result, never the finding's state, which a person may have
   * decided: a dismissed verdict is the expectation holding, which is why `held` counts dismissed.
   *
   * `lastRunAt` is the later of the platform's own evaluation date, which advances on every sync,
   * and the verdict's test date.
   *
   * Passing `supportingAssetId` narrows the reading to one asset; omitting it reads the estate.
   */
  findTechniqueTestRecords: async (
    { db, views },
    techniqueIds: Array<string>,
    supportingAssetId?: string,
  ) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    const latestVerdict = storedFindingVerdict({ views });

    return db
      .select({
        mitreTechniqueId: views.assetEvidence.mitreTechniqueId,
        expectationType: views.assetEvidence.expectationType,
        held: count(sql`case when ${latestVerdict.state} = 'dismissed' then 1 end`),
        total: count(),
        assetCount: countDistinct(views.assetEvidence.supportingAssetId),
        // The driver hands an aggregate back as a raw string, so the column's own mapper is what
        // makes this a Date rather than something that merely types as one.
        lastRunAt: sql<Date | null>`max(greatest(${views.assetEvidence.evaluatedAt}, ${latestVerdict.observedAt}))`
          .mapWith(views.assetEvidence.evaluatedAt),
      })
      .from(views.assetEvidence)
      .where(and(
        latestVerdict.spoken,
        inArray(views.assetEvidence.mitreTechniqueId, techniqueIds),
        supportingAssetId === undefined
          ? undefined
          : eq(views.assetEvidence.supportingAssetId, supportingAssetId),
      ))
      .groupBy(views.assetEvidence.mitreTechniqueId, views.assetEvidence.expectationType);
  },

  /**
   * How many distinct assets carry an expectation on each technique, across every expectation type.
   *
   * Read on its own rather than off `findTechniqueTestRecords`, whose rows are grouped by type: two
   * disjoint sets of assets, one prevention and one detection, are two counts that neither add nor
   * subsume one another, so no arithmetic over those rows yields the fleet the technique is tested on.
   */
  findFleetAssetCountsByTechnique: async ({ db, views }, techniqueIds: Array<string>) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    return db
      .select({
        mitreTechniqueId: views.assetEvidence.mitreTechniqueId,
        assetCount: countDistinct(views.assetEvidence.supportingAssetId),
      })
      .from(views.assetEvidence)
      .where(inArray(views.assetEvidence.mitreTechniqueId, techniqueIds))
      .groupBy(views.assetEvidence.mitreTechniqueId);
  },

  /**
   * Which platform's runs let a technique through on this asset, one row per expectation type.
   *
   * `findTechniqueTestRecords` folds the platform away, and a control is disproved only by a run of
   * a platform that implements it: read without the platform, one product failing would strike
   * through every declaration standing on the technique, including those it never exercised.
   */
  findLetThroughPlatformsByTechnique: async (
    { db, views },
    techniqueIds: Array<string>,
    supportingAssetId: string,
  ) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    const latestVerdict = storedFindingVerdict({ views });

    return db
      .select({
        mitreTechniqueId: views.assetEvidence.mitreTechniqueId,
        expectationType: views.assetEvidence.expectationType,
        securityPlatformType: views.assetEvidence.securityPlatformType,
        held: count(sql`case when ${latestVerdict.state} = 'dismissed' then 1 end`),
        total: count(),
      })
      .from(views.assetEvidence)
      .where(and(
        latestVerdict.spoken,
        inArray(views.assetEvidence.mitreTechniqueId, techniqueIds),
        eq(views.assetEvidence.supportingAssetId, supportingAssetId),
      ))
      .groupBy(
        views.assetEvidence.mitreTechniqueId,
        views.assetEvidence.expectationType,
        views.assetEvidence.securityPlatformType,
      );
  },

  /** Over every technique the asset was tested on, counted as `findTechniqueTestRecords` counts them. */
  findAssetTechniqueTestRecords: async ({ db, views }, supportingAssetId: string) => {
    const latestVerdict = storedFindingVerdict({ views });
    return db
      .select({
        mitreTechniqueId: sql<string>`${views.assetEvidence.mitreTechniqueId}`,
        expectationType: views.assetEvidence.expectationType,
        held: count(sql`case when ${latestVerdict.state} = 'dismissed' then 1 end`),
        total: count(),
      })
      .from(views.assetEvidence)
      .where(and(
        latestVerdict.spoken,
        eq(views.assetEvidence.supportingAssetId, supportingAssetId),
        isNotNull(views.assetEvidence.mitreTechniqueId),
      ))
      .groupBy(views.assetEvidence.mitreTechniqueId, views.assetEvidence.expectationType);
  },

  findTechniqueTestPlatforms: async ({ db, views }, mitreTechniqueId: string, supportingAssetId: string) => {
    const latestVerdict = storedFindingVerdict({ views });
    return db
      .select({
        expectationType: views.assetEvidence.expectationType,
        securityPlatformType: views.assetEvidence.securityPlatformType,
        held: count(sql`case when ${latestVerdict.state} = 'dismissed' then 1 end`),
        total: count(),
        lastRunAt: sql<Date | null>`max(greatest(${views.assetEvidence.evaluatedAt}, ${latestVerdict.observedAt}))`
          .mapWith(views.assetEvidence.evaluatedAt),
      })
      .from(views.assetEvidence)
      .where(and(
        latestVerdict.spoken,
        eq(views.assetEvidence.mitreTechniqueId, mitreTechniqueId),
        eq(views.assetEvidence.supportingAssetId, supportingAssetId),
      ))
      .groupBy(views.assetEvidence.expectationType, views.assetEvidence.securityPlatformType);
  },

  /** Names of the given controls, for a surface that lists what stands on a technique. */
  findCapabilityNames: async ({ db, views }, capabilityIds: Array<string>) => {
    if (capabilityIds.length === 0) {
      return [];
    }
    return db
      .select({
        id: views.controlCapabilities.id,
        externalId: views.controlCapabilities.externalId,
        name: views.controlCapabilities.name,
      })
      .from(views.controlCapabilities)
      .where(inArray(views.controlCapabilities.id, capabilityIds));
  },

  /**
   * How many other assets still carry the same flaw, which the detail header turns into a navigation.
   *
   * Set-aside findings split here rather than counting alike: an accepted risk is the flaw standing
   * on an asset the organisation chose to live with, where a false positive says the flaw was never
   * there and a connector's dismissal says it is no longer seen. Only the first is an impacted asset.
   */
  countOtherImpactedAssets: async (
    { db, views },
    { cveId, supportingAssetId }: { cveId: string, supportingAssetId: string },
  ) => {
    const latest = latestEvidenceState({ db, views }, views.assetEvidence.id);

    const rows = await db
      .select({ value: countDistinct(views.assetEvidence.supportingAssetId) })
      .from(views.assetEvidence)
      .innerJoin(views.cve, eq(views.assetEvidence.cveId, views.cve.id))
      .where(and(
        eq(views.cve.cveId, cveId),
        ne(views.assetEvidence.supportingAssetId, supportingAssetId),
        // A `case`, since Postgres orders the operands of an `or` as it likes: the history is read for a dismissed finding alone.
        sql`case
          when ${ne(views.assetEvidence.currentState, 'dismissed')} then true
          else (select ${latest.dismissalType} from ${latest}) = 'risk_accepted'
        end`,
      ));
    return rows.at(0)?.value ?? 0;
  },

  /**
   * A row is rewritten only when something in it changed, or an untouched estate would be rewritten
   * hourly, none of it HOT since the score sits in the ordering index.
   */
  upsertFindingScoreBatch: async ({ db }, rows: Array<typeof findingScores.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(findingScores).values(rows).onConflictDoUpdate({
      target: [findingScores.assetEvidenceId],
      set: {
        score: sql`excluded.score`,
        band: sql`excluded.band`,
        exploitability: sql`excluded.exploitability`,
        impact: sql`excluded.impact`,
        potentialImpact: sql`excluded.potential_impact`,
        exploitationLetThrough: sql`excluded.exploitation_let_through`,
        impactLetThrough: sql`excluded.impact_let_through`,
        reachability: sql`excluded.reachability`,
        threat: sql`excluded.threat`,
        weakestTechniqueId: sql`excluded.weakest_technique_id`,
        scoreChangedAt: sql`excluded.score_changed_at`,
      },
      // The timestamp is what the write sets, so including it would make every row differ from itself.
      setWhere: sql`(
        ${findingScores.score}, ${findingScores.band},
        ${findingScores.exploitability}, ${findingScores.impact},
        ${findingScores.potentialImpact}, ${findingScores.exploitationLetThrough},
        ${findingScores.impactLetThrough}, ${findingScores.reachability},
        ${findingScores.threat}, ${findingScores.weakestTechniqueId}
      ) is distinct from (
        excluded.score, excluded.band,
        excluded.exploitability, excluded.impact,
        excluded.potential_impact, excluded.exploitation_let_through,
        excluded.impact_let_through, excluded.reachability,
        excluded.threat, excluded.weakest_technique_id
      )`,
    });
  },

  /**
   * The estates holding a CVE on an applicable finding: one row per estate, a null `organizationId`
   * standing for the whole tenant and a scope id for a closed scope. Reads existence only, never the score.
   */
  findCveEstates: async ({ db, views }, cveRowId: string) =>
    db
      .selectDistinct({ organizationId: views.uniqueFindingScores.organizationId })
      .from(views.uniqueFindingScores)
      .where(eq(views.uniqueFindingScores.cveId, cveRowId)),

  /** Read inside the run's transaction and before the upsert, while the stored row is still the previous one. */
  findStoredScoreBandings: async ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return [];
    }
    return db
      .select({
        assetEvidenceId: views.findingScores.assetEvidenceId,
        score: views.findingScores.score,
        band: views.findingScores.band,
      })
      .from(views.findingScores)
      .where(inArray(views.findingScores.assetEvidenceId, evidenceIds));
  },

  insertFindingScoreHistoryBatch: async ({ db }, rows: Array<typeof findingScoreHistory.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(findingScoreHistory).values(rows);
  },

  /**
   * A line older than the retention survives while no more recent line of the same finding is
   * itself past it. Deleting on the date alone would drop every line of a finding whose score has
   * not moved in six months, and that finding would then vanish from every count before its next
   * movement: what the window needs is the value in force when it opens.
   */
  trimFindingScoreHistory: async ({ db }, before: Date) => {
    await db.delete(findingScoreHistory).where(and(
      lt(findingScoreHistory.changedAt, before),
      exists(sql`(select 1 from ${findingScoreHistory} newer
        where newer.asset_evidence_id = ${findingScoreHistory.assetEvidenceId}
          and newer.changed_at > ${findingScoreHistory.changedAt}
          and newer.changed_at < ${before})`),
    ));
  },

  /** The same set the panel prints, so a day's recorded figure and its card cannot disagree. */
  countApplicableFindingsByBand: async ({ db, views }) =>
    db
      .select({ band: views.findingScores.band, value: count() })
      .from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .where(eq(views.assetEvidence.currentState, 'applicable'))
      .groupBy(views.findingScores.band),

  /**
   * The worst applicable finding and the applicable findings counted by band. The counts are window
   * aggregates taken before the `limit`, so both come from one snapshot: a recompute committing
   * between two statements could otherwise pair an old worst finding with new counts.
   */
  findAssetPostureInputs: async ({ db, views }, supportingAssetId: string) => {
    const bands = exploitabilityBandConditions(views);
    const inBand = (condition: SQL) => sql<number>`(count(case when ${condition} then 1 end) over ())::int`;
    const rows = await db
      .select({
        critical: inBand(bands.critical),
        high: inBand(bands.high),
        medium: inBand(bands.medium),
        low: inBand(bands.low),
        evidenceId: views.findingScores.assetEvidenceId,
        exploitability: views.findingScores.exploitability,
        impact: views.findingScores.impact,
        score: views.findingScores.score,
        name: views.cve.cveId,
      })
      .from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .innerJoin(views.cve, eq(views.assetEvidence.cveId, views.cve.id))
      .where(and(eq(views.assetEvidence.supportingAssetId, supportingAssetId), applicableWithExploitability(views)))
      .orderBy(
        desc(views.findingScores.exploitability),
        desc(views.findingScores.score),
        asc(views.findingScores.assetEvidenceId),
      )
      .limit(1);
    return rows.at(0) ?? null;
  },

  /** The worst finding is picked in `findAssetPostureInputs`' order, so the journal names the one the dialog names. */
  findEstatePostureInputs: async ({ db, views }) => {
    const bands = exploitabilityBandConditions(views);
    const inBand = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`;
    return db
      .select({
        supportingAssetId: views.assetEvidence.supportingAssetId,
        worstEvidenceId: sql<string>`(array_agg(${views.findingScores.assetEvidenceId} order by ${views.findingScores.exploitability} desc, ${views.findingScores.score} desc, ${views.findingScores.assetEvidenceId} asc))[1]`,
        worstExploitability: sql<number>`max(${views.findingScores.exploitability})`.mapWith(Number),
        critical: inBand(bands.critical),
        high: inBand(bands.high),
        medium: inBand(bands.medium),
        low: inBand(bands.low),
      })
      .from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .where(applicableWithExploitability(views))
      .groupBy(views.assetEvidence.supportingAssetId);
  },

  /** A row whose score did not move is not rewritten, so a settled estate rings no doorbell for the asset list. */
  upsertAssetPostureBatch: async ({ db }, rows: Array<typeof assetPostures.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(assetPostures).values(rows).onConflictDoUpdate({
      target: [assetPostures.supportingAssetId],
      set: { score: sql`excluded.score` },
      setWhere: sql`${assetPostures.score} is distinct from excluded.score`,
    });
  },

  /** Read inside the run's transaction and before the upsert, while the stored row is still the previous one. */
  findStoredAssetPostureScores: async ({ db, views }, supportingAssetIds: Array<string>) => {
    if (supportingAssetIds.length === 0) {
      return [];
    }
    return db
      .select({ supportingAssetId: views.assetPostures.supportingAssetId, score: views.assetPostures.score })
      .from(views.assetPostures)
      .where(inArray(views.assetPostures.supportingAssetId, supportingAssetIds));
  },

  deleteAssetPosturesWithoutApplicableFinding: async ({ db, views }): Promise<Array<string>> => {
    const removed = await db.delete(assetPostures).where(notExists(
      db.select({ one: sql`1` })
        .from(views.findingScores)
        .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
        .where(and(eq(views.assetEvidence.supportingAssetId, assetPostures.supportingAssetId), applicableWithExploitability(views))),
    )).returning();
    return removed.map((row) => row.supportingAssetId);
  },

  insertAssetPostureHistoryBatch: async ({ db }, rows: Array<typeof assetPostureHistory.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(assetPostureHistory).values(rows);
  },

  /** The line in force at the cut-off survives it, so a window's start is never empty. */
  trimAssetPostureHistory: async ({ db }, before: Date) => {
    await db.delete(assetPostureHistory).where(and(
      lt(assetPostureHistory.changedAt, before),
      exists(sql`(select 1 from ${assetPostureHistory} newer
        where newer.supporting_asset_id = ${assetPostureHistory.supportingAssetId}
          and newer.changed_at > ${assetPostureHistory.changedAt}
          and newer.changed_at < ${before})`),
    ));
  },

  /** Every unique finding of the whole tenant, with its members' scores, empty for a technique group. */
  findUniqueFindingInputs: async ({ db, views }) => db
    .select(uniqueFindingInputColumns(views))
    .from(views.assetEvidence)
    .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
    .where(uniqueFindingMemberWhere({ db, views }, null))
    .groupBy(views.assetEvidence.cveId, views.assetEvidence.mitreTechniqueId, views.assetEvidence.expectationType),

  /**
   * Every closed organization's unique findings over the assets mapped to it, in one pass over the
   * estate. An open organization reads the tenant's rows, though it keeps its mapping.
   */
  findOrganizationUniqueFindingInputs: async ({ db, views }) => db
    .select({ organizationId: views.organizationAssets.organizationId, ...uniqueFindingInputColumns(views) })
    .from(views.assetEvidence)
    .innerJoin(views.organizationAssets, eq(views.organizationAssets.supportingAssetId, views.assetEvidence.supportingAssetId))
    .innerJoin(views.organizations, eq(views.organizations.id, views.organizationAssets.organizationId))
    .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
    .where(and(uniqueFindingMemberWhere({ db, views }, null), eq(views.organizations.estateMode, 'closed')))
    .groupBy(
      views.organizationAssets.organizationId,
      views.assetEvidence.cveId,
      views.assetEvidence.mitreTechniqueId,
      views.assetEvidence.expectationType,
    ),

  findStoredUniqueFindingOrganizationIds: async ({ db, views }): Promise<Array<string>> => (await db
    .selectDistinct({ id: views.uniqueFindingScores.organizationId })
    .from(views.uniqueFindingScores)
    .where(isNotNull(views.uniqueFindingScores.organizationId)))
    .flatMap((row) => (row.id === null ? [] : [row.id])),

  /** Read inside the run's transaction and before the upsert, while the stored rows are still the previous ones. */
  findStoredUniqueFindingScores: async ({ db, views }, mappedToOrganizationId: string | null) => db
    .select({
      id: views.uniqueFindingScores.id,
      cveId: views.uniqueFindingScores.cveId,
      mitreTechniqueId: views.uniqueFindingScores.mitreTechniqueId,
      expectationType: views.uniqueFindingScores.expectationType,
      score: views.uniqueFindingScores.score,
      band: views.uniqueFindingScores.band,
      affectedAssetCount: views.uniqueFindingScores.affectedAssetCount,
    })
    .from(views.uniqueFindingScores)
    .where(uniqueFindingInScope(views, mappedToOrganizationId)),

  /** A row whose figures did not move is not rewritten, so a settled estate rings no doorbell. */
  upsertUniqueFindingScoreBatch: async ({ db }, rows: Array<typeof uniqueFindingScores.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(uniqueFindingScores).values(rows).onConflictDoUpdate({
      target: [
        uniqueFindingScores.tenantId,
        uniqueFindingScores.organizationId,
        uniqueFindingScores.cveId,
        uniqueFindingScores.mitreTechniqueId,
        uniqueFindingScores.expectationType,
      ],
      set: {
        score: sql`excluded.score`,
        band: sql`excluded.band`,
        worstScore: sql`excluded.worst_score`,
        affectedAssetCount: sql`excluded.affected_asset_count`,
        firstSeenAt: sql`excluded.first_seen_at`,
      },
      setWhere: sql`(
        ${uniqueFindingScores.score}, ${uniqueFindingScores.band}, ${uniqueFindingScores.worstScore},
        ${uniqueFindingScores.affectedAssetCount}, ${uniqueFindingScores.firstSeenAt}
      ) is distinct from (
        excluded.score, excluded.band, excluded.worst_score, excluded.affected_asset_count, excluded.first_seen_at
      )`,
    });
  },

  deleteUniqueFindingScores: async ({ db }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    await db.delete(uniqueFindingScores).where(inArray(uniqueFindingScores.id, ids));
  },

  insertUniqueFindingScoreHistoryBatch: async ({ db }, rows: Array<typeof uniqueFindingScoreHistory.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(uniqueFindingScoreHistory).values(rows);
  },

  /** The line in force at the cut-off survives it, so a window's start is never empty. */
  trimUniqueFindingScoreHistory: async ({ db }, before: Date) => {
    await db.delete(uniqueFindingScoreHistory).where(and(
      lt(uniqueFindingScoreHistory.changedAt, before),
      exists(sql`(select 1 from ${uniqueFindingScoreHistory} newer
        where newer.cve_id = ${uniqueFindingScoreHistory.cveId}
          and (newer.organization_id = ${uniqueFindingScoreHistory.organizationId}
            or (newer.organization_id is null and ${uniqueFindingScoreHistory.organizationId} is null))
          and newer.changed_at > ${uniqueFindingScoreHistory.changedAt}
          and newer.changed_at < ${before})`),
    ));
  },

  /** The lines since `since`, led by the one in force at `since`, oldest first. */
  findAssetPostureHistory: async ({ db, views }, supportingAssetId: string, since: Date) => {
    const history = views.assetPostureHistory;
    const inForceAtSince = db
      .select({ changedAt: sql`max(${history.changedAt})` })
      .from(history)
      .where(and(eq(history.supportingAssetId, supportingAssetId), lt(history.changedAt, since)));
    return db
      .select({
        at: history.changedAt,
        score: history.score,
        worstEvidenceId: history.worstAssetEvidenceId,
        worstName: views.cve.cveId,
        worstExploitability: history.worstExploitability,
        critical: history.criticalCount,
        high: history.highCount,
        medium: history.mediumCount,
        low: history.lowCount,
      })
      .from(history)
      .leftJoin(views.assetEvidence, eq(views.assetEvidence.id, history.worstAssetEvidenceId))
      .leftJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .where(and(
        eq(history.supportingAssetId, supportingAssetId),
        gte(history.changedAt, sql`coalesce((${inForceAtSince}), ${since})`),
      ))
      .orderBy(asc(history.changedAt));
  },

  /** The lines since `since`, led by the one in force at `since`, oldest first. */
  findFindingScoreHistory: async ({ db, views }, assetEvidenceId: string, since: Date) => {
    const history = views.findingScoreHistory;
    const inForceAtSince = db
      .select({ changedAt: sql`max(${history.changedAt})` })
      .from(history)
      .where(and(eq(history.assetEvidenceId, assetEvidenceId), lt(history.changedAt, since)));
    return db
      .select({ at: history.changedAt, score: history.score, band: history.band })
      .from(history)
      .where(and(
        eq(history.assetEvidenceId, assetEvidenceId),
        gte(history.changedAt, sql`coalesce((${inForceAtSince}), ${since})`),
      ))
      .orderBy(asc(history.changedAt));
  },

  findEvidenceStateChanges: async ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return [];
    }
    return db
      .select({
        evidenceId: views.assetEvidenceHistory.assetEvidenceId,
        state: views.assetEvidenceHistory.state,
        at: views.assetEvidenceHistory.stateChangedAt,
      })
      .from(views.assetEvidenceHistory)
      .where(inArray(views.assetEvidenceHistory.assetEvidenceId, evidenceIds))
      .orderBy(asc(views.assetEvidenceHistory.stateChangedAt), asc(views.assetEvidenceHistory.id));
  },

  /**
   * A cell that did not move is not rewritten, so a settled estate rings no doorbell. Reading the
   * stored row adds nothing to the read set: the recompute already pages over the table's keys.
   */
  upsertAssetTechniqueScoreBatch: async ({ db }, rows: Array<typeof assetTechniqueScores.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(assetTechniqueScores).values(rows).onConflictDoUpdate({
      target: [
        assetTechniqueScores.tenantId,
        assetTechniqueScores.supportingAssetId,
        assetTechniqueScores.mitreTechniqueId,
      ],
      set: { score: sql`excluded.score`, assetEvidenceId: sql`excluded.asset_evidence_id` },
      setWhere: sql`(${assetTechniqueScores.score}, ${assetTechniqueScores.assetEvidenceId}) is distinct from (excluded.score, excluded.asset_evidence_id)`,
    });
  },

  findAssetTechniqueScoreKeyPage: async (
    { db, views },
    params: { after: TechniqueScoreCellKey | null, limit: number },
  ): Promise<Array<TechniqueScoreCellKey>> => {
    const key = [views.assetTechniqueScores.supportingAssetId, views.assetTechniqueScores.mitreTechniqueId] as const;
    return db
      .select({ supportingAssetId: key[0], mitreTechniqueId: key[1] })
      .from(views.assetTechniqueScores)
      .where(params.after === null
        ? undefined
        : sql`(${key[0]}, ${key[1]}) > (${params.after.supportingAssetId}::uuid, ${params.after.mitreTechniqueId}::uuid)`)
      .orderBy(asc(key[0]), asc(key[1]))
      .limit(params.limit);
  },

  /** The keys travel as parallel arrays so the statement's shape does not vary with their count. */
  deleteAssetTechniqueScores: async ({ db }, keys: Array<TechniqueScoreCellKey>) => {
    if (keys.length === 0) {
      return;
    }
    await db.delete(assetTechniqueScores).where(sql`(
      ${assetTechniqueScores.supportingAssetId}, ${assetTechniqueScores.mitreTechniqueId}
    ) in (
      select * from unnest(
        ${sql.param(keys.map((key) => key.supportingAssetId))}::uuid[],
        ${sql.param(keys.map((key) => key.mitreTechniqueId))}::uuid[]
      )
    )`);
  },

  /** An opening that did not move is not rewritten, so a settled estate rings no doorbell. */
  upsertEntryOpeningBatch: async ({ db }, rows: Array<typeof entryOpenings.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(entryOpenings).values(rows).onConflictDoUpdate({
      target: [entryOpenings.tenantId, entryOpenings.assetEvidenceId, entryOpenings.mitreTechniqueId],
      set: {
        supportingAssetId: sql`excluded.supporting_asset_id`,
        cveId: sql`excluded.cve_id`,
        opening: sql`excluded.opening`,
        threat: sql`excluded.threat`,
      },
      setWhere: sql`(
        ${entryOpenings.supportingAssetId}, ${entryOpenings.cveId}, ${entryOpenings.opening}, ${entryOpenings.threat}
      ) is distinct from (
        excluded.supporting_asset_id, excluded.cve_id, excluded.opening, excluded.threat
      )`,
    });
  },

  /** Pages on the key inside the tenant, so Postgres walks the primary key's `(tenant_id, ...)` prefix. */
  findEntryOpeningKeyPage: async (
    { db, views },
    params: { tenantId: string, after: EntryOpeningKey | null, limit: number },
  ): Promise<Array<EntryOpeningKey>> => {
    const key = [views.entryOpenings.assetEvidenceId, views.entryOpenings.mitreTechniqueId] as const;
    return db
      .select({ assetEvidenceId: key[0], mitreTechniqueId: key[1] })
      .from(views.entryOpenings)
      .where(and(
        eq(views.entryOpenings.tenantId, params.tenantId),
        params.after === null
          ? undefined
          : sql`(${key[0]}, ${key[1]}) > (${params.after.assetEvidenceId}::uuid, ${params.after.mitreTechniqueId}::uuid)`,
      ))
      .orderBy(asc(key[0]), asc(key[1]))
      .limit(params.limit);
  },

  /** The keys travel as parallel arrays so the statement's shape does not vary with their count. */
  deleteEntryOpenings: async ({ db }, tenantId: string, keys: Array<EntryOpeningKey>) => {
    if (keys.length === 0) {
      return;
    }
    await db.delete(entryOpenings).where(and(
      eq(entryOpenings.tenantId, tenantId),
      sql`(
        ${entryOpenings.assetEvidenceId}, ${entryOpenings.mitreTechniqueId}
      ) in (
        select * from unnest(
          ${sql.param(keys.map((key) => key.assetEvidenceId))}::uuid[],
          ${sql.param(keys.map((key) => key.mitreTechniqueId))}::uuid[]
        )
      )`,
    ));
  },

  findAssetTechniqueScores: async ({ db, views }, supportingAssetId: string) => db
    .select({
      mitreTechniqueId: views.assetTechniqueScores.mitreTechniqueId,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      score: views.assetTechniqueScores.score,
      evidenceId: views.assetTechniqueScores.assetEvidenceId,
    })
    .from(views.assetTechniqueScores)
    .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.assetTechniqueScores.mitreTechniqueId))
    .where(eq(views.assetTechniqueScores.supportingAssetId, supportingAssetId)),

  /** What the door's applicability rule reads of an asset, its enabled state read as the door reads it. */
  findAssetEntryProfile: async ({ db, views }, supportingAssetId: string) => {
    const { observedEnabled, identityEnabled } = enabledIdentitiesOf({ db, views }, supportingAssetId);
    const [profile] = await db
      .select({
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        exposure: views.supportingAssets.exposure,
        identityEnabled,
      })
      .from(views.supportingAssets)
      .leftJoin(observedEnabled, eq(observedEnabled.supportingAssetId, views.supportingAssets.id))
      .where(eq(views.supportingAssets.id, supportingAssetId));
    return profile;
  },

  findTechniqueByExternalId: async ({ db, views }, externalId: string) => {
    const [technique] = await db
      .select({ id: views.mitreTechniques.id, externalId: views.mitreTechniques.externalId, name: views.mitreTechniques.name })
      .from(views.mitreTechniques)
      .where(eq(views.mitreTechniques.externalId, externalId));
    return technique;
  },

  findTechniqueScoreHolders: async ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return [];
    }
    return db
      .select({
        evidenceId: views.assetEvidence.id,
        cveRowId: views.cve.id,
        cveId: views.cve.cveId,
        cveTitle: views.cve.cveTitle,
        cvssVector: views.cve.cvssVector,
        cvssV2UserInteractionRequired: views.cve.cvssV2UserInteractionRequired,
        epss: views.cve.epss,
        kevUpdatedAt: views.cve.kevUpdatedAt,
        threat: views.findingScores.threat,
        assetExposure: views.supportingAssets.exposure,
      })
      .from(views.assetEvidence)
      .innerJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .innerJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .where(inArray(views.assetEvidence.id, evidenceIds));
  },

  upsertFindingMetricDailyBatch: async ({ db }, rows: Array<typeof findingMetricDaily.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(findingMetricDaily).values(rows).onConflictDoOverwrite({
      target: [findingMetricDaily.tenantId, findingMetricDaily.day, findingMetricDaily.metric],
      columns: ['value'],
    });
  },

  countUnscoredFindings: async (
    { db, views },
    mappedToOrganizationId: string | null = null,
    vulnerability: VulnerabilityFilter | null = null,
    search: string | null = null,
  ) => {
    const rows = await db
      .select({ value: count() })
      .from(views.assetEvidence)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .where(and(
        isScoredFinding(views),
        isNull(views.findingScores.assetEvidenceId),
        findingsOfVulnerability({ db, views }, vulnerability),
        findingsOnEstate({ db, views }, mappedToOrganizationId),
        findingsMatchingSearch({ db, views }, search, true),
      ));
    return rows.at(0)?.value ?? 0;
  },

  /**
   * Driven from the evidence joined to the projection: the ordering is the score, and starting at
   * the evidence alone would mean scoring the estate to name a page. A technique finding has no
   * score, so it sorts after every scored finding whichever direction was asked.
   *
   * Two passes. The first names the page's rows and carries only what the chosen order needs, so
   * the ordering walk sorts narrow rows and the flaw tables are joined only when the order is the
   * flaw's own name. The second decorates those rows alone, which is what keeps the per-row
   * reporting-sources aggregate off the whole offset: on a scope of forty thousand assets one pass
   * ran that aggregate seventy thousand times to serve fifty rows, and the expression count it came
   * with cost more in JIT than the rest of the query took to run.
   */
  findListedFindingsPage: async (
    { db, views },
    params: ListedFindingsFilter & { limit: number, offset: number, sortBy: FindingSortKey, sortDesc: boolean },
  ) => {
    const state = views.assetEvidence.currentState;
    // `name` sorts on whichever column carries it, either being null for half the rows.
    const sortColumns = {
      score: views.findingScores.score,
      name: sql`coalesce(${views.cve.cveId}, ${views.mitreTechniques.externalId})`,
      kind: views.assetEvidence.expectationType,
      currentState: state,
      assetName: views.supportingAssets.displayName,
      assetCategoryId: views.supportingAssets.categoryId,
      lastEvaluatedAt: views.assetEvidence.evaluatedAt,
      firstSeenAt: views.assetEvidence.createdAt,
    };
    const sortColumn = sortColumns[params.sortBy];
    // Ties broken on the id: equal scores can otherwise swap between requests, serving one row
    // twice and another never. `nulls last` either way: a null is the least informative row
    // whichever direction was asked.
    const ordering: Array<SQL> = [
      ...(params.sortBy === 'assetName'
        ? orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.displayName, params.sortDesc)
        : [params.sortDesc ? sql`${sortColumn} desc nulls last` : sql`${sortColumn} asc nulls last`]),
      asc(views.assetEvidence.id),
    ];

    const narrowed = db
      .select({ assetEvidenceId: views.assetEvidence.id })
      .from(views.assetEvidence)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      // Kept even when nothing sorts on it: it is what drops a finding whose asset the caller
      // cannot see, and a pass without it would name rows the decorating pass then removes.
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .$dynamic();
    const ordered = params.sortBy === 'name'
      ? narrowed
        .leftJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
        .leftJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.assetEvidence.mitreTechniqueId))
      : narrowed;
    const page = ordered
      .where(listedFindingsWhere({ db, views }, params))
      .orderBy(...ordering)
      .limit(params.limit)
      .offset(params.offset)
      .as('finding_page');
    // The stored state carries neither the origin nor the kind of dismissal behind it.
    const latest = latestEvidenceState({ db, views }, views.assetEvidence.id);

    return db
      .select({
        evidenceId: views.assetEvidence.id,
        supportingAssetId: views.assetEvidence.supportingAssetId,
        score: views.findingScores.score,
        band: views.findingScores.band,
        pendingVector: findingPendingVector(views),
        currentState: state,
        stateOrigin: latest.origin,
        dismissalType: latest.dismissalType,
        cveId: views.cve.cveId,
        cveTitle: views.cve.cveTitle,
        mitreTechniqueExternalId: views.mitreTechniques.externalId,
        mitreTechniqueName: views.mitreTechniques.name,
        expectationType: views.assetEvidence.expectationType,
        assetName: views.supportingAssets.name,
        assetDerivedName: views.supportingAssets.derivedName,
        assetCategoryId: views.supportingAssets.categoryId,
        assetCriticality: views.supportingAssets.criticality,
        assetPlatforms: assetPlatforms({ views }),
        assetExposure: views.supportingAssets.exposure,
        sources: reportingSources({ views }),
        // Counted rather than read off `sources`, which names live connectors only: a source whose
        // connector was deleted leaves that array empty while the finding is still reported.
        sourceCount: sql<number>`(
          select count(*)::int
          from ${views.assetEvidenceSources}
          where ${views.assetEvidenceSources.assetEvidenceId} = ${views.assetEvidence.id}
        )`,
        lastEvaluatedAt: views.assetEvidence.evaluatedAt,
        firstSeenAt: views.assetEvidence.createdAt,
      })
      .from(page)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, page.assetEvidenceId))
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, page.assetEvidenceId))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .leftJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .leftJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.assetEvidence.mitreTechniqueId))
      .leftJoinLateral(latest, LATERAL_ON)
      .orderBy(...ordering);
  },

  findStoredScoreFigures: async ({ db, views }, scope: EvidenceScope) => db
    .select({
      assetEvidenceId: views.findingScores.assetEvidenceId,
      score: views.findingScores.score,
      band: views.findingScores.band,
      exploitability: views.findingScores.exploitability,
      impact: views.findingScores.impact,
      reachability: views.findingScores.reachability,
      threat: views.findingScores.threat,
      exploitationLetThrough: views.findingScores.exploitationLetThrough,
      potentialImpact: views.findingScores.potentialImpact,
      impactLetThrough: views.findingScores.impactLetThrough,
    })
    .from(views.findingScores)
    .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
    .where(evidenceScopeWhere(views, scope)),

  /** An unscored finding has no row. */
  findScoredFindingsByEvidenceIds: async ({ db, views }, evidenceIds: Array<string>) => {
    if (evidenceIds.length === 0) {
      return [];
    }
    return db
      .select({
        evidenceId: views.findingScores.assetEvidenceId,
        score: views.findingScores.score,
        band: views.findingScores.band,
        assetCategoryId: views.supportingAssets.categoryId,
        sources: reportingSources({ views }),
        lastEvaluatedAt: views.assetEvidence.evaluatedAt,
        firstSeenAt: views.assetEvidence.createdAt,
      })
      .from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .where(inUuids(views.findingScores.assetEvidenceId, evidenceIds));
  },

  countListedFindings: async ({ db, views }, filter: ListedFindingsFilter) => {
    const rows = await db
      .select({ value: count() })
      .from(views.assetEvidence)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .where(listedFindingsWhere({ db, views }, filter));
    return rows.at(0)?.value ?? 0;
  },

  /**
   * Every source that actually reports a listed finding in the estate the caller resolved, with
   * its own count. The list's source filter is built from this rather than from the connector
   * catalogue, so it never offers a source that would return nothing. A finding two sources
   * report counts once for each. `applicableOnly` serves a list that never shows a dismissed
   * finding, which a source reporting only those would leave empty.
   */
  getFindingCountsBySource: async (
    { db, views },
    mappedToOrganizationId: string | null = null,
    applicableOnly = false,
  ) => {
    const onEstate = and(
      findingsOnEstate({ db, views }, mappedToOrganizationId),
      applicableOnly ? findingsInState(views, 'applicable') : undefined,
    );
    const bySource = await db
      .select({
        source: views.integrationSettings.source,
        findingCount: countDistinct(views.assetEvidenceSources.assetEvidenceId),
      })
      .from(views.assetEvidenceSources)
      .innerJoin(views.integrationSettings, eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId))
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceSources.assetEvidenceId))
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .where(and(isListedFinding(views), onEstate))
      .groupBy(views.integrationSettings.source);

    const userRows = await db
      .select({ value: count() })
      .from(views.assetEvidence)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .where(and(
        isListedFinding(views),
        findingReportedByNobody({ db, views }),
        onEstate,
      ));
    const userCount = userRows.at(0)?.value ?? 0;

    return [
      ...bySource,
      ...(userCount > 0 ? [{ source: NO_SOURCE, findingCount: userCount }] : []),
    ];
  },

  /**
   * The heaviest applicable vulnerabilities of the estate, each grouped over the assets it is found
   * on: a CVE, or a technique with its expectation. A group weighs as much as its worst finding,
   * and names that finding so a row can open it.
   */
  findTopVulnerabilities: async ({ db, views }, params: { mappedToOrganizationId: string | null, limit: number }) => {
    const worstScore = max(views.findingScores.score);
    const impactedAssetCount = countDistinct(views.assetEvidence.supportingAssetId);
    return db
      .select({
        cveId: views.cve.cveId,
        cveTitle: views.cve.cveTitle,
        mitreTechniqueExternalId: views.mitreTechniques.externalId,
        mitreTechniqueName: views.mitreTechniques.name,
        expectationType: views.assetEvidence.expectationType,
        score: worstScore,
        impactedAssetCount,
        worstEvidenceId: sql<string>`(array_agg(${views.assetEvidence.id} order by ${views.findingScores.score} desc nulls last, ${views.assetEvidence.id}))[1]`,
        sources: sql<Array<string>>`coalesce(array_agg(distinct ${views.integrationSettings.source}) filter (where ${views.integrationSettings.source} is not null), array[]::text[])`,
      })
      .from(views.assetEvidence)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .leftJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .leftJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.assetEvidence.mitreTechniqueId))
      .leftJoin(views.assetEvidenceSources, eq(views.assetEvidenceSources.assetEvidenceId, views.assetEvidence.id))
      .leftJoin(views.integrationSettings, eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId))
      .where(and(
        isListedFinding(views),
        findingsInState(views, 'applicable'),
        findingsOnEstate({ db, views }, params.mappedToOrganizationId),
      ))
      .groupBy(
        views.assetEvidence.cveId,
        views.assetEvidence.mitreTechniqueId,
        views.assetEvidence.expectationType,
        views.cve.cveId,
        views.cve.cveTitle,
        views.mitreTechniques.externalId,
        views.mitreTechniques.name,
      )
      .orderBy(
        sql`${worstScore} desc nulls last`,
        desc(impactedAssetCount),
        asc(sql`coalesce(${views.cve.cveId}, ${views.mitreTechniques.externalId})`),
        asc(views.assetEvidence.expectationType),
      )
      .limit(params.limit);
  },

  /**
   * A page of unique findings. Under the score order a technique group, which has no score, comes
   * after every scored group whichever direction was asked. Ties fall to the group's own
   * references, so a page never serves a row twice.
   *
   * The source picks which groups are listed and leaves their figures whole: a stored score spans
   * every source. The reporting sources are read for the page's rows only.
   */
  findUniqueFindingsPage: async (
    { db, views },
    params: UniqueFindingScope & UniqueFindingListOptions & { limit: number, offset: number, sortBy: UniqueFindingSortKey, sortDesc: boolean },
  ) => {
    const ordering = (columns: Record<'uniqueScore' | 'gainMean' | 'affectedAssetCount' | 'name' | 'firstSeenAt' | 'expectationType' | 'cveRef' | 'mitreTechniqueRef', SQL>): Array<SQL> => {
      const directed = (expression: SQL) => (params.sortDesc
        ? sql`${expression} desc nulls last`
        : sql`${expression} asc nulls last`);
      const byScore = sql`${columns.uniqueScore} desc nulls last`;
      const byBreadth = sql`${columns.affectedAssetCount} desc`;
      const byName = sql`${columns.name} asc`;
      const leading: Record<UniqueFindingSortKey, Array<SQL>> = {
        gain: [directed(columns.gainMean), byScore, byName],
        score: [directed(columns.uniqueScore), byBreadth, byName],
        affectedAssets: [directed(columns.affectedAssetCount), byScore, byName],
        name: [directed(columns.name)],
        // The oldest group is the one first seen earliest, so a descending age reads the date ascending.
        age: [params.sortDesc ? sql`${columns.firstSeenAt} asc` : sql`${columns.firstSeenAt} desc`, byScore, byName],
      };
      return [
        ...leading[params.sortBy],
        sql`${columns.expectationType} asc nulls first`,
        sql`${columns.cveRef} asc nulls last`,
        sql`${columns.mitreTechniqueRef} asc nulls last`,
      ];
    };

    const stored = views.uniqueFindingScores;
    const name = sql<string | null>`coalesce(${views.cve.cveId}, ${views.mitreTechniques.externalId})`;
    const gains = views.crqCveWhatIfResults;
    const gainRunId = params.gainRunId ?? null;
    const noGain = (alias: string) => sql<number | null>`null::double precision`.as(alias);
    const unjoinedPage = db
      .select({
        cveRef: stored.cveId,
        mitreTechniqueRef: stored.mitreTechniqueId,
        expectationType: stored.expectationType,
        vulnerabilityName: name.as('vulnerability_name'),
        uniqueScore: stored.score,
        worstScore: stored.worstScore,
        affectedAssetCount: stored.affectedAssetCount,
        firstSeenAt: stored.firstSeenAt,
        gainMean: gainRunId === null ? noGain('gain_mean') : gains.aleReductionMean,
        gainP10: gainRunId === null ? noGain('gain_p10') : gains.aleReductionP10,
        gainP90: gainRunId === null ? noGain('gain_p90') : gains.aleReductionP90,
      })
      .from(stored)
      .leftJoin(views.cve, eq(views.cve.id, stored.cveId))
      .leftJoin(views.mitreTechniques, eq(views.mitreTechniques.id, stored.mitreTechniqueId))
      .$dynamic();
    const joinedPage = gainRunId === null
      ? unjoinedPage
      : unjoinedPage.leftJoin(gains, and(eq(gains.runId, gainRunId), eq(gains.cveId, stored.cveId)));
    const page = joinedPage
      .where(and(
        uniqueFindingInScope(views, params.mappedToOrganizationId),
        params.cveOnly ? isNotNull(stored.cveId) : undefined,
        uniqueFindingsReportedBySource({ db, views }, params),
        uniqueFindingsMatchingSearch({ db, views }, params.search),
      ))
      .orderBy(...ordering({
        uniqueScore: sql`${stored.score}`,
        gainMean: gainRunId === null ? sql`null` : sql`${gains.aleReductionMean}`,
        affectedAssetCount: sql`${stored.affectedAssetCount}`,
        name,
        firstSeenAt: sql`${stored.firstSeenAt}`,
        expectationType: sql`${stored.expectationType}`,
        cveRef: sql`${stored.cveId}`,
        mitreTechniqueRef: sql`${stored.mitreTechniqueId}`,
      }))
      .limit(params.limit)
      .offset(params.offset)
      .as('unique_finding_page');

    const rows = await db
      .select({
        cveRef: page.cveRef,
        mitreTechniqueRef: page.mitreTechniqueRef,
        expectationType: page.expectationType,
        cveId: views.cve.cveId,
        cveTitle: views.cve.cveTitle,
        kevUpdatedAt: views.cve.kevUpdatedAt,
        epss: views.cve.epss,
        mitreTechniqueExternalId: views.mitreTechniques.externalId,
        mitreTechniqueName: views.mitreTechniques.name,
        uniqueScore: page.uniqueScore,
        worstScore: page.worstScore,
        gainMean: page.gainMean,
        gainP10: page.gainP10,
        gainP90: page.gainP90,
        pendingVector: uniqueCvePendingVector({ db, views }, page, params.mappedToOrganizationId),
        affectedAssetCount: page.affectedAssetCount,
        firstSeenAt: page.firstSeenAt,
      })
      .from(page)
      .leftJoin(views.cve, eq(views.cve.id, page.cveRef))
      .leftJoin(views.mitreTechniques, eq(views.mitreTechniques.id, page.mitreTechniqueRef))
      .orderBy(...ordering({
        uniqueScore: sql`${page.uniqueScore}`,
        gainMean: sql`${page.gainMean}`,
        affectedAssetCount: sql`${page.affectedAssetCount}`,
        name: sql`${page.vulnerabilityName}`,
        firstSeenAt: sql`${page.firstSeenAt}`,
        expectationType: sql`${page.expectationType}`,
        cveRef: sql`${page.cveRef}`,
        mitreTechniqueRef: sql`${page.mitreTechniqueRef}`,
      }));

    // One read for the whole page, not one per row: a subquery per row is planned for a group of
    // average size, and a page of small groups then scans every source once per row.
    const groupKey = (group: { cveRef: string | null, mitreTechniqueRef: string | null, expectationType: string | null }) =>
      `${group.cveRef}|${group.mitreTechniqueRef}|${group.expectationType}`;
    const cveRefs = rows.flatMap((row) => (row.cveRef === null ? [] : [row.cveRef]));
    const techniqueGroups = rows.flatMap((row) => (row.mitreTechniqueRef === null || row.expectationType === null
      ? []
      : [and(eq(views.assetEvidence.mitreTechniqueId, row.mitreTechniqueRef), eq(views.assetEvidence.expectationType, row.expectationType))]));
    const groupSources = rows.length === 0 ? [] : await db
      .select({
        cveRef: views.assetEvidence.cveId,
        mitreTechniqueRef: views.assetEvidence.mitreTechniqueId,
        expectationType: views.assetEvidence.expectationType,
        sources: sql<Array<string>>`coalesce(array_agg(distinct ${views.integrationSettings.source}) filter (where ${views.integrationSettings.source} is not null), array[]::text[])`,
      })
      .from(views.assetEvidenceSources)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceSources.assetEvidenceId))
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .leftJoin(views.integrationSettings, eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId))
      .where(and(
        or(cveRefs.length === 0 ? undefined : inArray(views.assetEvidence.cveId, cveRefs), ...techniqueGroups),
        uniqueFindingMemberWhere({ db, views }, params.mappedToOrganizationId),
      ))
      .groupBy(views.assetEvidence.cveId, views.assetEvidence.mitreTechniqueId, views.assetEvidence.expectationType);
    const sourcesByGroup = new Map(groupSources.map((group) => [groupKey(group), group.sources]));
    return rows.map((row) => ({ ...row, sources: sourcesByGroup.get(groupKey(row)) ?? [] }));
  },

  countUniqueFindings: async ({ db, views }, scope: UniqueFindingScope & Pick<UniqueFindingListOptions, 'cveOnly'>) => {
    const [row] = await db
      .select({ value: count() })
      .from(views.uniqueFindingScores)
      .where(and(
        uniqueFindingInScope(views, scope.mappedToOrganizationId),
        scope.cveOnly ? isNotNull(views.uniqueFindingScores.cveId) : undefined,
        uniqueFindingsReportedBySource({ db, views }, scope),
        uniqueFindingsMatchingSearch({ db, views }, scope.search),
      ));
    return row?.value ?? 0;
  },

  /**
   * Read live under the predicate the run stores the tab's rows by, so the figures match the tab once
   * the run has settled. A known technique with no applicable member comes back empty, not undefined.
   */
  findUniqueTechniqueFinding: async (
    { db, views },
    params: { externalId: string, expectationType: ExpectationType, mappedToOrganizationId: string | null },
  ) => {
    const [technique] = await db
      .select({
        id: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        description: views.mitreTechniques.description,
      })
      .from(views.mitreTechniques)
      .where(eq(views.mitreTechniques.externalId, params.externalId));
    if (technique === undefined) {
      return undefined;
    }

    const memberWhere = and(
      eq(views.assetEvidence.mitreTechniqueId, technique.id),
      eq(views.assetEvidence.expectationType, params.expectationType),
      uniqueFindingMemberWhere({ db, views }, params.mappedToOrganizationId),
    );
    const [[figures], tactics, platforms, sources] = await Promise.all([
      db
        .select({
          affectedAssetCount: countDistinct(views.assetEvidence.supportingAssetId),
          firstSeenAt: sql<Date | null>`min(${views.assetEvidence.createdAt})`.mapWith((value: string) => new Date(value)),
          lastSeenAt: sql<Date | null>`max(${views.assetEvidence.evaluatedAt})`.mapWith((value: string) => new Date(value)),
        })
        .from(views.assetEvidence)
        .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
        .where(memberWhere),
      db
        .select({ externalId: views.mitreTactics.externalId, name: views.mitreTactics.name })
        .from(views.mitreTechniqueTactics)
        .innerJoin(views.mitreTactics, eq(views.mitreTactics.id, views.mitreTechniqueTactics.tacticId))
        .where(eq(views.mitreTechniqueTactics.techniqueId, technique.id))
        .orderBy(asc(views.mitreTactics.order)),
      db
        .selectDistinct({ platform: views.supportingAssetMachineProperties.platform })
        .from(views.assetEvidence)
        .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
        .innerJoin(views.supportingAssetSources, eq(views.supportingAssetSources.supportingAssetId, views.assetEvidence.supportingAssetId))
        .innerJoin(views.supportingAssetMachineProperties, eq(views.supportingAssetMachineProperties.supportingAssetSourceId, views.supportingAssetSources.id))
        .where(and(memberWhere, isNotNull(views.supportingAssetMachineProperties.platform)))
        .orderBy(asc(views.supportingAssetMachineProperties.platform)),
      db
        .selectDistinct({ source: views.integrationSettings.source })
        .from(views.assetEvidence)
        .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
        .innerJoin(views.assetEvidenceSources, eq(views.assetEvidenceSources.assetEvidenceId, views.assetEvidence.id))
        .innerJoin(views.integrationSettings, eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId))
        .where(memberWhere)
        .orderBy(asc(views.integrationSettings.source)),
    ]);

    return {
      externalId: technique.externalId,
      name: technique.name,
      description: technique.description,
      expectationType: params.expectationType,
      tactics,
      affectedAssetCount: figures?.affectedAssetCount ?? 0,
      platforms: platforms.flatMap((row) => (row.platform === null ? [] : [row.platform])),
      sources: sources.map((row) => row.source),
      firstSeenAt: figures?.firstSeenAt ?? null,
      lastSeenAt: figures?.lastSeenAt ?? null,
    };
  },

  /** Undefined when the tenant has no such CVE. A CVE with no applicable finding in the estate comes without its stored row. */
  findUniqueCveFinding: async ({ db, views }, params: { cveId: string, mappedToOrganizationId: string | null }) => {
    const stored = views.uniqueFindingScores;
    const [row] = await db
      .select({
        cveRef: views.cve.id,
        cveId: views.cve.cveId,
        cveTitle: views.cve.cveTitle,
        kevUpdatedAt: views.cve.kevUpdatedAt,
        epss: views.cve.epss,
        uniqueScore: stored.score,
        worstScore: stored.worstScore,
        pendingVector: uniqueCvePendingVector(
          { db, views },
          { cveRef: views.cve.id, uniqueScore: stored.score },
          params.mappedToOrganizationId,
        ),
        affectedAssetCount: stored.affectedAssetCount,
        firstSeenAt: stored.firstSeenAt,
      })
      .from(views.cve)
      .leftJoin(stored, and(eq(stored.cveId, views.cve.id), uniqueFindingInScope(views, params.mappedToOrganizationId)))
      .where(eq(views.cve.cveId, params.cveId))
      .limit(1);
    return row;
  },

  findUniqueCveFindingSources: async ({ db, views }, params: { cveId: string, mappedToOrganizationId: string | null }): Promise<Array<string>> => {
    const rows = await db
      .selectDistinct({ source: views.integrationSettings.source })
      .from(views.assetEvidenceSources)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceSources.assetEvidenceId))
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .innerJoin(views.integrationSettings, eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId))
      .where(and(
        uniqueFindingMemberWhere({ db, views }, params.mappedToOrganizationId),
        findingsOfVulnerability({ db, views }, { kind: 'cve', cveId: params.cveId }),
      ))
      .orderBy(asc(views.integrationSettings.source));
    return rows.map((row) => row.source);
  },

  /** The inputs of the CVE's unique score, a level per truncated figure rather than a row per finding. */
  findUniqueCveFindingLevels: async ({ db, views }, params: { cveId: string, mappedToOrganizationId: string | null }) => {
    const level = sql`trunc(${views.findingScores.score})`;
    return db
      .select({
        scores: sql<Array<number>>`coalesce(array_agg(${views.findingScores.score}) filter (where ${views.findingScores.score} is not null), array[]::double precision[])`,
        assetCount: countDistinct(views.assetEvidence.supportingAssetId),
      })
      .from(views.assetEvidence)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .where(and(
        uniqueFindingMemberWhere({ db, views }, params.mappedToOrganizationId),
        findingsOfVulnerability({ db, views }, { kind: 'cve', cveId: params.cveId }),
      ))
      .groupBy(level);
  },

  /**
   * The catalogue CVEs of the list, each with its stored unique finding in the estate and a summary
   * of its applicable findings there, read for the whole list at once. A finding counts before its
   * first score, which is what tells a CVE whose unique score is still to be computed from one the
   * estate does not carry.
   */
  findUniqueCveFindingsOf: async ({ db, views }, params: { cveIds: Array<string>, mappedToOrganizationId: string | null }) => {
    if (params.cveIds.length === 0) {
      return [];
    }
    const listed = sql`any(${sql.param(params.cveIds)}::text[])`;
    const stored = views.uniqueFindingScores;
    const source = views.integrationSettings.source;
    const scored = isNotNull(views.findingScores.assetEvidenceId);
    const [catalogued, members] = await Promise.all([
      db
        .select({
          cveRef: views.cve.id,
          cveId: views.cve.cveId,
          cveTitle: views.cve.cveTitle,
          kevUpdatedAt: views.cve.kevUpdatedAt,
          epss: views.cve.epss,
          storedId: stored.id,
          uniqueScore: stored.score,
          worstScore: stored.worstScore,
          affectedAssetCount: stored.affectedAssetCount,
          firstSeenAt: stored.firstSeenAt,
        })
        .from(views.cve)
        .leftJoin(stored, and(eq(stored.cveId, views.cve.id), uniqueFindingInScope(views, params.mappedToOrganizationId)))
        .where(sql`${views.cve.cveId} = ${listed}`),
      db
        .select({
          cveRef: views.assetEvidence.cveId,
          listedSources: sql<Array<string>>`coalesce(array_agg(distinct ${source}) filter (where ${source} is not null and ${scored}), array[]::text[])`,
          allSources: sql<Array<string>>`coalesce(array_agg(distinct ${source}) filter (where ${source} is not null), array[]::text[])`,
          unscoredMember: sql<boolean>`coalesce(bool_or(${scored} and ${views.findingScores.score} is null), false)`,
        })
        .from(views.assetEvidence)
        .innerJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
        .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
        .leftJoin(views.assetEvidenceSources, eq(views.assetEvidenceSources.assetEvidenceId, views.assetEvidence.id))
        .leftJoin(views.integrationSettings, eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId))
        .where(and(
          sql`${views.cve.cveId} = ${listed}`,
          findingsInState(views, 'applicable'),
          findingsOnEstate({ db, views }, params.mappedToOrganizationId),
        ))
        .groupBy(views.assetEvidence.cveId),
    ]);
    const membersByCve = new Map(members.map((member) => [member.cveRef, member]));
    return catalogued.map((row) => ({ ...row, members: membersByCve.get(row.cveRef) ?? null }));
  },

  findCveRef: async ({ db, views }, cveId: string): Promise<string | undefined> => {
    const [row] = await db.select({ id: views.cve.id }).from(views.cve).where(eq(views.cve.cveId, cveId)).limit(1);
    return row?.id;
  },

  /** The CVE's members by the two asset properties its techniques depend on, so the resolution runs per pair, not per finding. */
  findUniqueCveFindingMemberKinds: async ({ db, views }, params: { cveId: string, mappedToOrganizationId: string | null }) => db
    .select({
      exposure: views.supportingAssets.exposure,
      categoryId: views.supportingAssets.categoryId,
      assetCount: countDistinct(views.assetEvidence.supportingAssetId),
    })
    .from(views.assetEvidence)
    .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
    .where(and(
      uniqueFindingMemberWhere({ db, views }, params.mappedToOrganizationId),
      findingsOfVulnerability({ db, views }, { kind: 'cve', cveId: params.cveId }),
    ))
    .groupBy(views.supportingAssets.exposure, views.supportingAssets.categoryId),

  /** Newest first, one line more than the page so its oldest event knows the line it moved from. */
  findUniqueFindingHistoryPage: async (
    { db, views },
    params: { cveId: string, mappedToOrganizationId: string | null, limit: number, offset: number },
  ) => {
    const history = views.uniqueFindingScoreHistory;
    return db
      .select({
        id: history.id,
        changedAt: history.changedAt,
        score: history.score,
        band: history.band,
        worstScore: history.worstScore,
        affectedAssetCount: history.affectedAssetCount,
      })
      .from(history)
      .where(uniqueFindingHistoryWhere({ db, views }, params))
      .orderBy(desc(history.changedAt), desc(history.id))
      .limit(params.limit + 1)
      .offset(params.offset);
  },

  /** The lines since `since`, led by the one in force at `since`, oldest first. */
  findUniqueFindingScoreHistory: async (
    { db, views },
    params: { cveId: string, mappedToOrganizationId: string | null, since: Date },
  ) => {
    const history = views.uniqueFindingScoreHistory;
    const lines = () => db
      .select({
        id: history.id,
        changedAt: history.changedAt,
        score: history.score,
        band: history.band,
        worstScore: history.worstScore,
        affectedAssetCount: history.affectedAssetCount,
      })
      .from(history);
    const [inForceAtSince, sinceThen] = await Promise.all([
      lines()
        .where(and(uniqueFindingHistoryWhere({ db, views }, params), lt(history.changedAt, params.since)))
        .orderBy(desc(history.changedAt), desc(history.id))
        .limit(1),
      lines()
        .where(and(uniqueFindingHistoryWhere({ db, views }, params), gte(history.changedAt, params.since)))
        .orderBy(asc(history.changedAt), asc(history.id)),
    ]);
    return [...inForceAtSince, ...sinceThen];
  },

  countUniqueFindingHistory: async ({ db, views }, params: { cveId: string, mappedToOrganizationId: string | null, since: Date }) => {
    const [row] = await db
      .select({ value: count() })
      .from(views.uniqueFindingScoreHistory)
      .where(and(uniqueFindingHistoryWhere({ db, views }, params), gte(views.uniqueFindingScoreHistory.changedAt, params.since)));
    return row?.value ?? 0;
  },

  /**
   * The estate's unique findings by band, as stored now and as journaled when the window opened.
   * A CVE group is present at an instant when the line in force then carries an asset count, so a
   * group lost and regained inside the window was present at its start and is not new.
   */
  findUniqueFindingsPanelCounts: async (
    { db, views },
    params: { mappedToOrganizationId: string | null, windowStart: Date, previousWindowStart: Date },
  ) => {
    const history = views.uniqueFindingScoreHistory;
    const inEstate = params.mappedToOrganizationId === null
      ? isNull(history.organizationId)
      : eq(history.organizationId, params.mappedToOrganizationId);
    // Each alias is unique: Drizzle renders a subquery's `sql` field bare in the outer query.
    // bounded-by: `trimUniqueFindingScoreHistory` keeps the window and the line in force at its start, and the page reads every CVE group
    const lineInForceAt = (at: Date, name: string) => db
      .selectDistinctOn([history.cveId], {
        cveId: history.cveId,
        band: history.band,
        present: sql<boolean>`${history.affectedAssetCount} is not null`.as(`${name}_present`),
      })
      .from(history)
      .where(and(inEstate, lt(history.changedAt, at)))
      .orderBy(history.cveId, desc(history.changedAt), desc(history.id))
      .as(name);

    const stored = views.uniqueFindingScores;
    const atWindowStart = lineInForceAt(params.windowStart, 'line_at_window_start');
    const atPreviousWindowStart = lineInForceAt(params.previousWindowStart, 'line_at_previous_window_start');
    const [current, atStart, [journal]] = await Promise.all([
      db
        .select({
          band: stored.band,
          total: count(),
          techniqueGroups: sql<number>`count(*) filter (where ${stored.cveId} is null)`.mapWith(Number),
          newInWindow: sql<number>`count(*) filter (where ${stored.cveId} is not null and ${atWindowStart.present} is not true)`.mapWith(Number),
        })
        .from(stored)
        .leftJoin(atWindowStart, eq(atWindowStart.cveId, stored.cveId))
        .where(uniqueFindingInScope(views, params.mappedToOrganizationId))
        .groupBy(stored.band),
      db
        .select({
          band: atWindowStart.band,
          total: count(),
          newInWindow: sql<number>`count(*) filter (where ${atPreviousWindowStart.present} is not true)`.mapWith(Number),
        })
        .from(atWindowStart)
        .leftJoin(atPreviousWindowStart, eq(atPreviousWindowStart.cveId, atWindowStart.cveId))
        .where(eq(atWindowStart.present, true))
        .groupBy(atWindowStart.band),
      db
        .select({ startsAt: sql<Date | null>`min(${history.changedAt})`.mapWith((value: string) => new Date(value)) })
        .from(history)
        .where(inEstate),
    ]);
    return { current, atWindowStart: atStart, journalStartsAt: journal?.startsAt ?? null };
  },

  findFindingsPanelCounts: async ({ db, views }, windowStart: Date, mappedToOrganizationId: string | null = null) => {
    const estate = estateOfMappedScope(mappedToOrganizationId);
    const onEstate = findingsOnEstate({ db, views }, mappedToOrganizationId);
    const [estateAssets] = await db
      .select({ value: count() })
      .from(views.supportingAssets)
      .where(estateFilter({ db, views }, estate, views.supportingAssets.id));
    const [totals] = await db
      .select({
        findings: count(),
        impactedAssets: countDistinct(views.assetEvidence.supportingAssetId),
        newInWindow: sql<number>`count(*) filter (where ${gte(views.assetEvidence.createdAt, windowStart)})`,
      })
      .from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .where(and(eq(views.assetEvidence.currentState, 'applicable'), onEstate));

    const bands = await db
      .select({
        band: views.findingScores.band,
        total: count(),
        newInWindow: sql<number>`count(*) filter (where ${gte(views.assetEvidence.createdAt, windowStart)})`,
      })
      .from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .where(and(eq(views.assetEvidence.currentState, 'applicable'), onEstate))
      .groupBy(views.findingScores.band);

    return {
      findings: Number(totals?.findings ?? 0),
      impactedAssets: Number(totals?.impactedAssets ?? 0),
      newInWindow: Number(totals?.newInWindow ?? 0),
      estateAssetCount: Number(estateAssets?.value ?? 0),
      bands: bands.flatMap((row) => (row.band === null ? [] : [{
        band: row.band,
        total: Number(row.total),
        newInWindow: Number(row.newInWindow),
      }])),
      pendingVector: Number(bands.find((row) => row.band === null)?.total ?? 0),
    };
  },

  /**
   * Present counts only: the known exploited flag and an asset's exposure keep no history. Open is
   * the applicable score line `findFindingsPanelCounts` counts, so the critical band agrees with the
   * findings list.
   */
  findOpenFindingFigures: async (
    { db, views },
    params: { mappedToOrganizationId: string | null, firstSeenBefore: Date },
  ) => {
    const isOpen = eq(views.assetEvidence.currentState, 'applicable');
    const onEstate = findingsOnEstate({ db, views }, params.mappedToOrganizationId);
    const [totals] = await db
      .select({
        open: count(),
        critical: sql<number>`count(*) filter (where ${eq(views.findingScores.band, 'critical')})`,
        internetExposed: sql<number>`count(*) filter (where ${eq(views.supportingAssets.exposure, 'internet_facing')})`,
        knownExploited: sql<number>`count(*) filter (where ${cisaListedSql(views.cve)})`,
        aged: sql<number>`count(*) filter (where ${lt(views.assetEvidence.createdAt, params.firstSeenBefore)})`,
      })
      .from(views.findingScores)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.findingScores.assetEvidenceId))
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.assetEvidence.supportingAssetId))
      .leftJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .where(and(isOpen, onEstate));

    return {
      open: Number(totals?.open ?? 0),
      critical: Number(totals?.critical ?? 0),
      internetExposed: Number(totals?.internetExposed ?? 0),
      knownExploited: Number(totals?.knownExploited ?? 0),
      aged: Number(totals?.aged ?? 0),
    };
  },

  /** Counted as `findTechniqueTestRecords` counts them: a dismissed verdict is the expectation holding. */
  findTechniqueTestTallies: async (
    { db, views },
    params: { mappedToOrganizationId: string | null, upTo?: Date },
  ) => {
    const onEstate = and(
      isNotNull(views.assetEvidence.mitreTechniqueId),
      findingsOnEstate({ db, views }, params.mappedToOrganizationId),
    );
    if (params.upTo === undefined) {
      const stored = storedFindingVerdict({ views });
      return db
        .select({
          expectationType: views.assetEvidence.expectationType,
          held: count(sql`case when ${stored.state} = 'dismissed' then 1 end`),
          total: count(),
        })
        .from(views.assetEvidence)
        .where(and(stored.spoken, onEstate))
        .groupBy(views.assetEvidence.expectationType);
    }
    const latestVerdict = estateRunVerdictsUpTo({ db, views }, params.mappedToOrganizationId, params.upTo);
    return db
      .select({
        expectationType: views.assetEvidence.expectationType,
        held: count(sql`case when ${latestVerdict.state} = 'dismissed' then 1 end`),
        total: count(),
      })
      .from(views.assetEvidence)
      .innerJoin(latestVerdict, eq(latestVerdict.assetEvidenceId, views.assetEvidence.id))
      .where(onEstate)
      .groupBy(views.assetEvidence.expectationType);
  },

  /** Read apart from the tallies: one asset tested in prevention and in detection is one asset. */
  countTechniqueTestedAssets: async ({ db, views }, mappedToOrganizationId: string | null) => {
    const [row] = await db
      .select({ value: countDistinct(views.assetEvidence.supportingAssetId) })
      .from(views.assetEvidence)
      .where(and(
        storedFindingVerdict({ views }).spoken,
        isNotNull(views.assetEvidence.mitreTechniqueId),
        findingsOnEstate({ db, views }, mappedToOrganizationId),
      ));
    return Number(row?.value ?? 0);
  },
});
