import type { SQL, SQLWrapper } from 'drizzle-orm';
import { and, asc, count, countDistinct, desc, eq, exists, inArray, isNotNull, isNull, lt, not, notExists, or, sql } from 'drizzle-orm';
import type { AssetCategory } from '../supporting-assets/schema';
import type { ResolvedEstate } from '../organizations/estate-filter';
import type { PrimaryUserRow } from './attack-run-door-estate';
import type { CrqRunFamily } from './run-profile';
import type { RepositoryContext } from '../../registry';
import type { RunSampling } from '../risk-scenarios/run-samples';
import { LATERAL_ON } from '../../db/lateral';
import { defineRepository } from '../../registry';
import { entryTechniqueApplies } from '../attack-surfaces/entry-applicability';
import { SILENT_FLAW_THREAT } from '../cve/silent-flaw-threat';
import { estateFilter } from '../organizations/estate-filter';
import { enabledIdentitiesOf } from '../supporting-assets/enabled-identities';
import { playedTechniquesOf } from '../threat-analyses/played-techniques';
import { isScoredEdge, resolveEffectiveEdges } from '../controls/capability/effective-coverage';
import { resolveScopePosture } from '../controls/capability/scope-posture';
import { sampleRunsAsOf } from '../risk-scenarios/run-samples';
import { orderByFolded } from '../../db/fold-text';
import { familyRunsQuery } from './family-runs';
import { latestRunFirst, latestRunOf } from './latest-run';
import { PHISHING_STAGE_TECHNIQUES } from './engine/attack-run-constants';
import {
  crqBudgetReviewAnnualLosses,
  crqBudgetReviewResults,
  crqControlWhatIfResults,
  crqCveWhatIfResults,
  crqIndicatorGroupScores,
  crqIndicatorRunAnnualLosses,
  crqIndicatorRunReachGaps,
  crqIndicatorRuns,
  crqIndicatorRunUnplayableObstacles,
  crqIndicatorTefInputs,
  crqPlanWhatIfResults,
  crqTechniqueWhatIfResults,
  tefEstimates,
} from './schema';

/** Rows of the flaw what-if per insert, held under Postgres' bind-parameter limit at six columns. */
const CVE_WHAT_IF_INSERT_CHUNK_SIZE = 5000;

const PHISHING_DELIVERY = PHISHING_STAGE_TECHNIQUES.delivery[0];

const PHISHING_STAGE_TECHNIQUE_EXTERNAL_IDS = Object.values(PHISHING_STAGE_TECHNIQUES).flat();

/**
 * The assets some primary asset of the scenario depends on, one row each: a left join on it never
 * multiplies an asset linked to two of them.
 */
const targetAssetsOf = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, primaryAssetIds: Array<string>) =>
  db
    .selectDistinct({ supportingAssetId: views.supportToPrimaryLinks.supportingAssetId })
    .from(views.supportToPrimaryLinks)
    .where(primaryAssetIds.length === 0 ? sql`false` : inArray(views.supportToPrimaryLinks.primaryAssetId, primaryAssetIds))
    .as('target_assets');

const latestEstimateFirst = (views: RepositoryContext['views']) => [desc(views.tefEstimates.createdAt), desc(views.tefEstimates.id)];

const timelineColumns = (runs: RepositoryContext['views']['crqIndicatorRuns']) => ({
  aleMean: runs.aleMean,
  aleP10: runs.aleP10,
  aleP90: runs.aleP90,
  tefMin: runs.tefMin,
  tefLikely: runs.tefLikely,
  tefMax: runs.tefMax,
  outcomeEvicted: runs.outcomeEvicted,
  outcomeImpactDetected: runs.outcomeImpactDetected,
  outcomeImpactUndetected: runs.outcomeImpactUndetected,
  magnitudeMean: runs.magnitudeMean,
});

export const crqIndicatorsRepository = defineRepository({
  insertRun: ({ db }, values: typeof crqIndicatorRuns.$inferInsert) =>
    db.insert(crqIndicatorRuns).values(values),

  updateRunInputsFingerprint: ({ db }, runId: string, inputsFingerprint: string) =>
    db.update(crqIndicatorRuns).set({ inputsFingerprint }).where(eq(crqIndicatorRuns.id, runId)),

  /**
   * Deletes up to `limit` runs created before `before` that no reader needs, their rows going by
   * cascade, and answers how many went. Only a later run of its scenario's UTC day, itself before
   * `before`, stands for a run, so a read at `before` or later finds the run it found before the
   * purge. A run stays while it is:
   * - the last of its day, and the last of its day with an ALE and with a LEF, which the daily
   *   series read apart;
   * - one of the two latest of its scenario, the headline and the delta beside it;
   * - the newest of its scenario to carry one of its profile tokens, since a figure family is read
   *   from the newest run that computed it, and, for `techniques`, the one a kept run reads its
   *   technique values from, the newest at or before it;
   * - holding a budget review figure at the review's current version, which the review reads
   *   whatever its age, closed or not.
   */
  deleteExpiredRuns: async ({ db, views }, before: Date, limit: number): Promise<number> => {
    const runs = views.crqIndicatorRuns;
    // The secured view is already a subquery named after the table, so each further read of it goes
    // through a subquery of its own rather than alias(), which only takes a table.
    const runColumns = { riskScenarioId: runs.riskScenarioId, createdAt: runs.createdAt, id: runs.id, profile: runs.profile, aleMean: runs.aleMean, lefMean: runs.lefMean };
    type RunRef = Record<keyof typeof runColumns, SQLWrapper>;
    const runsAs = (name: string) => db.select(runColumns).from(runs).as(name);
    const one = { one: sql`1` };
    const after = (run: RunRef, other: RunRef) => and(
      eq(other.riskScenarioId, run.riskScenarioId),
      sql`(${other.createdAt}, ${other.id}) > (${run.createdAt}, ${run.id})`,
    );
    const sameDayBeforeBound = (run: RunRef, other: RunRef) => and(
      after(run, other),
      lt(other.createdAt, before),
      sql`${other.createdAt} < (date_trunc('day', ${run.createdAt} at time zone 'UTC') + interval '1 day') at time zone 'UTC'`,
    );
    const reviewFigureOf = (runId: SQLWrapper) => or(...[views.crqBudgetReviewResults, views.crqBudgetReviewAnnualLosses].map((table) => exists(db
      .select(one)
      .from(table)
      .innerJoin(views.budgetReviews, and(eq(views.budgetReviews.id, table.reviewId), eq(views.budgetReviews.version, table.reviewVersion)))
      .where(sql`${table.runId} = ${runId}`))));
    /** Every keep rule but the `techniques` source, which reads the runs this one finds kept. */
    const keptOtherwise = (run: RunRef, name: string) => {
      const later = runsAs(`${name}_later`);
      const laterSameDay = (also?: SQL) => exists(db.select(one).from(later).where(and(sameDayBeforeBound(run, later), also)));
      return or(
        sql`${run.createdAt} >= ${before}`,
        not(laterSameDay()),
        and(isNotNull(run.aleMean), not(laterSameDay(isNotNull(later.aleMean)))),
        and(isNotNull(run.lefMean), not(laterSameDay(isNotNull(later.lefMean)))),
        notExists(db.select(one).from(later).where(after(run, later)).offset(1)),
        sql`exists (select 1 from unnest(${run.profile}) as token where not exists (${db
          .select(one)
          .from(later)
          .where(and(after(run, later), sql`token = any(${later.profile})`))}))`,
        reviewFigureOf(run.id),
      )!;
    };
    // A later `techniques` run of the same day stands for this one when no run kept between them
    // would lose it as the newest `techniques` run at or before it.
    const successor = runsAs('successor_run');
    const between = runsAs('between_run');
    const techniquesSuperseded = exists(db.select(one).from(successor).where(and(
      sameDayBeforeBound(runs, successor),
      sql`'techniques' = any(${successor.profile})`,
      notExists(db.select(one).from(between).where(and(
        after(runs, between),
        sql`(${between.createdAt}, ${between.id}) < (${successor.createdAt}, ${successor.id})`,
        keptOtherwise(between, 'between_run'),
      ))),
    )));
    const expired = db
      .select({ id: runs.id })
      .from(runs)
      .where(and(
        not(keptOtherwise(runs, 'run')),
        or(sql`not ('techniques' = any(${runs.profile}))`, techniquesSuperseded),
      ))
      .limit(limit);
    const deleted = await db.delete(crqIndicatorRuns).where(inArray(crqIndicatorRuns.id, expired)).returning();
    return deleted.length;
  },

  findLatestRunByScenarioId: async ({ db, views }, riskScenarioId: string) => {
    const runs = await db
      .select()
      .from(views.crqIndicatorRuns)
      .where(eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId))
      .orderBy(desc(views.crqIndicatorRuns.createdAt), desc(views.crqIndicatorRuns.id))
      .limit(1);
    return runs[0];
  },

  findRunById: async ({ db, views }, runId: string) => {
    const runs = await db
      .select()
      .from(views.crqIndicatorRuns)
      .where(eq(views.crqIndicatorRuns.id, runId))
      .limit(1);
    return runs[0];
  },

  /** `limit` runs from `offset`, newest first unless `oldestFirst`, with the columns of the run history only. */
  findRunHistoryPage: async ({ db, views }, riskScenarioId: string, { limit, offset, oldestFirst }: { limit: number, offset: number, oldestFirst: boolean }) => {
    const direction = oldestFirst ? asc : desc;
    return db
      .select({
        id: views.crqIndicatorRuns.id,
        createdAt: views.crqIndicatorRuns.createdAt,
        ...timelineColumns(views.crqIndicatorRuns),
        vulnerabilityP5: views.crqIndicatorRuns.vulnerabilityP5,
        vulnerabilityP50: views.crqIndicatorRuns.vulnerabilityP50,
        vulnerabilityP95: views.crqIndicatorRuns.vulnerabilityP95,
        lefMean: views.crqIndicatorRuns.lefMean,
        techniqueCount: views.crqIndicatorRuns.techniqueCount,
        coveredTechniqueCount: views.crqIndicatorRuns.coveredTechniqueCount,
      })
      .from(views.crqIndicatorRuns)
      .where(eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId))
      .orderBy(direction(views.crqIndicatorRuns.createdAt), direction(views.crqIndicatorRuns.id))
      .limit(limit)
      .offset(offset);
  },

  countRunsByScenarioId: async ({ db, views }, riskScenarioId: string) => {
    const [row] = await db
      .select({ total: count() })
      .from(views.crqIndicatorRuns)
      .where(eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId));
    return row?.total ?? 0;
  },

  findLatestTimelineRuns: async ({ db, views }, riskScenarioId: string, limit: number) =>
    db
      .select({ runId: views.crqIndicatorRuns.id, at: views.crqIndicatorRuns.createdAt, ...timelineColumns(views.crqIndicatorRuns) })
      .from(views.crqIndicatorRuns)
      .where(eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId))
      .orderBy(desc(views.crqIndicatorRuns.createdAt), desc(views.crqIndicatorRuns.id))
      .limit(limit),

  findTimelineRunsAsOf: async (context, riskScenarioId: string, sampling: RunSampling) => {
    const sampled = sampleRunsAsOf(context, riskScenarioId, sampling, timelineColumns, 'sampled_runs');
    return context.db.select().from(sampled).orderBy(asc(sampled.at), asc(sampled.runId));
  },

  insertGroupScores: ({ db }, values: Array<typeof crqIndicatorGroupScores.$inferInsert>) => {
    if (values.length === 0) {
      return Promise.resolve();
    }
    return db.insert(crqIndicatorGroupScores).values(values);
  },

  findGroupScoresByRunId: async ({ db, views }, runId: string) =>
    db
      .select()
      .from(views.crqIndicatorGroupScores)
      .where(eq(views.crqIndicatorGroupScores.runId, runId))
      .orderBy(desc(views.crqIndicatorGroupScores.share)),

  insertReachGaps: ({ db }, values: Array<typeof crqIndicatorRunReachGaps.$inferInsert>) => {
    if (values.length === 0) {
      return Promise.resolve();
    }
    return db.insert(crqIndicatorRunReachGaps).values(values);
  },

  findReachGapsByRunId: async ({ db, views }, runId: string) =>
    db
      .select({
        id: views.crqIndicatorRunReachGaps.id,
        gap: views.crqIndicatorRunReachGaps.gap,
        family: views.crqIndicatorRunReachGaps.family,
        mitreTechniqueId: views.crqIndicatorRunReachGaps.mitreTechniqueId,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
      })
      .from(views.crqIndicatorRunReachGaps)
      .innerJoin(views.mitreTechniques, eq(views.crqIndicatorRunReachGaps.mitreTechniqueId, views.mitreTechniques.id))
      .where(eq(views.crqIndicatorRunReachGaps.runId, runId))
      .orderBy(asc(views.mitreTechniques.externalId), asc(views.crqIndicatorRunReachGaps.family)),

  insertUnplayableObstacles: ({ db }, values: Array<typeof crqIndicatorRunUnplayableObstacles.$inferInsert>) => {
    if (values.length === 0) {
      return Promise.resolve();
    }
    return db.insert(crqIndicatorRunUnplayableObstacles).values(values);
  },

  findUnplayableObstaclesByRunId: async ({ db, views }, runId: string) =>
    db
      .select({
        id: views.crqIndicatorRunUnplayableObstacles.id,
        groupKey: views.crqIndicatorRunUnplayableObstacles.groupKey,
        obstacleKey: views.crqIndicatorRunUnplayableObstacles.obstacleKey,
      })
      .from(views.crqIndicatorRunUnplayableObstacles)
      .where(eq(views.crqIndicatorRunUnplayableObstacles.runId, runId))
      .orderBy(asc(views.crqIndicatorRunUnplayableObstacles.groupKey), asc(views.crqIndicatorRunUnplayableObstacles.obstacleKey)),

  findTefInput: async ({ db, views }, riskScenarioId: string) =>
    db
      .select()
      .from(views.crqIndicatorTefInputs)
      .where(eq(views.crqIndicatorTefInputs.riskScenarioId, riskScenarioId))
      .then((r) => r[0]),

  /**
   * `setWhere` on a real value change, so rewriting the same triplet reports no drift from the run
   * that already sampled it. `values.updatedAt` says when the triplet came into force for a caller
   * that knows better than the clock — the snapshot of an estimate the scenario has been running on.
   */
  upsertTefInput: ({ db }, values: typeof crqIndicatorTefInputs.$inferInsert) =>
    db.insert(crqIndicatorTefInputs).values(values).onConflictDoUpdate({
      target: crqIndicatorTefInputs.riskScenarioId,
      set: {
        min: values.min,
        likely: values.likely,
        max: values.max,
        updatedAt: values.updatedAt ?? sql`now()`,
      },
      setWhere: sql`${crqIndicatorTefInputs.min} IS DISTINCT FROM ${values.min}
        OR ${crqIndicatorTefInputs.likely} IS DISTINCT FROM ${values.likely}
        OR ${crqIndicatorTefInputs.max} IS DISTINCT FROM ${values.max}`,
    }),

  insertTefEstimate: async ({ db }, values: typeof tefEstimates.$inferInsert) =>
    (await db.insert(tefEstimates).values(values).returning())[0],

  /**
   * A risk scope's scenarios with the likely TEF each one runs on: the typed one in manual mode,
   * the latest estimate's in auto mode, `null` when it has none yet.
   */
  findScopeScenarioTefs: async ({ db, views }, organizationId: string) => {
    const estimates = views.tefEstimates;
    const latestEstimate = db
      .select({
        id: estimates.id,
        catalogId: estimates.catalogId,
        catalogVersion: estimates.catalogVersion,
        min: estimates.min,
        likely: estimates.likely,
        max: estimates.max,
        countryIsoAlpha3: estimates.countryIsoAlpha3,
        sectorName: estimates.sectorName,
        sizeSource: estimates.sizeSource,
        readCountry: estimates.readCountry,
        readSector: estimates.readSector,
        readSizeClasses: estimates.readSizeClasses,
        readSizeWeights: estimates.readSizeWeights,
        notMeasured: estimates.notMeasured,
        sourceIds: estimates.sourceIds,
      })
      .from(views.tefEstimates)
      .where(and(eq(views.tefEstimates.riskScenarioId, views.riskScenarios.id), eq(views.riskScenarios.tefMode, 'auto')))
      .orderBy(...latestEstimateFirst(views))
      .limit(1)
      .as('latest_estimate');
    const scenarios = await db
      .select({
        id: views.riskScenarios.id,
        name: views.riskScenarios.name,
        attackOutcomeId: views.riskScenarios.attackOutcomeId,
        tefMode: views.riskScenarios.tefMode,
        manualLikely: views.crqIndicatorTefInputs.likely,
        estimate: {
          id: latestEstimate.id,
          catalogId: latestEstimate.catalogId,
          catalogVersion: latestEstimate.catalogVersion,
          min: latestEstimate.min,
          likely: latestEstimate.likely,
          max: latestEstimate.max,
          countryIsoAlpha3: latestEstimate.countryIsoAlpha3,
          sectorName: latestEstimate.sectorName,
          sizeSource: latestEstimate.sizeSource,
          readCountry: latestEstimate.readCountry,
          readSector: latestEstimate.readSector,
          readSizeClasses: latestEstimate.readSizeClasses,
          readSizeWeights: latestEstimate.readSizeWeights,
          notMeasured: latestEstimate.notMeasured,
          sourceIds: latestEstimate.sourceIds,
        },
      })
      .from(views.riskScenarios)
      .leftJoin(views.crqIndicatorTefInputs, eq(views.crqIndicatorTefInputs.riskScenarioId, views.riskScenarios.id))
      .leftJoinLateral(latestEstimate, LATERAL_ON)
      .where(eq(views.riskScenarios.organizationId, organizationId))
      .orderBy(...orderByFolded(views.riskScenarios.nameFolded, views.riskScenarios.name, false));
    return scenarios.map(({ manualLikely, estimate, ...scenario }) => ({
      ...scenario,
      likely: scenario.tefMode === 'auto' ? estimate?.likely ?? null : manualLikely,
      estimate,
    }));
  },

  findLatestTefEstimate: async ({ db, views }, riskScenarioId: string) => {
    const rows = await db
      .select()
      .from(views.tefEstimates)
      .where(eq(views.tefEstimates.riskScenarioId, riskScenarioId))
      .orderBy(...latestEstimateFirst(views))
      .limit(1);
    return rows[0];
  },

  /**
   * The estate at the grain the attack run law reads: the tuple it keys a group on, and a count. The
   * engine never reads an individual asset, so a million-asset estate has to arrive here as a few
   * hundred rows or the collapse the whole design rests on happens in the wrong process.
   */
  findEstateCountsByCategoryExposureAndCriticality: async (
    { db, views },
    categoryIds: Array<AssetCategory>,
    tenantId: string,
    estate: ResolvedEstate,
  ) => {
    if (categoryIds.length === 0) {
      return [];
    }
    return db
      .select({
        categoryId: views.supportingAssets.categoryId,
        exposure: views.supportingAssets.exposure,
        criticality: views.supportingAssets.criticality,
        count: count(),
      })
      .from(views.supportingAssets)
      .where(and(
        eq(views.supportingAssets.tenantId, tenantId),
        inArray(views.supportingAssets.categoryId, categoryIds),
        estateFilter({ db, views }, estate, views.supportingAssets.id),
      ))
      .groupBy(views.supportingAssets.categoryId, views.supportingAssets.exposure, views.supportingAssets.criticality);
  },

  /**
   * The estate at the grain the door's applicability rule reads, over every family: the door plays
   * techniques the actors' families tables carry, so the touched categories do not bound it.
   *
   * A row is a target when its assets are depended on by one of `primaryAssetIds`, so a tuple splits
   * into a target row and an other row; `count` stays a count of assets.
   */
  findDoorEstateCounts: async ({ db, views }, tenantId: string, estate: ResolvedEstate, primaryAssetIds: Array<string>) => {
    const { observedEnabled, identityEnabled } = enabledIdentitiesOf({ db, views });
    const targets = targetAssetsOf({ db, views }, primaryAssetIds);
    const target = sql<boolean>`${targets.supportingAssetId} is not null`;
    return db
      .select({
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        exposure: views.supportingAssets.exposure,
        identityEnabled,
        target,
        count: count(),
      })
      .from(views.supportingAssets)
      .leftJoin(observedEnabled, eq(observedEnabled.supportingAssetId, views.supportingAssets.id))
      .leftJoin(targets, eq(targets.supportingAssetId, views.supportingAssets.id))
      .where(and(
        eq(views.supportingAssets.tenantId, tenantId),
        estateFilter({ db, views }, estate, views.supportingAssets.id),
      ))
      .groupBy(views.supportingAssets.categoryId, views.supportingAssets.subcategoryId, views.supportingAssets.exposure, identityEnabled, target);
  },

  /**
   * The people phishing reaches and the devices each is the primary user of: one row per
   * (account, device) pair, however many connectors reported it, with the device's family. Only
   * enabled user accounts of the estate count as people and only devices phishing reaches count as
   * theirs, by the door's own applicability rule and enabled test, and both ends of the pair must be
   * in the estate. `identityTarget` says whether the account is depended on by
   * one of `primaryAssetIds`.
   */
  findPrimaryUsers: async ({ db, views }, tenantId: string, estate: ResolvedEstate, primaryAssetIds: Array<string>): Promise<Array<PrimaryUserRow>> => {
    const { observedEnabled, identityEnabled } = enabledIdentitiesOf({ db, views });
    const targets = targetAssetsOf({ db, views }, primaryAssetIds);
    // The secured view is already a subquery named after the table, so the second read of it goes
    // through a subquery of its own rather than alias(), which only takes a table.
    const devices = db
      .select({
        id: views.supportingAssets.id,
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        exposure: views.supportingAssets.exposure,
      })
      .from(views.supportingAssets)
      .as('primary_device');
    const rows = await db
      .selectDistinct({
        identityId: views.supportingAssetRelations.fromAssetId,
        deviceId: views.supportingAssetRelations.toAssetId,
        identityTarget: sql<boolean>`${targets.supportingAssetId} is not null`,
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        exposure: views.supportingAssets.exposure,
        identityEnabled,
        deviceCategoryId: devices.categoryId,
        deviceSubcategoryId: devices.subcategoryId,
        deviceExposure: devices.exposure,
      })
      .from(views.supportingAssetRelations)
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.supportingAssetRelations.fromAssetId))
      .innerJoin(devices, eq(devices.id, views.supportingAssetRelations.toAssetId))
      .leftJoin(observedEnabled, eq(observedEnabled.supportingAssetId, views.supportingAssetRelations.fromAssetId))
      .leftJoin(targets, eq(targets.supportingAssetId, views.supportingAssetRelations.fromAssetId))
      .where(and(
        eq(views.supportingAssetRelations.tenantId, tenantId),
        eq(views.supportingAssetRelations.kind, 'primary_user_of'),
        eq(views.supportingAssets.categoryId, 'identity'),
        estateFilter({ db, views }, estate, views.supportingAssetRelations.fromAssetId),
        estateFilter({ db, views }, estate, views.supportingAssetRelations.toAssetId),
      ));
    // T1566 reads no exposure, so the tenant setting the rule takes is not one of its inputs. A
    // device the rule does not reach, a server say, is no device of a person's.
    return rows
      .filter((row) => entryTechniqueApplies(PHISHING_DELIVERY, row, 'internal')
        && entryTechniqueApplies(PHISHING_DELIVERY, {
          categoryId: row.deviceCategoryId,
          subcategoryId: row.deviceSubcategoryId,
          exposure: row.deviceExposure,
          identityEnabled: true,
        }, 'internal'))
      .map(({ identityId, deviceId, identityTarget, deviceCategoryId }) => ({ identityId, deviceId, deviceCategoryId, identityTarget }));
  },

  /**
   * What each finding of the estate opens on the initial access techniques, as the recompute stored
   * it before any control. A finding that opens nothing has no row, and none is read for it.
   *
   * The table keeps a dismissed finding's rows, so the finding's stored state is read here: a
   * dismissed finding is left out. The recompute may trail
   * what the run reads, so the asset's subcategory and exposure travel with the row, and so does
   * whether the asset is depended on by one of `primaryAssetIds`.
   */
  findEntryOpenings: async ({ db, views }, tenantId: string, estate: ResolvedEstate, primaryAssetIds: Array<string>) => {
    const targets = targetAssetsOf({ db, views }, primaryAssetIds);
    return db
      .select({
        supportingAssetId: views.entryOpenings.supportingAssetId,
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        exposure: views.supportingAssets.exposure,
        target: sql<boolean>`${targets.supportingAssetId} is not null`,
        cveId: views.entryOpenings.cveId,
        techniqueExternalId: views.mitreTechniques.externalId,
        opening: views.entryOpenings.opening,
        threat: views.entryOpenings.threat,
      })
      .from(views.entryOpenings)
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.entryOpenings.supportingAssetId))
      .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.entryOpenings.mitreTechniqueId))
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.entryOpenings.assetEvidenceId))
      .leftJoin(targets, eq(targets.supportingAssetId, views.entryOpenings.supportingAssetId))
      .where(and(
        eq(views.entryOpenings.tenantId, tenantId),
        estateFilter({ db, views }, estate, views.entryOpenings.supportingAssetId),
        eq(views.assetEvidence.currentState, 'applicable'),
      ));
  },

  /**
   * The openings of a threat above `SILENT_FLAW_THREAT` on an applicable finding of the estate, the
   * join of `findEntryOpenings`, narrowed to `onlyCveIds` when given. The table is written under the
   * widest reading of an unknown exposure, so the asset's family and exposure travel with each row for
   * the caller to apply the rule the run applies.
   */
  findThreateningOpenings: async ({ db, views }, tenantId: string, estate: ResolvedEstate, onlyCveIds?: Array<string>) =>
    db
      .selectDistinct({
        cveId: views.entryOpenings.cveId,
        categoryId: views.supportingAssets.categoryId,
        subcategoryId: views.supportingAssets.subcategoryId,
        exposure: views.supportingAssets.exposure,
        techniqueExternalId: views.mitreTechniques.externalId,
      })
      .from(views.entryOpenings)
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.entryOpenings.supportingAssetId))
      .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.entryOpenings.mitreTechniqueId))
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.entryOpenings.assetEvidenceId))
      .where(and(
        eq(views.entryOpenings.tenantId, tenantId),
        estateFilter({ db, views }, estate, views.entryOpenings.supportingAssetId),
        eq(views.assetEvidence.currentState, 'applicable'),
        sql`${views.entryOpenings.threat} > ${SILENT_FLAW_THREAT}`,
        onlyCveIds === undefined ? undefined : inArray(views.entryOpenings.cveId, onlyCveIds),
      )),

  /** The row ids of the CVEs, among those named, that an applicable finding of the estate carries: the reading of `findActorCveClaimsOnAssets`, without its per-asset detail. */
  findCveIdsOnApplicableFindings: async ({ db, views }, tenantId: string, estate: ResolvedEstate, cveExternalIds: Array<string>) => {
    if (cveExternalIds.length === 0) {
      return [];
    }
    return (await db
      .selectDistinct({ cveId: views.cve.id })
      .from(views.assetEvidence)
      .innerJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .where(and(
        eq(views.assetEvidence.tenantId, tenantId),
        eq(views.assetEvidence.currentState, 'applicable'),
        inArray(views.cve.cveId, cveExternalIds),
        estateFilter({ db, views }, estate, views.assetEvidence.supportingAssetId),
      ))).map((row) => row.cveId);
  },

  /**
   * The same grain, restricted to the assets the scenario's primary resources declare a dependency
   * on. Counted distinct: an asset supporting two of the scenario's resources is one asset.
   */
  findScenarioGroupCountsByCategoryExposureAndCriticality: async (
    { db, views },
    categoryIds: Array<AssetCategory>,
    tenantId: string,
    primaryAssetIds: Array<string>,
    estate: ResolvedEstate,
  ) => {
    if (categoryIds.length === 0 || primaryAssetIds.length === 0) {
      return [];
    }
    return db
      .select({
        categoryId: views.supportingAssets.categoryId,
        exposure: views.supportingAssets.exposure,
        criticality: views.supportingAssets.criticality,
        count: countDistinct(views.supportingAssets.id),
      })
      .from(views.supportingAssets)
      .innerJoin(views.supportToPrimaryLinks, eq(views.supportToPrimaryLinks.supportingAssetId, views.supportingAssets.id))
      .where(and(
        eq(views.supportingAssets.tenantId, tenantId),
        inArray(views.supportingAssets.categoryId, categoryIds),
        inArray(views.supportToPrimaryLinks.primaryAssetId, primaryAssetIds),
        estateFilter({ db, views }, estate, views.supportingAssets.id),
      ))
      .groupBy(views.supportingAssets.categoryId, views.supportingAssets.exposure, views.supportingAssets.criticality);
  },

  /**
   * One row per (asset, actor CVE it carries in an applicable finding, stored exploitation
   * technique), the technique null when none is stored, with what the topology rule needs to
   * answer per asset. A dismissed finding is left out, whatever its dismissal type.
   */
  findActorCveClaimsOnAssets: async (
    { db, views },
    categoryIds: Array<AssetCategory>,
    tenantId: string,
    cveExternalIds: Array<string>,
    primaryAssetIds: Array<string>,
    estate: ResolvedEstate,
  ) => {
    if (categoryIds.length === 0 || cveExternalIds.length === 0) {
      return [];
    }
    return db
      .selectDistinct({
        supportingAssetId: views.supportingAssets.id,
        categoryId: views.supportingAssets.categoryId,
        exposure: views.supportingAssets.exposure,
        criticality: views.supportingAssets.criticality,
        matchedByScenarioGroup: sql<boolean>`${views.supportToPrimaryLinks.id} is not null`,
        cveExternalId: views.cve.cveId,
        cveRowId: views.cve.id,
        cvssVector: views.cve.cvssVector,
        cvssV2UserInteractionRequired: views.cve.cvssV2UserInteractionRequired,
        cwe: views.cve.cwe,
        techniqueExternalId: views.mitreTechniques.externalId,
        role: views.cveTechniqueMapping.role,
        lane: views.cveTechniqueMapping.lane,
      })
      .from(views.supportingAssets)
      .leftJoin(views.supportToPrimaryLinks, and(
        eq(views.supportToPrimaryLinks.supportingAssetId, views.supportingAssets.id),
        primaryAssetIds.length === 0 ? sql`false` : inArray(views.supportToPrimaryLinks.primaryAssetId, primaryAssetIds),
      ))
      .innerJoin(views.assetEvidence, and(
        eq(views.assetEvidence.supportingAssetId, views.supportingAssets.id),
        isNotNull(views.assetEvidence.cveId),
        eq(views.assetEvidence.currentState, 'applicable'),
      ))
      .innerJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .leftJoin(views.cveTechniqueMapping, and(
        eq(views.cveTechniqueMapping.cveId, views.cve.id),
        eq(views.cveTechniqueMapping.role, 'exploitation_technique'),
      ))
      .leftJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.cveTechniqueMapping.mitreTechniqueId))
      .where(and(
        eq(views.supportingAssets.tenantId, tenantId),
        inArray(views.supportingAssets.categoryId, categoryIds),
        inArray(views.cve.cveId, cveExternalIds),
        estateFilter({ db, views }, estate, views.supportingAssets.id),
      ));
  },

  /**
   * The assets carrying no vulnerability data at all. An empty mask is indistinguishable from a
   * fully patched one on the largest single route term, so the share has to be displayed rather
   * than inferred from a count of zeros.
   */
  findUnscannedAssetCount: async ({ db, views }, categoryIds: Array<AssetCategory>, tenantId: string, estate: ResolvedEstate) => {
    if (categoryIds.length === 0) {
      return 0;
    }
    const rows = await db
      .select({ count: countDistinct(views.supportingAssets.id) })
      .from(views.supportingAssets)
      .leftJoin(views.assetEvidence, and(
        eq(views.assetEvidence.supportingAssetId, views.supportingAssets.id),
        isNotNull(views.assetEvidence.cveId),
      ))
      .where(and(
        eq(views.supportingAssets.tenantId, tenantId),
        inArray(views.supportingAssets.categoryId, categoryIds),
        isNull(views.assetEvidence.id),
        estateFilter({ db, views }, estate, views.supportingAssets.id),
      ));
    return rows[0]?.count ?? 0;
  },

  /**
   * The class and the known-exploited CVEs of the mixture's actors, keyed by the analysis id the
   * mixture already carries as its group key.
   */
  findActorClassesByAnalysisIds: async ({ db, views }, analysisIds: Array<string>) => {
    if (analysisIds.length === 0) {
      return [];
    }
    return db
      .select({
        analysisId: views.threatAnalyses.id,
        actorClass: views.threatAnalyses.actorClass,
        actorClassOverride: views.threatAnalyses.actorClassOverride,
      })
      .from(views.threatAnalyses)
      .where(inArray(views.threatAnalyses.id, analysisIds));
  },

  /**
   * Each actor's whole observed repertoire, not the outcome's curated subset.
   *
   * The two are different sets and the attack run law needs the first: the outcome fixes the terminal
   * tactic, and the walk then decides which of the actor's techniques can be played at which
   * obstacle. Handing it the curated subset leaves every obstacle before the objective unplayable,
   * which reads as a broken chain rather than as the wrong input.
   */
  findActorTechniqueExternalIds: async (context, analysisIds: Array<string>) => playedTechniquesOf(context, analysisIds),

  /** The platform ids of a set of ATT&CK external ids, which the surface tables are keyed on. */
  findTechniqueIdsByExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return [];
    }
    return db
      .select({ id: views.mitreTechniques.id, externalId: views.mitreTechniques.externalId })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.externalId, externalIds));
  },

  findActorCveExternalIds: async ({ db, views }, analysisIds: Array<string>) => {
    if (analysisIds.length === 0) {
      return [];
    }
    return db
      .selectDistinct({
        analysisId: views.threatAnalysisCves.analysisId,
        cveExternalId: views.threatAnalysisCves.cveId,
      })
      .from(views.threatAnalysisCves)
      .where(inArray(views.threatAnalysisCves.analysisId, analysisIds));
  },

  /**
   * Every control declaration the attack run law reads, with its effective edges on **both**
   * functions expressed in technique external ids.
   *
   * It is a separate read from the finding score's resistance inputs on purpose: that one folds to
   * one scored function and returns technique uuids, while the law needs the prevent and the detect
   * product side by side and keys everything on external ids. The tenant's overlay is resolved
   * through the same single resolution point, so the catalogue and the tenant's edits are never
   * combined twice.
   *
   * The prevent edges on the techniques that stage a phishing campaign, and on their sub-techniques,
   * are read whether or not the repertoire plays them: a control placed at a stage by an edge the run
   * does not play still acts there, and the stage folds a sub-technique to its parent. Such an edge reaches no per-technique product of the law, which indexes edges by the
   * repertoire's techniques only.
   */
  findAttackRunControlInputs: async ({ db, views }, techniqueIds: Array<string>, tenantId: string, organizationId: string) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    const [nodeRows, stageRows] = await Promise.all([
      db
        .select({
          id: views.mitreTechniques.id,
          externalId: views.mitreTechniques.externalId,
          parentTechniqueId: views.mitreTechniques.parentTechniqueId,
        })
        .from(views.mitreTechniques)
        .where(inArray(views.mitreTechniques.id, techniqueIds)),
      db
        .select({ id: views.mitreTechniques.id, externalId: views.mitreTechniques.externalId })
        .from(views.mitreTechniques)
        .where(or(
          inArray(views.mitreTechniques.externalId, PHISHING_STAGE_TECHNIQUE_EXTERNAL_IDS),
          inArray(
            views.mitreTechniques.parentTechniqueId,
            db.select({ id: views.mitreTechniques.id }).from(views.mitreTechniques).where(inArray(views.mitreTechniques.externalId, PHISHING_STAGE_TECHNIQUE_EXTERNAL_IDS)),
          ),
        )),
    ]);
    const repertoireIds = new Set([
      ...techniqueIds,
      ...nodeRows.flatMap((row) => (row.parentTechniqueId === null ? [] : [row.parentTechniqueId])),
    ]);
    const candidateIds = [...new Set([...repertoireIds, ...stageRows.map((row) => row.id)])];

    const [catalogueRows, overrideRows, capabilityRows] = await Promise.all([
      db
        .select({
          capabilityId: views.controlCapabilityEdges.capabilityId,
          techniqueId: views.controlCapabilityEdges.mitreTechniqueId,
          function: views.controlCapabilityEdges.function,
        })
        .from(views.controlCapabilityEdges)
        .where(inArray(views.controlCapabilityEdges.mitreTechniqueId, candidateIds)),
      db
        .select({
          capabilityId: views.controlCapabilityTechniqueOverrides.capabilityId,
          techniqueId: views.controlCapabilityTechniqueOverrides.mitreTechniqueId,
          kind: views.controlCapabilityTechniqueOverrides.kind,
          function: views.controlCapabilityTechniqueOverrides.function,
        })
        .from(views.controlCapabilityTechniqueOverrides)
        .where(and(
          inArray(views.controlCapabilityTechniqueOverrides.mitreTechniqueId, candidateIds),
          eq(views.controlCapabilityTechniqueOverrides.tenantId, tenantId),
        )),
      db
        .select({ id: views.controlCapabilities.id, externalId: views.controlCapabilities.externalId })
        .from(views.controlCapabilities),
    ]);

    const edges = resolveEffectiveEdges(catalogueRows, overrideRows)
      .filter(isScoredEdge)
      .filter((edge) => repertoireIds.has(edge.techniqueId) || edge.function === 'prevent');
    if (edges.length === 0) {
      return [];
    }
    const capabilityIds = [...new Set(edges.map((edge) => edge.capabilityId))];
    const [assessmentRows, scopeOverrideRows, testedRows] = await Promise.all([
      db
        .select({
          capabilityId: views.controlCapabilityAssessments.capabilityId,
          strengthRung: views.controlCapabilityAssessments.strengthRung,
          coverageBucket: views.controlCapabilityAssessments.coverageBucket,
        })
        .from(views.controlCapabilityAssessments)
        .where(and(
          inArray(views.controlCapabilityAssessments.capabilityId, capabilityIds),
          eq(views.controlCapabilityAssessments.tenantId, tenantId),
        )),
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
      db
        .select({
          capabilityId: views.controlTechniqueTestResults.capabilityId,
          function: views.controlTechniqueTestResults.function,
          techniqueExternalId: views.mitreTechniques.externalId,
          rate: views.controlTechniqueTestResults.rate,
          hostsTested: views.controlTechniqueTestResults.hostsTested,
          scopeHosts: views.controlTechniqueTestResults.scopeHosts,
        })
        .from(views.controlTechniqueTestResults)
        .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.controlTechniqueTestResults.mitreTechniqueId))
        .where(and(
          inArray(views.controlTechniqueTestResults.capabilityId, capabilityIds),
          inArray(views.controlTechniqueTestResults.mitreTechniqueId, candidateIds),
          eq(views.controlTechniqueTestResults.grain, 'technique'),
          eq(views.controlTechniqueTestResults.tenantId, tenantId),
          eq(views.controlTechniqueTestResults.organizationId, organizationId),
        )),
    ]);

    const externalIdByTechniqueId = new Map([
      ...nodeRows.map((row) => [row.id, row.externalId] as const),
      ...stageRows.map((row) => [row.id, row.externalId] as const),
    ]);
    const missingExternalIds = [...new Set(edges
      .map((edge) => edge.techniqueId)
      .filter((techniqueId) => !externalIdByTechniqueId.has(techniqueId)))];
    if (missingExternalIds.length > 0) {
      const parentRows = await db
        .select({ id: views.mitreTechniques.id, externalId: views.mitreTechniques.externalId })
        .from(views.mitreTechniques)
        .where(inArray(views.mitreTechniques.id, missingExternalIds));
      for (const row of parentRows) {
        externalIdByTechniqueId.set(row.id, row.externalId);
      }
    }

    const externalIdByCapabilityId = new Map(capabilityRows.map((row) => [row.id, row.externalId]));
    const assessmentByCapability = new Map(assessmentRows.map((row) => [row.capabilityId, row]));
    const overrideByCapability = new Map(scopeOverrideRows.map((row) => [row.capabilityId, row]));
    const testedByCapability = Map.groupBy(testedRows, (row) => row.capabilityId);
    return capabilityIds.flatMap((capabilityId) => {
      const capabilityExternalId = externalIdByCapabilityId.get(capabilityId);
      if (capabilityExternalId === undefined) {
        return [];
      }
      const assessment = assessmentByCapability.get(capabilityId);
      const posture = resolveScopePosture(assessment, overrideByCapability.get(capabilityId));
      const covered = (capabilityFunction: 'prevent' | 'detect'): Array<string> => [...new Set(edges
        .filter((edge) => edge.capabilityId === capabilityId && edge.function === capabilityFunction)
        .flatMap((edge) => {
          const externalId = externalIdByTechniqueId.get(edge.techniqueId);
          return externalId === undefined ? [] : [externalId];
        }))];
      return [{
        controlId: capabilityId,
        capabilityExternalId,
        strengthRung: posture.strengthRung,
        coverageBucket: posture.coverageBucket,
        preventTechniqueExternalIds: covered('prevent'),
        detectTechniqueExternalIds: covered('detect'),
        tested: (testedByCapability.get(capabilityId) ?? []).map(({ capabilityId: _capabilityId, ...cell }) => cell),
      }];
    });
  },

  findOrganizationIds: async ({ db, views }) =>
    (await db.select({ id: views.organizations.id }).from(views.organizations)).map((row) => row.id),

  findScopeOverridesOfCapabilities: async ({ db, views }, capabilityIds: Array<string>) => {
    if (capabilityIds.length === 0) {
      return [];
    }
    return db
      .select({
        organizationId: views.controlCapabilityScopeOverrides.organizationId,
        capabilityId: views.controlCapabilityScopeOverrides.capabilityId,
        strengthRung: views.controlCapabilityScopeOverrides.strengthRung,
        coverageBucket: views.controlCapabilityScopeOverrides.coverageBucket,
      })
      .from(views.controlCapabilityScopeOverrides)
      .where(inArray(views.controlCapabilityScopeOverrides.capabilityId, capabilityIds));
  },

  findScenarioPrimaryAssetIds: async ({ db, views }, riskScenarioId: string) => {
    const rows = await db
      .select({ primaryAssetId: views.riskScenarioPrimaryAssets.primaryAssetId })
      .from(views.riskScenarioPrimaryAssets)
      .where(eq(views.riskScenarioPrimaryAssets.riskScenarioId, riskScenarioId));
    return rows.map((row) => row.primaryAssetId);
  },

  /** The organisation's declared reaction time, the only organisation-level input the engine reads. */
  findOrganizationReactionTime: async ({ db, views }, organizationId: string) => {
    const rows = await db
      .select({
        min: views.organizations.reactionTimeMin,
        likely: views.organizations.reactionTimeLikely,
        max: views.organizations.reactionTimeMax,
      })
      .from(views.organizations)
      .where(eq(views.organizations.id, organizationId))
      .limit(1);
    return rows[0];
  },

  /**
   * The plans this run prices: those of the scope the simulated scenario belongs to, each with the
   * moves it holds and the scope version it holds them under. A plan priced on a run of another
   * scope would answer what its controls do against a risk it does not claim to treat, and the
   * screens that read the figure back filter on the same scope, so the row would be unreadable.
   *
   * Every plan of the scope is priced, so the cost of a run grows with the plans a scope holds:
   * each is one more evaluation per world and per actor, on top of the baseline, the memoryless
   * replay, the per-technique interdictions and the per-control levers.
   *
   * The status is not a filter. It says what the team intends to do about a plan, not whether its
   * figure is wanted, and a draft is exactly the state where the figure is needed: that is when
   * someone is deciding whether to commit to it.
   */
  findTreatmentPlanTargets: async ({ db, views }, organizationId: string) => {
    const plans = await db
      .select({ id: views.treatmentPlans.id, scopeVersion: views.treatmentPlans.scopeVersion })
      .from(views.treatmentPlans)
      .where(and(
        eq(views.treatmentPlans.organizationId, organizationId),
        exists(db
          .select({ one: sql`1` })
          .from(views.treatmentPlanMoves)
          .where(eq(views.treatmentPlanMoves.planId, views.treatmentPlans.id))),
      ))
      .orderBy(asc(views.treatmentPlans.createdAt), asc(views.treatmentPlans.id));
    if (plans.length === 0) {
      return [];
    }
    const moves = await db
      .select({
        planId: views.treatmentPlanMoves.planId,
        capabilityId: views.treatmentPlanMoves.capabilityId,
        targetStrengthRung: views.treatmentPlanMoves.targetStrengthRung,
        targetCoverageBucket: views.treatmentPlanMoves.targetCoverageBucket,
      })
      .from(views.treatmentPlanMoves)
      .where(inArray(views.treatmentPlanMoves.planId, plans.map((plan) => plan.id)))
      .orderBy(asc(views.treatmentPlanMoves.planId), asc(views.treatmentPlanMoves.capabilityId));
    return plans.map((plan) => ({
      planId: plan.id,
      scopeVersion: plan.scopeVersion,
      moves: moves
        .filter((move) => move.planId === plan.id)
        .map((move) => ({
          controlId: move.capabilityId,
          targetStrengthRung: move.targetStrengthRung,
          targetCoverageBucket: move.targetCoverageBucket,
        })),
    }));
  },

  /**
   * Plans that no longer exist are dropped from the batch rather than inserted.
   *
   * `plan_id` carries a foreign key, so a plan deleted while the run was turning would fail this
   * insert and roll the whole transaction back: the run row and the six sibling tables written
   * beside it, none of which has anything to do with that plan. Deleting one plan would destroy an
   * unrelated scenario's simulation.
   *
   * `for key share` holds the plan rows this statement is about to reference, so a delete racing
   * the check blocks on it rather than committing between the check and the constraint. That closes
   * the window **only because the caller runs inside `atomic`**: outside a transaction the lock
   * ends with the select that took it. The rows are taken in id order, the order a plan write locks
   * them in, or the two would deadlock.
   */
  insertPlanWhatIfResults: async ({ db, views }, values: Array<typeof crqPlanWhatIfResults.$inferInsert>) => {
    if (values.length === 0) {
      return;
    }
    const live = await db
      .select({ id: views.treatmentPlans.id })
      .from(views.treatmentPlans)
      .where(inArray(views.treatmentPlans.id, [...new Set(values.map((row) => row.planId))]))
      .orderBy(views.treatmentPlans.id)
      .for('key share');
    const liveIds = new Set(live.map((row) => row.id));
    const rows = values.filter((row) => liveIds.has(row.planId));
    if (rows.length === 0) {
      return;
    }
    await db.insert(crqPlanWhatIfResults).values(rows);
  },

  /**
   * Reviews closed or deleted while the run was turning are dropped from the batch, and so are
   * lines deleted meanwhile: a foreign key failing here would roll back the whole run, and a closed
   * review is never priced again. `for key share` holds the rows until the insert commits, which
   * works **only because the caller runs inside `atomic`**, and in id order, the order a review write
   * locks them in, or the two would deadlock.
   */
  insertBudgetReviewResults: async (
    { db, views },
    values: Array<typeof crqBudgetReviewResults.$inferInsert>,
    annualLosses: Array<typeof crqBudgetReviewAnnualLosses.$inferInsert>,
  ) => {
    if (values.length === 0 && annualLosses.length === 0) {
      return;
    }
    const lineIds = [...new Set(values.flatMap((row) => (row.lineId == null ? [] : [row.lineId])))];
    const liveReviews = await db
      .select({ id: views.budgetReviews.id })
      .from(views.budgetReviews)
      .where(and(
        inArray(views.budgetReviews.id, [...new Set([...values, ...annualLosses].map((row) => row.reviewId))]),
        eq(views.budgetReviews.status, 'open'),
      ))
      .orderBy(views.budgetReviews.id)
      .for('key share');
    const liveLines = lineIds.length === 0
      ? []
      : await db.select({ id: views.budgetReviewLines.id })
        .from(views.budgetReviewLines)
        .where(inArray(views.budgetReviewLines.id, lineIds))
        .orderBy(views.budgetReviewLines.id)
        .for('key share');
    const reviewIds = new Set(liveReviews.map((row) => row.id));
    const liveLineIds = new Set(liveLines.map((row) => row.id));
    const rows = values.filter((row) => reviewIds.has(row.reviewId) && (row.lineId == null || liveLineIds.has(row.lineId)));
    if (rows.length > 0) {
      await db.insert(crqBudgetReviewResults).values(rows);
    }
    const lossRows = annualLosses.filter((row) => reviewIds.has(row.reviewId));
    if (lossRows.length > 0) {
      await db.insert(crqBudgetReviewAnnualLosses).values(lossRows);
    }
  },

  insertWhatIfResults: ({ db }, values: Array<typeof crqControlWhatIfResults.$inferInsert>) => {
    if (values.length === 0) {
      return Promise.resolve();
    }
    return db.insert(crqControlWhatIfResults).values(values);
  },

  findWhatIfResultsByRunIds: async ({ db, views }, runIds: Array<string>) => {
    if (runIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(views.crqControlWhatIfResults)
      .where(inArray(views.crqControlWhatIfResults.runId, runIds));
  },

  insertAnnualLoss: ({ db }, values: typeof crqIndicatorRunAnnualLosses.$inferInsert) =>
    db.insert(crqIndicatorRunAnnualLosses).values(values),

  findAnnualLossByRunId: async ({ db, views }, runId: string) =>
    db
      .select()
      .from(views.crqIndicatorRunAnnualLosses)
      .where(eq(views.crqIndicatorRunAnnualLosses.runId, runId))
      .then((rows) => rows.at(0)),

  insertCveWhatIfResults: async ({ db }, values: Array<typeof crqCveWhatIfResults.$inferInsert>) => {
    for (let from = 0; from < values.length; from += CVE_WHAT_IF_INSERT_CHUNK_SIZE) {
      await db.insert(crqCveWhatIfResults).values(values.slice(from, from + CVE_WHAT_IF_INSERT_CHUNK_SIZE));
    }
  },

  insertTechniqueWhatIfResults: ({ db }, values: Array<typeof crqTechniqueWhatIfResults.$inferInsert>) => {
    if (values.length === 0) {
      return Promise.resolve();
    }
    return db.insert(crqTechniqueWhatIfResults).values(values);
  },

  /**
   * The techniques ranked by what interdicting them is worth, the two levers together, most valuable
   * first. `nulls last` is explicit: a run without TEF or loss estimates carries no euro value at
   * all, and Postgres sorts nulls FIRST on a descending order. The ATT&CK label travels with the row
   * because the repertoire is wider than any outcome's curated set, so no caller can resolve the ids
   * from what it holds.
   */
  findTechniqueWhatIfResultsByRunId: async ({ db, views }, runId: string) =>
    db
      .select({
        id: views.crqTechniqueWhatIfResults.id,
        mitreTechniqueId: views.crqTechniqueWhatIfResults.mitreTechniqueId,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        preventValueMean: views.crqTechniqueWhatIfResults.preventValueMean,
        detectValueMean: views.crqTechniqueWhatIfResults.detectValueMean,
      })
      .from(views.crqTechniqueWhatIfResults)
      .innerJoin(views.mitreTechniques, eq(views.crqTechniqueWhatIfResults.mitreTechniqueId, views.mitreTechniques.id))
      .where(eq(views.crqTechniqueWhatIfResults.runId, runId))
      .orderBy(
        sql`${views.crqTechniqueWhatIfResults.preventValueMean} + ${views.crqTechniqueWhatIfResults.detectValueMean} desc nulls last`,
        asc(views.mitreTechniques.externalId),
      ),

  findFamilyRunsByScenarioIds: async ({ db, views }, family: CrqRunFamily, riskScenarioIds: Array<string>) => {
    if (riskScenarioIds.length === 0) {
      return [];
    }
    return familyRunsQuery({ db, views }, family, inArray(views.riskScenarios.id, riskScenarioIds));
  },

  /**
   * The run a run's technique values are read from: the latest of its scenario that computed them,
   * up to and including that run. Compared in SQL, since a timestamp read back into JavaScript loses
   * its microseconds and would order a run after itself.
   */
  findTechniqueSourceRunId: async ({ db, views }, runId: string) => {
    const runs = views.crqIndicatorRuns;
    const rows = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(
        sql`${runs.riskScenarioId} = (${db.select({ riskScenarioId: runs.riskScenarioId }).from(runs).where(eq(runs.id, runId))})`,
        sql`'techniques' = any(${runs.profile})`,
        sql`(${runs.createdAt}, ${runs.id}) <= (${db.select({ createdAt: runs.createdAt, id: runs.id }).from(runs).where(eq(runs.id, runId))})`,
      ))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    return rows.at(0)?.id;
  },

  findLatestRunsByScenarioIds: async ({ db, views }, riskScenarioIds: Array<string>) => {
    if (riskScenarioIds.length === 0) {
      return [];
    }
    const run = latestRunOf({ db, views }, {
      runId: views.crqIndicatorRuns.id,
      aleMean: views.crqIndicatorRuns.aleMean,
      aleP10: views.crqIndicatorRuns.aleP10,
      aleP90: views.crqIndicatorRuns.aleP90,
    });
    return db
      .select({ runId: run.runId, riskScenarioId: views.riskScenarios.id, aleMean: run.aleMean, aleP10: run.aleP10, aleP90: run.aleP90 })
      .from(views.riskScenarios)
      .innerJoinLateral(run, LATERAL_ON)
      .where(inArray(views.riskScenarios.id, riskScenarioIds));
  },

  findRunSourcesByIds: async ({ db, views }, runIds: Array<string>) => {
    if (runIds.length === 0) {
      return [];
    }
    return db
      .select({ runId: views.crqIndicatorRuns.id, createdAt: views.crqIndicatorRuns.createdAt, aleMean: views.crqIndicatorRuns.aleMean })
      .from(views.crqIndicatorRuns)
      .where(inArray(views.crqIndicatorRuns.id, runIds));
  },

  /** One CVE's row of each run named, a CVE the run did not price having none. */
  findCveWhatIfRowsByRunIds: async ({ db, views }, runIds: Array<string>, cveRowId: string) => {
    if (runIds.length === 0) {
      return [];
    }
    return db
      .select({
        runId: views.crqCveWhatIfResults.runId,
        mean: views.crqCveWhatIfResults.aleReductionMean,
        p10: views.crqCveWhatIfResults.aleReductionP10,
        p90: views.crqCveWhatIfResults.aleReductionP90,
      })
      .from(views.crqCveWhatIfResults)
      .where(and(inArray(views.crqCveWhatIfResults.runId, runIds), eq(views.crqCveWhatIfResults.cveId, cveRowId)));
  },

  /**
   * The cross-product lookup's exposure of threat actors: per actor named, each scenario whose latest
   * run simulated it, with that run's mean annual loss.
   */
  // bounded-by: the caller's MAX_COUNTERPART_KEYS ids; one latest-run probe per scenario of the tenant
  findXtmThreatExposure: async ({ db, views }, analysisIds: Array<string>) => {
    if (analysisIds.length === 0) {
      return [];
    }
    const run = latestRunOf({ db, views }, { runId: views.crqIndicatorRuns.id, aleMean: views.crqIndicatorRuns.aleMean });
    return db
      .selectDistinct({ objectId: views.crqIndicatorGroupScores.groupKey, riskScenarioId: views.riskScenarios.id, aleMean: run.aleMean })
      .from(views.riskScenarios)
      .innerJoinLateral(run, LATERAL_ON)
      .innerJoin(views.crqIndicatorGroupScores, eq(views.crqIndicatorGroupScores.runId, run.runId))
      .where(inArray(views.crqIndicatorGroupScores.groupKey, analysisIds));
  },

  /**
   * The cross-product lookup's exposure of supporting assets: per asset named, each scenario aimed at a
   * primary asset that reaches it, with the scenario's latest mean annual loss (null when unpriced).
   */
  // bounded-by: the caller's MAX_COUNTERPART_KEYS ids; one latest-run probe per scenario reached
  findXtmAssetExposure: async ({ db, views }, supportingAssetIds: Array<string>) => {
    if (supportingAssetIds.length === 0) {
      return [];
    }
    const run = latestRunOf({ db, views }, { aleMean: views.crqIndicatorRuns.aleMean });
    return db
      .selectDistinct({ objectId: views.primaryAssetReach.supportingAssetId, riskScenarioId: views.riskScenarios.id, aleMean: run.aleMean })
      .from(views.primaryAssetReach)
      .innerJoin(views.riskScenarioPrimaryAssets, eq(views.riskScenarioPrimaryAssets.primaryAssetId, views.primaryAssetReach.primaryAssetId))
      .innerJoin(views.riskScenarios, eq(views.riskScenarios.id, views.riskScenarioPrimaryAssets.riskScenarioId))
      .leftJoinLateral(run, LATERAL_ON)
      .where(inArray(views.primaryAssetReach.supportingAssetId, supportingAssetIds));
  },

  /**
   * The cross-product lookup's exposure of CVEs: per CVE row named, each scenario whose newest run
   * computing the flaw what-ifs whole priced it, with the scenario's latest mean annual loss and what
   * fixing the flaw is worth there.
   */
  // bounded-by: the caller's MAX_COUNTERPART_KEYS ids; two latest-run probes per scenario of the tenant
  findXtmCveExposure: async ({ db, views }, cveRowIds: Array<string>) => {
    if (cveRowIds.length === 0) {
      return [];
    }
    const runs = views.crqIndicatorRuns;
    const cveRun = db
      .select({ runId: runs.id })
      .from(runs)
      .where(and(eq(runs.riskScenarioId, views.riskScenarios.id), sql`'cves' = any(${runs.profile})`))
      .orderBy(...latestRunFirst(views))
      .limit(1)
      .as('cve_run');
    const run = latestRunOf({ db, views }, { aleMean: runs.aleMean });
    return db
      .select({
        objectId: views.crqCveWhatIfResults.cveId,
        riskScenarioId: views.riskScenarios.id,
        aleMean: run.aleMean,
        aleReductionMean: views.crqCveWhatIfResults.aleReductionMean,
      })
      .from(views.riskScenarios)
      .innerJoinLateral(cveRun, LATERAL_ON)
      .leftJoinLateral(run, LATERAL_ON)
      .innerJoin(views.crqCveWhatIfResults, eq(views.crqCveWhatIfResults.runId, cveRun.runId))
      .where(inArray(views.crqCveWhatIfResults.cveId, cveRowIds));
  },

  findWhatIfResultsMeanByRunIds: async ({ db, views }, runIds: Array<string>) => {
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
        aleReduction: views.crqControlWhatIfResults.aleReductionMean,
      })
      .from(views.crqControlWhatIfResults)
      .innerJoin(views.crqIndicatorRuns, eq(views.crqControlWhatIfResults.runId, views.crqIndicatorRuns.id))
      .innerJoin(views.controlCapabilities, eq(views.crqControlWhatIfResults.controlId, views.controlCapabilities.id))
      .where(inArray(views.crqControlWhatIfResults.runId, runIds))
      // `aggregateTopControls` elects a control's suggested dimension on strict `>`, so an
      // unordered read would let two equal dimensions swap between identical calls.
      .orderBy(asc(views.crqControlWhatIfResults.controlId), asc(views.crqControlWhatIfResults.dimension));
  },
});
