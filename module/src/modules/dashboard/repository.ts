import type { SQLWrapper } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { RepositoryContext } from '../../registry';
import type { AssetDistributionCell, AssetsOverview, DashboardTopCve, DashboardTopFinding } from './aggregation';
import type { CrqRunFamily } from '../crq-indicators/run-profile';
import type { FindingCreationBucket, FindingTransitionBucket, PaceBandKey, TimeOpenRow } from './remediation-pace';
import { and, asc, desc, eq, exists, gte, inArray, isNotNull, min, not, sql } from 'drizzle-orm';
import { LATERAL_ON } from '../../db/lateral';
import { defineRepository } from '../../registry';
import { cisaListedSql } from '../cve/cisa-listing';
import { cvssSeverityBucketSql } from '../cve/severity';
import { familyRunsQuery } from '../crq-indicators/family-runs';
import { latestRunOf } from '../crq-indicators/latest-run';
import { orderByFolded } from '../../db/fold-text';

type ReadContext = Pick<RepositoryContext, 'db' | 'views'>;

/**
 * Membership of an organization's reach, as a predicate on any column holding a supporting asset id.
 * A subquery on the projection, never a list of ids: one organization reaches hundreds of thousands
 * of assets.
 */
const inOrganizationReach = ({ db, views }: ReadContext, column: PgColumn, organizationId: string) =>
  inArray(
    column,
    db.select({ id: views.primaryAssetReach.supportingAssetId })
      .from(views.primaryAssetReach)
      .where(eq(views.primaryAssetReach.organizationId, organizationId)),
  );

/**
 * One row per (asset, CVE): when several sources attached the same pair, the most recent wins, and
 * it carries its stored state.
 *
 * Callers filter the state on this subquery, never inside it. A `dismissed` predicate pushed under
 * the dedupe would let an older applicable row of the same pair take the place of the dismissal
 * that superseded it.
 */
const dedupedFindings = ({ db, views }: ReadContext, organizationId?: string) => {
  const inScope = and(
    isNotNull(views.assetEvidence.cveId),
    organizationId ? inOrganizationReach({ db, views }, views.assetEvidence.supportingAssetId, organizationId) : undefined,
  );

  // A connector persists the CVE id verbatim, and one-argument `btrim` strips spaces alone, so the
  // character set is spelled out to keep a tab- or newline-padded id grouping with its clean form.
  const cveKey = sql<string>`upper(btrim(${views.cve.cveId}, E' \\t\\n\\r\\f\\v'))`;
  const recency = sql`greatest(${views.assetEvidence.currentStateChangedAt}, ${views.assetEvidence.createdAt})`;

  // bounded-by: a dedupe its callers read whole as their FROM, never joined on its key
  return db
    .selectDistinctOn([views.assetEvidence.supportingAssetId, cveKey], {
      evidenceId: views.assetEvidence.id,
      supportingAssetId: views.assetEvidence.supportingAssetId,
      assetName: views.supportingAssets.name,
      assetDerivedName: views.supportingAssets.derivedName,
      cveId: views.cve.cveId,
      cveKey: cveKey.as('cve_key'),
      cvss: ratedOrNull(views.cve.cvss).as('cvss'),
      epss: ratedOrNull(views.cve.epss).as('epss'),
      kev: cisaListedSql(views.cve).as('kev'),
      currentState: views.assetEvidence.currentState,
    })
    .from(views.assetEvidence)
    .innerJoin(views.cve, eq(views.assetEvidence.cveId, views.cve.id))
    .innerJoin(views.supportingAssets, eq(views.assetEvidence.supportingAssetId, views.supportingAssets.id))
    .where(inScope)
    .orderBy(views.assetEvidence.supportingAssetId, cveKey, desc(recency), desc(views.assetEvidence.id))
    .as('deduped_findings');
};

const notDismissed = (currentState: SQLWrapper) => sql`${currentState} <> 'dismissed'`;

/**
 * A stored `NaN` or infinity is no rating, which is how the severity bucket already reads it, and
 * Postgres would put it in a JSON document as a string the output schema rejects. Both follow from
 * normalizing it here, before anything buckets, orders or serializes the score.
 */
const ratedOrNull = (score: SQLWrapper) => sql<number | null>`nullif(nullif(nullif(${score}, 'NaN'::float8), 'Infinity'::float8), '-Infinity'::float8)`;

const severityWeight = (severity: SQLWrapper) => sql`case ${severity}
  when 'critical' then 10
  when 'high' then 5
  when 'medium' then 2
  when 'low' then 1
  when 'unscored' then 1
  else 0
end`;

const criticalityWeight = (criticality: SQLWrapper) => sql`case ${criticality}
  when 'very_high' then 4
  when 'high' then 3
  when 'medium' then 2
  else 1
end`;

/**
 * A closed scope mapping and declaring nothing has no estate to price, so the figures on file answer about an
 * estate the scope no longer has and the dashboard must not sum them. Correlated on the query's own
 * `risk_scenarios` row, which every caller joins.
 */
const scopeMapsNoAsset = ({ db, views }: ReadContext) => sql<boolean>`coalesce(${exists(
  db.select({ closed: sql`1` })
    .from(views.organizations)
    .where(and(
      eq(views.organizations.id, views.riskScenarios.organizationId),
      eq(views.organizations.estateMode, 'closed'),
      not(exists(
        db.select({ mapped: sql`1` })
          .from(views.organizationAssets)
          .where(eq(views.organizationAssets.organizationId, views.riskScenarios.organizationId)),
      )),
      not(exists(
        db.select({ declared: sql`1` })
          .from(views.declaredEstate)
          .where(eq(views.declaredEstate.organizationId, views.riskScenarios.organizationId)),
      )),
    )),
)}, false)`;

const paceBand = (views: ReadContext['views']) => sql<PaceBandKey>`coalesce(${views.findingScores.band}, 'unscored')`;

const dayFrom = (at: SQLWrapper, since: Date) =>
  sql<string | null>`case when ${at} < ${since} then null else to_char(${at} at time zone 'UTC', 'YYYY-MM-DD') end`;

/**
 * Every history row of a CVE finding, tagged `closed` when it enters `dismissed` and `reopened` when
 * it leaves it. A repeated state is no transition, so a connector re-asserting a dismissal does not
 * close the finding twice.
 */
const findingTransitions = ({ db, views }: ReadContext, organizationId?: string) => {
  const ordered = db
    .select({
      historyId: views.assetEvidenceHistory.id,
      assetEvidenceId: views.assetEvidenceHistory.assetEvidenceId,
      state: views.assetEvidenceHistory.state,
      stateChangedAt: views.assetEvidenceHistory.stateChangedAt,
      findingCreatedAt: sql<Date>`${views.assetEvidence.createdAt}`.as('finding_created_at'),
      findingBand: paceBand(views).as('finding_band'),
      previousState: sql<string | null>`lag(${views.assetEvidenceHistory.state}) over (
        partition by ${views.assetEvidenceHistory.assetEvidenceId}
        order by ${views.assetEvidenceHistory.stateChangedAt}, ${views.assetEvidenceHistory.id}
      )`.as('previous_state'),
    })
    .from(views.assetEvidenceHistory)
    .innerJoin(views.assetEvidence, eq(views.assetEvidenceHistory.assetEvidenceId, views.assetEvidence.id))
    .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
    .where(and(
      isNotNull(views.assetEvidence.cveId),
      organizationId ? inOrganizationReach({ db, views }, views.assetEvidence.supportingAssetId, organizationId) : undefined,
    ))
    .as('ordered_history');

  return db
    .select({
      historyId: ordered.historyId,
      assetEvidenceId: ordered.assetEvidenceId,
      stateChangedAt: ordered.stateChangedAt,
      findingCreatedAt: ordered.findingCreatedAt,
      findingBand: ordered.findingBand,
      transitionKind: sql<FindingTransitionBucket['kind'] | null>`case
        when ${ordered.state} = 'dismissed' and ${ordered.previousState} is distinct from 'dismissed' then 'closed'
        when ${ordered.state} <> 'dismissed' and ${ordered.previousState} = 'dismissed' then 'reopened'
      end`.as('transition_kind'),
    })
    .from(ordered)
    .as('finding_transitions');
};

const inScopeScenarios = (context: ReadContext, organizationId?: string, riskScenarioId?: string) => and(
  not(scopeMapsNoAsset(context)),
  organizationId ? eq(context.views.riskScenarios.organizationId, organizationId) : undefined,
  riskScenarioId ? eq(context.views.riskScenarios.id, riskScenarioId) : undefined,
);

/**
 * The run columns a sample is built from: a window's runs select it from the runs table, the seed
 * before the window from a lateral selecting it, so both sides of a series come from one list.
 */
const scenarioRunSource = (runs: ReadContext['views']['crqIndicatorRuns']) => ({
  runId: runs.id,
  riskScenarioId: runs.riskScenarioId,
  createdAt: runs.createdAt,
  aleMean: runs.aleMean,
  lefMean: runs.lefMean,
  lefP10: runs.lefP10,
  lefP90: runs.lefP90,
});

type ScenarioRunSource = Record<keyof ReturnType<typeof scenarioRunSource>, PgColumn>;

/**
 * Typed as `Pick` so each column keeps the table it is read from, which the result type of a
 * select depends on: read off the generic, `runs.aleMean` is typed as the constraint's `PgColumn`
 * and a lateral's column selects as `never`.
 */
const pickRunColumns = <TRuns extends ScenarioRunSource, TKey extends keyof ScenarioRunSource>(runs: TRuns, keys: ReadonlyArray<TKey>) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- each key holds the column of the same key in `runs`
  Object.fromEntries(keys.map((key) => [key, runs[key]])) as Pick<TRuns, TKey>;

const trendSampleColumns = <TRuns extends ScenarioRunSource>({ views }: ReadContext, runs: TRuns) => ({
  ...pickRunColumns(runs, ['runId', 'riskScenarioId', 'createdAt', 'aleMean', 'lefMean']),
  organizationId: views.riskScenarios.organizationId,
});

const bandSampleColumns = <TRuns extends ScenarioRunSource>(runs: TRuns) =>
  pickRunColumns(runs, ['riskScenarioId', 'createdAt', 'aleMean', 'lefMean']);

const scenarioRunReadingColumns = <TRuns extends ScenarioRunSource>({ views }: ReadContext, runs: TRuns) => ({
  ...pickRunColumns(runs, ['runId', 'riskScenarioId', 'createdAt', 'aleMean', 'lefMean', 'lefP10', 'lefP90']),
  lossEventYearShare: views.crqIndicatorRunAnnualLosses.lossEventYearShare,
});

const emptyFindingsOverview = () => ({
  activeCount: 0,
  kevCount: 0,
  impactedAssetCount: 0,
  criticalCount: 0,
  highCount: 0,
  mediumCount: 0,
  lowCount: 0,
  noneCount: 0,
  unscoredCount: 0,
  topFindings: [] as Array<DashboardTopFinding>,
  topCves: [] as Array<DashboardTopCve>,
});

const emptyAssetsOverview = () => ({
  topAssets: [] as AssetsOverview['topAssets'],
  distributionCells: [] as Array<AssetDistributionCell>,
});

export const dashboardRepository = defineRepository({
  findScenariosWithRelations: async ({ db, views }, organizationId?: string, riskScenarioId?: string) =>
    db
      .select({
        id: views.riskScenarios.id,
        name: views.riskScenarios.name,
        organizationId: views.riskScenarios.organizationId,
        organizationName: views.organizations.name,
        attackOutcomeId: views.attackOutcomes.id,
        attackOutcomeName: views.attackOutcomes.name,
        noMappedAsset: scopeMapsNoAsset({ db, views }),
      })
      .from(views.riskScenarios)
      .leftJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
      .innerJoin(views.attackOutcomes, eq(views.riskScenarios.attackOutcomeId, views.attackOutcomes.id))
      .where(and(
        organizationId ? eq(views.riskScenarios.organizationId, organizationId) : undefined,
        riskScenarioId ? eq(views.riskScenarios.id, riskScenarioId) : undefined,
      )),

  findRiskScopes: async ({ db, views }) =>
    db.select({ id: views.organizations.id, name: views.organizations.name }).from(views.organizations),

  findLatestRunsPerScenario: async ({ db, views }, organizationId?: string) => {
    const run = latestRunOf({ db, views }, {
      runId: views.crqIndicatorRuns.id,
      createdAt: views.crqIndicatorRuns.createdAt,
      aleP10: views.crqIndicatorRuns.aleP10,
      aleP90: views.crqIndicatorRuns.aleP90,
      aleMean: views.crqIndicatorRuns.aleMean,
      lefMean: views.crqIndicatorRuns.lefMean,
    });
    return db
      .select({
        runId: run.runId,
        riskScenarioId: views.riskScenarios.id,
        createdAt: run.createdAt,
        aleP10: run.aleP10,
        aleP90: run.aleP90,
        aleMean: run.aleMean,
        lefMean: run.lefMean,
      })
      .from(views.riskScenarios)
      .innerJoinLateral(run, LATERAL_ON)
      .where(organizationId ? eq(views.riskScenarios.organizationId, organizationId) : undefined);
  },

  findInScopeLatestRuns: async ({ db, views }, organizationId?: string, riskScenarioId?: string) => {
    const run = latestRunOf({ db, views }, { runId: views.crqIndicatorRuns.id, aleMean: views.crqIndicatorRuns.aleMean });
    return db
      .select({ runId: run.runId, riskScenarioId: views.riskScenarios.id, aleMean: run.aleMean })
      .from(views.riskScenarios)
      .innerJoinLateral(run, LATERAL_ON)
      .where(inScopeScenarios({ db, views }, organizationId, riskScenarioId));
  },

  findInScopeFamilyRuns: async ({ db, views }, family: CrqRunFamily, organizationId?: string, riskScenarioId?: string) =>
    familyRunsQuery({ db, views }, family, inScopeScenarios({ db, views }, organizationId, riskScenarioId)),

  findFamilyRuns: async ({ db, views }, family: CrqRunFamily, organizationId?: string) =>
    familyRunsQuery({ db, views }, family, organizationId ? eq(views.riskScenarios.organizationId, organizationId) : undefined),

  findLatestRunPerScenarioBefore: async ({ db, views }, before: Date, organizationId?: string) => {
    const run = latestRunOf({ db, views }, scenarioRunSource(views.crqIndicatorRuns), { before });
    return db
      .select(trendSampleColumns({ db, views }, run))
      .from(views.riskScenarios)
      .innerJoinLateral(run, LATERAL_ON)
      .where(inScopeScenarios({ db, views }, organizationId))
      // The trend sums each day's scenarios in the order their seed comes, and a float sum depends
      // on its order.
      .orderBy(asc(views.riskScenarios.id));
  },

  findRunsSince: async ({ db, views }, since: Date, organizationId?: string) =>
    db
      .select(trendSampleColumns({ db, views }, scenarioRunSource(views.crqIndicatorRuns)))
      .from(views.crqIndicatorRuns)
      .innerJoin(views.riskScenarios, eq(views.crqIndicatorRuns.riskScenarioId, views.riskScenarios.id))
      .where(and(
        gte(views.crqIndicatorRuns.createdAt, since),
        inScopeScenarios({ db, views }, organizationId),
      ))
      .orderBy(asc(views.crqIndicatorRuns.createdAt)),

  /** The first run on file of any scenario in scope, which opens the timeline's axis. */
  findEarliestRunAt: async ({ db, views }, organizationId?: string) => {
    const first = db
      .select({ createdAt: views.crqIndicatorRuns.createdAt })
      .from(views.crqIndicatorRuns)
      .where(eq(views.crqIndicatorRuns.riskScenarioId, views.riskScenarios.id))
      .orderBy(asc(views.crqIndicatorRuns.createdAt))
      .limit(1)
      .as('first_run');
    const [row] = await db
      .select({ at: min(first.createdAt) })
      .from(views.riskScenarios)
      .innerJoinLateral(first, LATERAL_ON)
      .where(inScopeScenarios({ db, views }, organizationId));
    return row?.at ?? null;
  },

  /**
   * Each scenario's last non-null means between two sampled days, from `since` onwards (`null` the
   * whole history), so what leaves the database is bounded by scenarios x `axisDays`, not by runs.
   * A run lands on the first sampled day on or after its own, which is the first day a
   * carry-forward reads it on. `axisDays` must be ascending, which is what `width_bucket` needs of
   * its thresholds.
   */
  findRunBandBuckets: async ({ db, views }, axisDays: ReadonlyArray<string>, since: Date | null, organizationId?: string) => {
    const axis = sql`${sql.param(axisDays)}::date[]`;
    const runDay = sql`(${views.crqIndicatorRuns.createdAt} at time zone 'UTC')::date`;
    const bucketed = db
      .select({
        riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
        // `width_bucket` counts the thresholds <= its operand, so a run ON a sampled day would land
        // on the next one: the `- 1` keeps it on its own.
        axisIndex: sql<number>`width_bucket(${runDay} - 1, ${axis})`.as('axis_index'),
        runId: views.crqIndicatorRuns.id,
        createdAt: views.crqIndicatorRuns.createdAt,
        aleMean: views.crqIndicatorRuns.aleMean,
        lefMean: views.crqIndicatorRuns.lefMean,
      })
      .from(views.crqIndicatorRuns)
      .innerJoin(views.riskScenarios, eq(views.crqIndicatorRuns.riskScenarioId, views.riskScenarios.id))
      .where(and(
        since === null ? undefined : gte(views.crqIndicatorRuns.createdAt, since),
        inScopeScenarios({ db, views }, organizationId),
      ))
      .as('bucketed_runs');
    const lastNonNull = (mean: SQLWrapper) => sql<number | null>`(array_agg(${mean} order by ${bucketed.createdAt} desc, ${bucketed.runId} desc) filter (where ${mean} is not null))[1]`;
    return db
      .select({
        riskScenarioId: bucketed.riskScenarioId,
        axisIndex: bucketed.axisIndex,
        aleMean: lastNonNull(bucketed.aleMean),
        lefMean: lastNonNull(bucketed.lefMean),
      })
      .from(bucketed)
      .groupBy(bucketed.riskScenarioId, bucketed.axisIndex);
  },

  /**
   * The carry-forward seed for a windowed timeline: the last run of each scenario BEFORE the window
   * opens. Without it every scenario reads as null until its first run
   * inside the window, which draws a curve that climbs out of nothing on the left edge.
   */
  findRunSampleBefore: async ({ db, views }, before: Date, organizationId?: string) => {
    const run = latestRunOf({ db, views }, scenarioRunSource(views.crqIndicatorRuns), { before });
    return db
      .select(bandSampleColumns(run))
      .from(views.riskScenarios)
      .innerJoinLateral(run, LATERAL_ON)
      .where(inScopeScenarios({ db, views }, organizationId))
      // The band lists the scenarios holding a seed in the order these rows come.
      .orderBy(asc(views.riskScenarios.id));
  },

  findScenarioDailyRunsSince: async ({ db, views }, since: Date, organizationId?: string, riskScenarioId?: string) => {
    const day = sql<string>`to_char(${views.crqIndicatorRuns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    // bounded-by: the runs since the trend window opened, which the daily series reads in full
    return db
      .selectDistinctOn([views.crqIndicatorRuns.riskScenarioId, day], scenarioRunReadingColumns({ db, views }, scenarioRunSource(views.crqIndicatorRuns)))
      .from(views.crqIndicatorRuns)
      .innerJoin(views.riskScenarios, eq(views.crqIndicatorRuns.riskScenarioId, views.riskScenarios.id))
      .leftJoin(views.crqIndicatorRunAnnualLosses, eq(views.crqIndicatorRunAnnualLosses.runId, views.crqIndicatorRuns.id))
      .where(and(
        gte(views.crqIndicatorRuns.createdAt, since),
        inScopeScenarios({ db, views }, organizationId, riskScenarioId),
      ))
      .orderBy(asc(views.crqIndicatorRuns.riskScenarioId), day, desc(views.crqIndicatorRuns.createdAt), desc(views.crqIndicatorRuns.id));
  },

  /** A scenario's last run of each day, with the columns the scope's ALE curve sums. */
  findScenarioDailyAleSince: async ({ db, views }, since: Date, organizationId?: string) => {
    const day = sql<string>`to_char(${views.crqIndicatorRuns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    // bounded-by: one run per scenario and day since the window opened, which the scope's curve sums
    return db
      .selectDistinctOn([views.crqIndicatorRuns.riskScenarioId, day], pickRunColumns(scenarioRunSource(views.crqIndicatorRuns), ['riskScenarioId', 'createdAt', 'aleMean']))
      .from(views.crqIndicatorRuns)
      .innerJoin(views.riskScenarios, eq(views.crqIndicatorRuns.riskScenarioId, views.riskScenarios.id))
      .where(and(
        gte(views.crqIndicatorRuns.createdAt, since),
        inScopeScenarios({ db, views }, organizationId),
      ))
      .orderBy(asc(views.crqIndicatorRuns.riskScenarioId), day, desc(views.crqIndicatorRuns.createdAt), desc(views.crqIndicatorRuns.id));
  },

  findScenarioRunBefore: async ({ db, views }, before: Date, organizationId?: string, riskScenarioId?: string) => {
    const run = latestRunOf({ db, views }, scenarioRunSource(views.crqIndicatorRuns), { before });
    return db
      .select(scenarioRunReadingColumns({ db, views }, run))
      .from(views.riskScenarios)
      .innerJoinLateral(run, LATERAL_ON)
      .leftJoin(views.crqIndicatorRunAnnualLosses, eq(views.crqIndicatorRunAnnualLosses.runId, run.runId))
      .where(inScopeScenarios({ db, views }, organizationId, riskScenarioId));
  },

  findGroupScoresByRunIds:async ({ db, views }, runIds: Array<string>) => {
    if (runIds.length === 0) {
      return [];
    }
    return db
      .select({
        runId: views.crqIndicatorGroupScores.runId,
        groupKey: views.crqIndicatorGroupScores.groupKey,
        groupName: views.crqIndicatorGroupScores.groupName,
        groupEntityType: views.crqIndicatorGroupScores.groupEntityType,
        actorClass: views.crqIndicatorGroupScores.actorClass,
        share: views.crqIndicatorGroupScores.share,
        vulnerabilityMean: views.crqIndicatorGroupScores.vulnerabilityMean,
      })
      .from(views.crqIndicatorGroupScores)
      .where(inArray(views.crqIndicatorGroupScores.runId, runIds));
  },

  /**
   * What interdicting each technique is worth, per lever, with its ATT&CK label joined in. The label
   * travels with the value on purpose: the alternative is shipping the whole `mitre_techniques`
   * catalogue to every caller so it can resolve a handful of ids.
   */
  findTechniqueValuesByRunIds: async ({ db, views }, runIds: Array<string>) => {
    if (runIds.length === 0) {
      return [];
    }
    return db
      .select({
        runId: views.crqTechniqueWhatIfResults.runId,
        riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
        mitreTechniqueId: views.crqTechniqueWhatIfResults.mitreTechniqueId,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        preventValue: views.crqTechniqueWhatIfResults.preventValueMean,
        detectValue: views.crqTechniqueWhatIfResults.detectValueMean,
      })
      .from(views.crqTechniqueWhatIfResults)
      .innerJoin(views.crqIndicatorRuns, eq(views.crqTechniqueWhatIfResults.runId, views.crqIndicatorRuns.id))
      .innerJoin(views.mitreTechniques, eq(views.crqTechniqueWhatIfResults.mitreTechniqueId, views.mitreTechniques.id))
      .where(inArray(views.crqTechniqueWhatIfResults.runId, runIds));
  },

  findScenarioTargets: async ({ db, views }, organizationId?: string) =>
    db
      .select({
        scenarioId: views.riskScenarios.id,
        organizationId: views.riskScenarios.organizationId,
        attackOutcomeId: views.riskScenarios.attackOutcomeId,
        countryId: views.organizations.countryId,
        sectorId: views.organizations.sectorId,
      })
      .from(views.riskScenarios)
      .innerJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
      .where(organizationId ? eq(views.riskScenarios.organizationId, organizationId) : undefined),

  findTacticsOfTechniques: async ({ db, views }, techniqueIds: Array<string>) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    return db
      .select({
        techniqueId: views.mitreTechniqueTactics.techniqueId,
        tacticId: views.mitreTechniqueTactics.tacticId,
      })
      .from(views.mitreTechniqueTactics)
      .where(inArray(views.mitreTechniqueTactics.techniqueId, techniqueIds));
  },

  findMitreTactics: async ({ db, views }) =>
    db
      .select({
        id: views.mitreTactics.id,
        externalId: views.mitreTactics.externalId,
        name: views.mitreTactics.name,
      })
      .from(views.mitreTactics)
      .orderBy(asc(views.mitreTactics.order)),

  findLossEstimatesByScenarioIds: async ({ db, views }, scenarioIds: Array<string>) => {
    if (scenarioIds.length === 0) {
      return [];
    }
    return db
      .select({
        riskScenarioId: views.scenarioLossEstimates.riskScenarioId,
        lossDriverId: views.scenarioLossEstimates.lossDriverId,
        lossDriverName: views.lossDrivers.name,
        lossCategoryId: views.lossCategories.id,
        lossCategoryName: views.lossCategories.name,
        minValue: views.scenarioLossEstimates.minValue,
        likelyValue: views.scenarioLossEstimates.likelyValue,
        maxValue: views.scenarioLossEstimates.maxValue,
      })
      .from(views.scenarioLossEstimates)
      .innerJoin(views.lossDrivers, eq(views.scenarioLossEstimates.lossDriverId, views.lossDrivers.id))
      .innerJoin(views.lossCategories, eq(views.lossDrivers.lossCategoryId, views.lossCategories.id))
      .where(inArray(views.scenarioLossEstimates.riskScenarioId, scenarioIds));
  },

  findPrimaryAssetsByScenarioIds: async ({ db, views }, scenarioIds: Array<string>) => {
    if (scenarioIds.length === 0) {
      return [];
    }
    return db
      .select({
        riskScenarioId: views.riskScenarioPrimaryAssets.riskScenarioId,
        primaryAssetId: views.primaryAssets.id,
        primaryAssetName: views.primaryAssets.name,
      })
      .from(views.riskScenarioPrimaryAssets)
      .innerJoin(views.primaryAssets, eq(views.riskScenarioPrimaryAssets.primaryAssetId, views.primaryAssets.id))
      .where(inArray(views.riskScenarioPrimaryAssets.riskScenarioId, scenarioIds))
      .orderBy(...orderByFolded(views.primaryAssets.nameFolded, views.primaryAssets.name, false), asc(views.primaryAssets.id));
  },

  /** The applicable technique findings of each technique, most first, a technique with none left out. */
  findTechniqueFindingCounts: async ({ db, views }, organizationId?: string) => {
    const counted = and(
      isNotNull(views.assetEvidence.mitreTechniqueId),
      organizationId ? inOrganizationReach({ db, views }, views.assetEvidence.supportingAssetId, organizationId) : undefined,
    );

    const applicableFindings = sql<number>`count(*)::int`;
    return db
      .select({
        mitreTechniqueId: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        applicableFindings: applicableFindings.as('applicable_findings'),
      })
      .from(views.assetEvidence)
      .innerJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
      .where(and(counted, eq(views.assetEvidence.currentState, 'applicable')))
      .groupBy(views.mitreTechniques.id, views.mitreTechniques.externalId, views.mitreTechniques.name)
      .orderBy(desc(applicableFindings), asc(views.mitreTechniques.externalId));
  },

  /**
   * The whole findings overview in one statement, so every figure on it describes the same
   * snapshot: a second read taken while a connector commits would rank a CVE the counters no
   * longer agree with.
   *
   * The per-CVE window counts rows rather than distinct assets, which the dedupe makes equivalent:
   * a (asset, CVE) pair reaches this point exactly once.
   */
  findFindingsOverview: async (
    { db, views },
    { organizationId, topFindingsLimit, topCvesLimit }: { organizationId?: string, topFindingsLimit: number, topCvesLimit: number },
  ) => {
    const deduped = dedupedFindings({ db, views }, organizationId);

    // bounded-by: the overview aggregates every row of the scope, so no key could narrow it
    const applicable = db
      .select({
        evidenceId: deduped.evidenceId,
        supportingAssetId: deduped.supportingAssetId,
        assetName: deduped.assetName,
        assetDerivedName: deduped.assetDerivedName,
        cveId: deduped.cveId,
        cveKey: deduped.cveKey,
        cvss: deduped.cvss,
        epss: deduped.epss,
        kev: deduped.kev,
        severity: cvssSeverityBucketSql(deduped.cvss).as('severity'),
        findingRank: sql<number>`row_number() over (order by
          coalesce(${deduped.kev}, false) desc,
          coalesce(${deduped.cvss}, -1) desc,
          coalesce(${deduped.epss}, -1) desc,
          ${deduped.cveId},
          ${deduped.evidenceId}
        )`.as('finding_rank'),
        cveAssetCount: sql<number>`(count(*) over (partition by ${deduped.cveKey}))::int`.as('cve_asset_count'),
        cveCvss: sql<number | null>`max(${deduped.cvss}) over (partition by ${deduped.cveKey})`.as('cve_cvss'),
        cveEpss: sql<number | null>`max(${deduped.epss}) over (partition by ${deduped.cveKey})`.as('cve_epss'),
        cveKev: sql<boolean>`bool_or(${deduped.kev} is true) over (partition by ${deduped.cveKey})`.as('cve_kev'),
        cveRowNumber: sql<number>`row_number() over (partition by ${deduped.cveKey} order by ${deduped.evidenceId})`.as('cve_row_number'),
      })
      .from(deduped)
      .where(notDismissed(deduped.currentState))
      .as('applicable_findings');

    // `cve_key` closes the ordering, so the rows of one CVE are peers and `dense_rank` numbers the
    // CVEs themselves.
    const ranked = db
      .select({
        evidenceId: applicable.evidenceId,
        supportingAssetId: applicable.supportingAssetId,
        assetName: applicable.assetName,
        assetDerivedName: applicable.assetDerivedName,
        cveId: applicable.cveId,
        cveKey: applicable.cveKey,
        cvss: applicable.cvss,
        epss: applicable.epss,
        kev: applicable.kev,
        severity: applicable.severity,
        findingRank: applicable.findingRank,
        cveAssetCount: applicable.cveAssetCount,
        cveCvss: applicable.cveCvss,
        cveEpss: applicable.cveEpss,
        cveKev: applicable.cveKev,
        cveRowNumber: applicable.cveRowNumber,
        cveRank: sql<number>`dense_rank() over (order by
          ${applicable.cveAssetCount} desc,
          ${applicable.cveKev} desc,
          coalesce(${applicable.cveCvss}, -1) desc,
          coalesce(${applicable.cveEpss}, -1) desc,
          ${applicable.cveKey}
        )`.as('cve_rank'),
      })
      .from(applicable)
      .as('ranked_findings');

    const bucketCount = (bucket: string) => sql<number>`(count(*) filter (where ${ranked.severity} = ${bucket}))::int`;

    const [row] = await db
      .select({
        activeCount: sql<number>`count(*)::int`,
        kevCount: sql<number>`(count(*) filter (where ${ranked.kev} is true))::int`,
        impactedAssetCount: sql<number>`count(distinct ${ranked.supportingAssetId})::int`,
        criticalCount: bucketCount('critical'),
        highCount: bucketCount('high'),
        mediumCount: bucketCount('medium'),
        lowCount: bucketCount('low'),
        noneCount: bucketCount('none'),
        unscoredCount: bucketCount('unscored'),
        topFindings: sql<Array<DashboardTopFinding>>`coalesce(json_agg(json_build_object(
          'evidenceId', ${ranked.evidenceId},
          'supportingAssetId', ${ranked.supportingAssetId},
          'assetName', ${ranked.assetName},
          'assetDerivedName', ${ranked.assetDerivedName},
          'cveId', ${ranked.cveId},
          'cvss', ${ranked.cvss},
          'epss', ${ranked.epss},
          'kev', ${ranked.kev}
        ) order by ${ranked.findingRank}) filter (where ${ranked.findingRank} <= ${topFindingsLimit}), '[]'::json)`,
        topCves: sql<Array<DashboardTopCve>>`coalesce(json_agg(json_build_object(
          'cveId', ${ranked.cveKey},
          'cvss', ${ranked.cveCvss},
          'epss', ${ranked.cveEpss},
          'kev', ${ranked.cveKev},
          'impactedAssetCount', ${ranked.cveAssetCount}
        ) order by ${ranked.cveRank}) filter (where ${ranked.cveRowNumber} = 1 and ${ranked.cveRank} <= ${topCvesLimit}), '[]'::json)`,
      })
      .from(ranked);

    return row ?? emptyFindingsOverview();
  },

  /**
   * The whole assets overview in one statement, for the same reason: the ranking and the
   * distribution have to agree on which assets carry a finding.
   *
   * An asset whose findings all weigh zero is not at risk, so the ranking drops it; the
   * distribution still counts it, which is why both are read from the estate rather than from the
   * findings.
   */
  findAssetsOverview: async (
    { db, views },
    { organizationId, topLimit }: { organizationId?: string, topLimit: number },
  ) => {
    const deduped = dedupedFindings({ db, views }, organizationId);
    const severity = cvssSeverityBucketSql(deduped.cvss);

    const perAsset = db
      .select({
        supportingAssetId: deduped.supportingAssetId,
        findingsWeight: sql<number>`sum(${severityWeight(severity)} * case when ${deduped.kev} is true then 2 else 1 end)`.as('findings_weight'),
        applicableCount: sql<number>`count(*)::int`.as('applicable_count'),
        criticalOrHighCount: sql<number>`(count(*) filter (where ${severity} in ('critical', 'high')))::int`.as('critical_or_high_count'),
      })
      .from(deduped)
      .where(notDismissed(deduped.currentState))
      .groupBy(deduped.supportingAssetId)
      .as('per_asset');

    const scored = db
      .select({
        id: views.supportingAssets.id,
        name: views.supportingAssets.name,
        derivedName: views.supportingAssets.derivedName,
        displayName: views.supportingAssets.displayName,
        displayNameFolded: views.supportingAssets.displayNameFolded,
        criticality: views.supportingAssets.criticality,
        categoryId: views.supportingAssets.categoryId,
        exposure: views.supportingAssets.exposure,
        score: sql<number>`(${criticalityWeight(views.supportingAssets.criticality)} * coalesce(${perAsset.findingsWeight}, 0))::double precision`.as('score'),
        applicableCount: sql<number>`coalesce(${perAsset.applicableCount}, 0)`.as('applicable_count'),
        criticalOrHighCount: sql<number>`coalesce(${perAsset.criticalOrHighCount}, 0)`.as('critical_or_high_count'),
        impacted: sql<boolean>`${perAsset.supportingAssetId} is not null`.as('impacted'),
      })
      .from(views.supportingAssets)
      .leftJoin(perAsset, eq(perAsset.supportingAssetId, views.supportingAssets.id))
      .where(organizationId ? inOrganizationReach({ db, views }, views.supportingAssets.id, organizationId) : undefined)
      .as('scored_assets');

    // bounded-by: the overview aggregates every asset of the scope, so no key could narrow it
    const ranked = db
      .select({
        id: scored.id,
        name: scored.name,
        derivedName: scored.derivedName,
        criticality: scored.criticality,
        categoryId: scored.categoryId,
        exposure: scored.exposure,
        score: scored.score,
        applicableCount: scored.applicableCount,
        criticalOrHighCount: scored.criticalOrHighCount,
        assetRank: sql<number>`row_number() over (order by
          ${scored.score} desc,
          ${scored.applicableCount} desc,
          ${sql.join(orderByFolded(scored.displayNameFolded, scored.displayName, false), sql`, `)},
          ${scored.id}
        )`.as('asset_rank'),
        cellAssetCount: sql<number>`(count(*) over (partition by ${scored.categoryId}, ${scored.exposure}))::int`.as('cell_asset_count'),
        cellImpactedCount: sql<number>`(count(*) filter (where ${scored.impacted}) over (partition by ${scored.categoryId}, ${scored.exposure}))::int`.as('cell_impacted_count'),
        cellRowNumber: sql<number>`row_number() over (partition by ${scored.categoryId}, ${scored.exposure} order by ${scored.id})`.as('cell_row_number'),
      })
      .from(scored)
      .as('ranked_assets');

    // The ranking orders by score first, so a zero-scored asset can never sit inside the top slice
    // that a positive-scored one deserves.
    const [row] = await db
      .select({
        topAssets: sql<AssetsOverview['topAssets']>`coalesce(json_agg(json_build_object(
          'id', ${ranked.id},
          'name', ${ranked.name},
          'derivedName', ${ranked.derivedName},
          'criticality', ${ranked.criticality},
          'score', ${ranked.score},
          'applicableCount', ${ranked.applicableCount},
          'criticalOrHighCount', ${ranked.criticalOrHighCount}
        ) order by ${ranked.assetRank}) filter (where ${ranked.assetRank} <= ${topLimit} and ${ranked.score} > 0), '[]'::json)`,
        distributionCells: sql<Array<AssetDistributionCell>>`coalesce(json_agg(json_build_object(
          'categoryId', ${ranked.categoryId},
          'exposure', ${ranked.exposure},
          'assetCount', ${ranked.cellAssetCount},
          'impactedAssetCount', ${ranked.cellImpactedCount}
        )) filter (where ${ranked.cellRowNumber} = 1), '[]'::json)`,
      })
      .from(ranked);

    return row ?? emptyAssetsOverview();
  },

  /**
   * Grouped by ordinal: `since` is a bind parameter, and Postgres never matches two parameters as
   * the same grouping expression.
   */
  findFindingCreationsByDay: async ({ db, views }, since: Date, organizationId?: string): Promise<Array<FindingCreationBucket>> =>
    db
      .select({
        band: paceBand(views),
        day: dayFrom(views.assetEvidence.createdAt, since),
        count: sql<number>`count(*)::int`,
        firstDay: sql<string>`to_char(min(${views.assetEvidence.createdAt}) at time zone 'UTC', 'YYYY-MM-DD')`,
      })
      .from(views.assetEvidence)
      .leftJoin(views.findingScores, eq(views.findingScores.assetEvidenceId, views.assetEvidence.id))
      .where(and(
        isNotNull(views.assetEvidence.cveId),
        organizationId ? inOrganizationReach({ db, views }, views.assetEvidence.supportingAssetId, organizationId) : undefined,
      ))
      .groupBy(sql`1`, sql`2`),

  findFindingTransitionsByDay: async ({ db, views }, since: Date, organizationId?: string): Promise<Array<FindingTransitionBucket>> => {
    const transitions = findingTransitions({ db, views }, organizationId);
    return db
      .select({
        band: transitions.findingBand,
        day: dayFrom(transitions.stateChangedAt, since),
        kind: sql<FindingTransitionBucket['kind']>`${transitions.transitionKind}`,
        count: sql<number>`count(*)::int`,
      })
      .from(transitions)
      .where(isNotNull(transitions.transitionKind))
      .groupBy(sql`1`, sql`2`, sql`3`);
  },

  /** One row per band holding a closure since `since`, and the row over all of them with a null band. */
  findTimeOpenOfClosuresSince: async ({ db, views }, since: Date, organizationId?: string): Promise<Array<TimeOpenRow>> => {
    const transitions = findingTransitions({ db, views }, organizationId);
    const lastReopenedAt = sql`max(case when ${transitions.transitionKind} = 'reopened' then ${transitions.stateChangedAt} end) over (
      partition by ${transitions.assetEvidenceId}
      order by ${transitions.stateChangedAt}, ${transitions.historyId}
      rows between unbounded preceding and current row
    )`;
    const spells = db
      .select({
        spellBand: transitions.findingBand,
        transitionKind: transitions.transitionKind,
        stateChangedAt: transitions.stateChangedAt,
        daysOpen: sql<number>`greatest(0, extract(epoch from ${transitions.stateChangedAt} - coalesce(${lastReopenedAt}, ${transitions.findingCreatedAt})) / 86400)::float8`.as('days_open'),
      })
      .from(transitions)
      .as('finding_spells');
    return db
      .select({
        band: sql<PaceBandKey | null>`${spells.spellBand}`,
        medianDays: sql<number | null>`percentile_cont(0.5) within group (order by ${spells.daysOpen})`,
        meanDays: sql<number | null>`avg(${spells.daysOpen})`,
      })
      .from(spells)
      .where(and(eq(spells.transitionKind, 'closed'), gte(spells.stateChangedAt, since)))
      .groupBy(sql`rollup(${spells.spellBand})`);
  },

  /** One array parameter: the caller passes a run per day of a year for each tolerated scenario. */
  findAnnualLossesByRunIds: async ({ db, views }, runIds: Array<string>) => {
    if (runIds.length === 0) {
      return [];
    }
    return db
      .select({
        runId: views.crqIndicatorRunAnnualLosses.runId,
        mean: views.crqIndicatorRunAnnualLosses.mean,
        lossYearShare: views.crqIndicatorRunAnnualLosses.lossYearShare,
        probabilities: views.crqIndicatorRunAnnualLosses.probabilities,
        losses: views.crqIndicatorRunAnnualLosses.losses,
      })
      .from(views.crqIndicatorRunAnnualLosses)
      .where(sql`${views.crqIndicatorRunAnnualLosses.runId} = any(${sql.param(runIds)}::uuid[])`);
  },

  findScenarioRiskTolerances: async ({ db, views }, organizationId?: string, riskScenarioId?: string) =>
    db
      .select({
        riskScenarioId: views.riskScenarios.id,
        scope: {
          annualLoss: views.organizationRiskTolerances.annualLoss,
          maxExceedanceProbability: views.organizationRiskTolerances.maxExceedanceProbability,
        },
        own: {
          annualLoss: views.riskScenarioRiskTolerances.annualLoss,
          maxExceedanceProbability: views.riskScenarioRiskTolerances.maxExceedanceProbability,
        },
      })
      .from(views.riskScenarios)
      .leftJoin(views.organizationRiskTolerances, eq(views.organizationRiskTolerances.organizationId, views.riskScenarios.organizationId))
      .leftJoin(views.riskScenarioRiskTolerances, eq(views.riskScenarioRiskTolerances.riskScenarioId, views.riskScenarios.id))
      .where(and(
        organizationId ? eq(views.riskScenarios.organizationId, organizationId) : undefined,
        riskScenarioId ? eq(views.riskScenarios.id, riskScenarioId) : undefined,
      )),

  findWhatIfResultsByRunIds: async ({ db, views }, runIds: Array<string>) => {
    if (runIds.length === 0) {
      return [];
    }
    return db
      .select({
        runId: views.crqControlWhatIfResults.runId,
        riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
        controlId: views.crqControlWhatIfResults.controlId,
        controlName: views.controlCapabilities.name,
        controlExternalId: views.controlCapabilities.externalId,
        dimension: views.crqControlWhatIfResults.dimension,
        currentStrength: views.crqControlWhatIfResults.currentStrength,
        upgradedStrength: views.crqControlWhatIfResults.upgradedStrength,
        currentCoverage: views.crqControlWhatIfResults.currentCoverage,
        upgradedCoverage: views.crqControlWhatIfResults.upgradedCoverage,
        aleReduction: views.crqControlWhatIfResults.aleReductionMean,
      })
      .from(views.crqControlWhatIfResults)
      .innerJoin(views.crqIndicatorRuns, eq(views.crqControlWhatIfResults.runId, views.crqIndicatorRuns.id))
      .innerJoin(views.controlCapabilities, eq(views.crqControlWhatIfResults.controlId, views.controlCapabilities.id))
      .where(inArray(views.crqControlWhatIfResults.runId, runIds));
  },
});
