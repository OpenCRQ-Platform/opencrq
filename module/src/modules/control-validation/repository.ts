import { and, asc, count, desc, eq, exists, gte, inArray, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';
import type { ResolvedEstate } from '../organizations/estate-filter';
import type { ExpectationType } from '../supporting-assets/constants';
import type { CapabilityFunction } from '../controls/capability/constants';
import type { EvidenceLineSortKey } from './constants';
import type { FleetCoverage, FleetTally } from './asset-protection';
import type { FoldedValidationResults, ProvenVerdict } from './engine';
import type { TimelineVerdict } from './proven-posture-history';
import type { TechniqueTestCount, TechniqueTestGrain } from './technique-test-results';
import { inUuids } from '../../db/uuid-array';
import { defineRepository } from '../../registry';
import { orderByFolded } from '../../db/fold-text';
import { estateFilter } from '../organizations/estate-filter';
import { EXPECTATION_TYPE_VALUES } from '../supporting-assets/constants';
import { storedFindingVerdict, verdictState } from '../supporting-assets/latest-evidence-state';
import { fleetPairSet } from './fleet-pair-set';
import { controlProvenPostureHistory, controlTechniqueTestResults } from './schema';

const WRITE_CHUNK_SIZE = 1000;

/** What the derivation reads of a technique result, apart from its verdict. */
const validationEvidenceColumns = ({ views }: Pick<RepositoryContext, 'views'>) => ({
  supportingAssetId: views.assetEvidence.supportingAssetId,
  mitreTechniqueId: views.mitreTechniques.id,
  parentTechniqueId: views.mitreTechniques.parentTechniqueId,
  expectationType: views.assetEvidence.expectationType,
  securityPlatformType: views.assetEvidence.securityPlatformType,
  sourceScenarioId: views.assetEvidence.sourceScenarioId,
  sourceSimulationId: views.assetEvidence.sourceSimulationId,
  evaluatedAt: views.assetEvidence.evaluatedAt,
});

/** Which of an estate's technique results a read keeps; each list given keeps only the results it names. */
export interface ValidationEvidenceNarrowing {
  mitreTechniqueIds?: Array<string>,
  securityPlatformTypes?: Array<string>,
  /** Keeps a result measured since then, on the date `isFreshMeasurement` ages. */
  measuredSince?: Date,
}

/** A narrowing naming the families, whose pairs a fleet coverage set is made of. */
export type FleetNarrowing = ValidationEvidenceNarrowing & { securityPlatformTypes: Array<string> };

/** A narrowing given an empty list, which no result can pass. */
const keepsNothing = ({ mitreTechniqueIds, securityPlatformTypes }: ValidationEvidenceNarrowing): boolean =>
  mitreTechniqueIds?.length === 0 || securityPlatformTypes?.length === 0;

const estateResults = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  estate: ResolvedEstate,
  { mitreTechniqueIds, securityPlatformTypes }: ValidationEvidenceNarrowing,
): SQL => and(
  // A technique list already excludes null: an `is not null` beside it multiplies its selectivity into
  // the planner's estimate, enough to plan the coverage fold serial and spilling.
  mitreTechniqueIds === undefined
    ? isNotNull(views.assetEvidence.mitreTechniqueId)
    : inUuids(views.assetEvidence.mitreTechniqueId, mitreTechniqueIds),
  estateFilter({ db, views }, estate, views.assetEvidence.supportingAssetId),
  securityPlatformTypes === undefined ? undefined : inArray(views.assetEvidence.securityPlatformType, securityPlatformTypes),
)!;

/** `resolveMeasuredResult`'s date: `greatest` skips a null evaluation, and a result with a verdict carries its own. */
const measuredAt = ({ views }: Pick<RepositoryContext, 'views'>) =>
  sql<Date>`greatest(${views.assetEvidence.evaluatedAt}, ${views.assetEvidence.latestVerdictObservedAt})`;

const measuredSince = (ctx: Pick<RepositoryContext, 'views'>, since: Date | undefined) =>
  (since === undefined ? undefined : sql`${measuredAt(ctx)} >= ${since.toISOString()}::timestamptz`);

/** The results the folds read: of a family and an expectation type, fresh, each with its stored latest verdict. */
const freshResults = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  estate: ResolvedEstate,
  narrowing: ValidationEvidenceNarrowing,
) => {
  const results = estateResults({ db, views }, estate, narrowing);
  const latestRun = storedFindingVerdict({ views });
  return {
    latestRun,
    where: and(
      results,
      latestRun.spoken,
      isNotNull(views.assetEvidence.securityPlatformType),
      isNotNull(views.assetEvidence.expectationType),
      measuredSince({ views }, narrowing.measuredSince),
    ),
  };
};

/** The techniques one control scores, by the expectation type whose function scores them. */
export type ScoredTechniques = Record<ExpectationType, ReadonlyArray<string>>;

/** An evidence line as the derivation keys it, its function read as the expectation type behind it. */
export interface EvidenceLineKey {
  techniqueId: string,
  expectationType: ExpectationType,
  securityPlatformType: string,
  voteKey: string,
}

/**
 * `resolveCellTechniqueId`: `own` of the result's technique when the control scores it, else `parent`
 * of its parent's, else null.
 */
const cellOf = <T>({ views }: Pick<RepositoryContext, 'views'>, scored: ScoredTechniques, own: SQLWrapper, parent: SQLWrapper) => sql<T | null>`case ${sql.join(
  EXPECTATION_TYPE_VALUES.map((type) => sql`when ${views.assetEvidence.expectationType} = ${type} then case
    when ${inUuids(views.mitreTechniques.id, scored[type])} then ${own}
    when ${inUuids(views.mitreTechniques.parentTechniqueId, scored[type])} then ${parent} end`),
  sql` `,
)} end`;

/**
 * Where a control's evidence lines file a result: `scored` keeps the ones voting in a cell the control
 * scores, as the derivation reads them; `tested` files one in no such cell on its own technique. The
 * narrowing decides which techniques' results are read at all.
 */
export type LineFiling = 'scored' | 'tested';

const filedOn = <T>(filing: LineFiling, cell: SQL<T | null>, own: SQLWrapper): SQL<T | null> =>
  (filing === 'tested' ? sql<T>`coalesce(${cell}, ${own})` : cell);

/** The derivation's `voteKeyOf`. */
const voteKeyOf = ({ views }: Pick<RepositoryContext, 'views'>) =>
  sql<string>`coalesce(${views.assetEvidence.sourceScenarioId}, ${views.assetEvidence.sourceSimulationId}, '')`;

/**
 * The control's fresh results, each placed on its evidence line: the cell `filing` files it in, the
 * expectation type of its function, its family and its vote key. `lines` keeps the results of those
 * lines alone.
 */
const lineResults = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  estate: ResolvedEstate,
  narrowing: ValidationEvidenceNarrowing,
  scored: ScoredTechniques,
  filing: LineFiling,
  lines?: ReadonlyArray<EvidenceLineKey>,
) => {
  const { where } = freshResults({ db, views }, estate, narrowing);
  // The secured view is already a subquery named after the table, so the parent goes through a second
  // subquery over it rather than alias(), which only takes a table.
  const parents = db
    .select({ id: views.mitreTechniques.id, externalId: views.mitreTechniques.externalId })
    .from(views.mitreTechniques)
    .as('parent_technique');
  const cellTechniqueId = filedOn(filing, cellOf<string>({ views }, scored, views.mitreTechniques.id, views.mitreTechniques.parentTechniqueId), views.mitreTechniques.id);
  const cellExternalId = filedOn(filing, cellOf<string>({ views }, scored, views.mitreTechniques.externalId, parents.externalId), views.mitreTechniques.externalId);
  const voteKey = voteKeyOf({ views });
  const lineTechniqueIds = [...new Set((lines ?? []).map((line) => line.techniqueId))];
  return db
    .select({
      techniqueId: sql<string>`${cellTechniqueId}`.as('cell_technique_id'),
      techniqueExternalId: sql<string>`${cellExternalId}`.as('cell_technique_external_id'),
      expectationType: sql<ExpectationType>`${views.assetEvidence.expectationType}`.as('expectation_type'),
      securityPlatformType: sql<string>`${views.assetEvidence.securityPlatformType}`.as('security_platform_type'),
      voteKey: voteKey.as('vote_key'),
      supportingAssetId: sql<string>`${views.assetEvidence.supportingAssetId}`.as('supporting_asset_id'),
      exposed: sql<boolean>`${views.assetEvidence.latestVerdictExposed}`.as('exposed'),
      measuredAt: sql<Date>`${measuredAt({ views })}`.as('measured_at'),
      scenarioId: sql<string | null>`${views.assetEvidence.sourceScenarioId}`.as('scenario_id'),
      scenarioName: sql<string | null>`${views.assetEvidence.sourceScenarioName}`.as('scenario_name'),
      simulationId: sql<string | null>`${views.assetEvidence.sourceSimulationId}`.as('simulation_id'),
    })
    .from(views.assetEvidence)
    .innerJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
    .leftJoin(parents, eq(parents.id, views.mitreTechniques.parentTechniqueId))
    .where(and(
      where,
      sql`${cellTechniqueId} is not null`,
      // A superset of the lines on plain columns, which an index can serve; the caller keeps the lines themselves.
      ...(lines === undefined ? [] : [
        inArray(views.assetEvidence.securityPlatformType, [...new Set(lines.map((line) => line.securityPlatformType))]),
        sql`${voteKey} = any(${sql.param([...new Set(lines.map((line) => line.voteKey))])}::text[])`,
        or(inUuids(views.mitreTechniques.id, lineTechniqueIds), inUuids(views.mitreTechniques.parentTechniqueId, lineTechniqueIds)),
      ]),
    ))
    .as('line_results');
};

/** The assets of `lines`, one row each, contradicted when any of its results there is. */
const evidenceLineAssets = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  estate: ResolvedEstate,
  narrowing: ValidationEvidenceNarrowing,
  scored: ScoredTechniques,
  lines: ReadonlyArray<EvidenceLineKey>,
) => {
  const results = lineResults({ db, views }, estate, narrowing, scored, 'scored', lines);
  const grouped = db
    .select({
      techniqueId: results.techniqueId,
      expectationType: results.expectationType,
      securityPlatformType: results.securityPlatformType,
      voteKey: results.voteKey,
      supportingAssetId: results.supportingAssetId,
      contradicted: sql<boolean>`bool_or(${results.exposed})`.as('contradicted'),
    })
    .from(results)
    .groupBy(results.techniqueId, results.expectationType, results.securityPlatformType, results.voteKey, results.supportingAssetId)
    .as('line_result_assets');
  // Joined above the grouping, which the planner cannot drive line by line: below it, it rescanned the
  // whole superset once per line. An `or` of one clause per line is no better, tested on every result.
  const wanted = sql`unnest(
    ${sql.param(lines.map((line) => line.techniqueId))}::uuid[],
    ${sql.param(lines.map((line) => line.expectationType))}::text[],
    ${sql.param(lines.map((line) => line.securityPlatformType))}::text[],
    ${sql.param(lines.map((line) => line.voteKey))}::text[]
  ) as wanted_line(wanted_technique_id, wanted_expectation_type, wanted_security_platform_type, wanted_vote_key)`;
  return db
    .select({
      techniqueId: grouped.techniqueId,
      expectationType: grouped.expectationType,
      securityPlatformType: grouped.securityPlatformType,
      voteKey: grouped.voteKey,
      supportingAssetId: grouped.supportingAssetId,
      contradicted: grouped.contradicted,
    })
    .from(grouped)
    .innerJoin(wanted, sql`wanted_technique_id = ${grouped.techniqueId}
      and wanted_expectation_type = ${grouped.expectationType}
      and wanted_security_platform_type = ${grouped.securityPlatformType}
      and wanted_vote_key = ${grouped.voteKey}`)
    .as('line_assets');
};

type LineResults = ReturnType<typeof lineResults>;

/**
 * `column` of the line's latest result: a line names the replay of its scenario that was measured
 * last, and of two measured at the same instant, the greater simulation id, then the greater name.
 */
const latestOf = <T>(results: LineResults, column: SQL.Aliased<T>) =>
  sql<T>`(array_agg(${column} order by ${results.measuredAt} desc, coalesce(${results.simulationId}, '') desc, coalesce(${results.scenarioName}, '') desc))[1]`;

/**
 * The control's evidence lines, one per (cell, function, family, vote key): contradicted when one of
 * its assets is, dated on its latest result and named after it, with its assets counted. An asset
 * gave way when one of its results did, so it is counted once among the contradicted.
 */
const evidenceLines = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  estate: ResolvedEstate,
  narrowing: ValidationEvidenceNarrowing,
  scored: ScoredTechniques,
  filing: LineFiling,
) => {
  const results = lineResults({ db, views }, estate, narrowing, scored, filing);
  const contradicted = sql`count(distinct ${results.supportingAssetId}) filter (where ${results.exposed})`;
  return db
    .select({
      techniqueId: results.techniqueId,
      techniqueExternalId: sql<string>`max(${results.techniqueExternalId})`.as('technique_external_id'),
      expectationType: results.expectationType,
      securityPlatformType: results.securityPlatformType,
      voteKey: results.voteKey,
      scenarioId: sql<string | null>`max(${results.scenarioId})`.as('line_scenario_id'),
      simulationId: latestOf<string | null>(results, results.simulationId).as('line_simulation_id'),
      scenarioName: latestOf<string | null>(results, results.scenarioName).as('line_scenario_name'),
      evaluatedAt: sql<Date>`max(${results.measuredAt})`.as('line_evaluated_at'),
      validated: sql<number>`count(distinct ${results.supportingAssetId}) - ${contradicted}`.as('validated_assets'),
      contradicted: sql<number>`${contradicted}`.as('contradicted_assets'),
      // Over the grouped lines, before the filters keep some of them.
      unfilteredTotal: sql<number>`count(*) over ()`.as('unfiltered_total'),
    })
    .from(results)
    .groupBy(results.techniqueId, results.expectationType, results.securityPlatformType, results.voteKey)
    .as('evidence_lines');
};

type EvidenceLines = ReturnType<typeof evidenceLines>;

/** How each sort key orders the lines. */
const LINE_ORDERS: Record<EvidenceLineSortKey, (lines: EvidenceLines) => SQL> = {
  technique: (lines) => sql`${lines.techniqueExternalId}`,
  scenario: (lines) => sql`fold_text(${lines.scenarioName})`,
  family: (lines) => sql`${lines.securityPlatformType}`,
  function: (lines) => sql`${lines.expectationType}`,
  // Ascending puts the lines where an asset gave way first.
  verdict: (lines) => sql`${lines.contradicted} = 0`,
  evaluatedAt: (lines) => sql`${lines.evaluatedAt}`,
  assets: (lines) => sql`${lines.validated} + ${lines.contradicted}`,
};

/** Which evidence lines a read keeps; each filter given keeps only the lines it names. */
export interface EvidenceLineFilters {
  /** An ATT&CK external id: the lines filed on that technique and on its sub-techniques. */
  techniqueExternalId?: string,
  expectationType?: ExpectationType,
  /** `contradicted` keeps the lines where an asset gave way. */
  verdict?: ProvenVerdict,
  securityPlatformType?: string,
}

export interface EvidenceLinePageQuery extends EvidenceLineFilters {
  filing: LineFiling,
  sortBy?: EvidenceLineSortKey,
  sortDesc: boolean,
  offset: number,
  limit: number,
}

const lineFilter = (
  lines: EvidenceLines,
  { techniqueExternalId, expectationType, verdict, securityPlatformType }: EvidenceLineFilters,
): SQL | undefined => and(
  techniqueExternalId === undefined
    ? undefined
    : or(eq(lines.techniqueExternalId, techniqueExternalId), sql`starts_with(${lines.techniqueExternalId}, ${`${techniqueExternalId}.`})`),
  expectationType === undefined ? undefined : eq(lines.expectationType, expectationType),
  verdict === undefined ? undefined : sql`${lines.contradicted} ${verdict === 'contradicted' ? sql`>` : sql`=`} 0`,
  securityPlatformType === undefined ? undefined : eq(lines.securityPlatformType, securityPlatformType),
);

/** The population `N` counts and the results are read on: every host of the estate, however long unseen and whoever reports it. */
const isHost = ({ views }: Pick<RepositoryContext, 'views'>): SQL => eq(views.supportingAssets.categoryId, 'host');

/**
 * Every row the derivation reads lives in the supporting-assets, controls and mitre-attack modules.
 * The tables this module owns hold what it derived: the history of what it proved, and OpenAEV's
 * results per control and technique.
 */
export const controlValidationRepository = defineRepository({
  /**
   * Every technique result of the estate the narrowing keeps, with its latest test verdict.
   *
   * A row no test ever spoke about never reaches the derivation: a state a person set is a decision,
   * and reading the finding's state instead of its latest verdict would launder that opinion into a
   * measurement.
   */
  findValidationEvidence: async ({ db, views }, estate: ResolvedEstate, narrowing: ValidationEvidenceNarrowing = {}) => {
    if (keepsNothing(narrowing)) {
      return [];
    }
    const results = estateResults({ db, views }, estate, narrowing);
    const latestRun = storedFindingVerdict({ views });

    return db
      .select({ ...validationEvidenceColumns({ views }), runVerdict: latestRun.state, runAt: latestRun.observedAt })
      .from(views.assetEvidence)
      .innerJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
      .where(and(results, latestRun.spoken, measuredSince({ views }, narrowing.measuredSince)));
  },

  /**
   * {@link findValidationEvidence} folded at the grain of a vote, on the results the narrowing keeps
   * fresh: a control's derivation over them is its derivation over the rows, shipped in a few
   * thousand groups instead of one row per result.
   */
  findFoldedValidationResults: async (
    { db, views },
    estate: ResolvedEstate,
    narrowing: ValidationEvidenceNarrowing,
  ): Promise<Array<FoldedValidationResults>> => {
    if (keepsNothing(narrowing)) {
      return [];
    }
    const { where } = freshResults({ db, views }, estate, narrowing);
    const rows = await db
      .select({
        mitreTechniqueId: views.mitreTechniques.id,
        parentTechniqueId: views.mitreTechniques.parentTechniqueId,
        expectationType: sql<ExpectationType>`${views.assetEvidence.expectationType}`,
        securityPlatformType: views.assetEvidence.securityPlatformType,
        sourceScenarioId: views.assetEvidence.sourceScenarioId,
        sourceSimulationId: views.assetEvidence.sourceSimulationId,
        runVerdict: verdictState(sql`bool_or(${views.assetEvidence.latestVerdictExposed})`),
        evaluatedAt: sql<Date | null>`max(${measuredAt({ views })})`.mapWith(views.assetEvidence.evaluatedAt),
      })
      .from(views.assetEvidence)
      .innerJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
      .where(where)
      .groupBy(
        views.mitreTechniques.id,
        views.mitreTechniques.parentTechniqueId,
        views.assetEvidence.expectationType,
        views.assetEvidence.securityPlatformType,
        views.assetEvidence.sourceScenarioId,
        views.assetEvidence.sourceSimulationId,
      );
    return rows.map((group) => ({ ...group, runAt: null }));
  },

  /**
   * One page of the control's evidence lines, in `query`'s order. Each row carries the number of lines
   * `query`'s filters keep and the number of lines there are: none comes back past the last page.
   */
  findEvidenceLinePage: async (
    { db, views },
    estate: ResolvedEstate,
    narrowing: ValidationEvidenceNarrowing,
    scored: ScoredTechniques,
    { filing, sortBy, sortDesc, offset, limit, ...filters }: EvidenceLinePageQuery,
  ) => {
    if (keepsNothing(narrowing)) {
      return [];
    }
    const lines = evidenceLines({ db, views }, estate, narrowing, scored, filing);
    return db
      .select({
        techniqueId: lines.techniqueId,
        techniqueExternalId: lines.techniqueExternalId,
        expectationType: lines.expectationType,
        securityPlatformType: lines.securityPlatformType,
        voteKey: lines.voteKey,
        scenarioId: lines.scenarioId,
        scenarioName: lines.scenarioName,
        simulationId: lines.simulationId,
        evaluatedAt: sql<Date>`${lines.evaluatedAt}`.mapWith(views.assetEvidence.evaluatedAt),
        validated: sql<number>`${lines.validated}`.mapWith(Number),
        contradicted: sql<number>`${lines.contradicted}`.mapWith(Number),
        total: sql<number>`count(*) over ()`.mapWith(Number),
        unfilteredTotal: sql<number>`${lines.unfilteredTotal}`.mapWith(Number),
      })
      .from(lines)
      .where(lineFilter(lines, filters))
      .orderBy(
        ...(sortBy === undefined ? [] : [sql`${LINE_ORDERS[sortBy](lines)} ${sortDesc ? sql`desc` : sql`asc`} nulls last`]),
        asc(lines.techniqueExternalId),
        asc(lines.expectationType),
        asc(lines.voteKey),
        asc(lines.securityPlatformType),
      )
      .limit(limit)
      .offset(offset);
  },

  /** {@link findEvidenceLinePage}'s two counts, for a page that came back empty. */
  countEvidenceLines: async (
    { db, views },
    estate: ResolvedEstate,
    narrowing: ValidationEvidenceNarrowing,
    scored: ScoredTechniques,
    filing: LineFiling,
    filters: EvidenceLineFilters,
  ) => {
    if (keepsNothing(narrowing)) {
      return { total: 0, unfilteredTotal: 0 };
    }
    const lines = evidenceLines({ db, views }, estate, narrowing, scored, filing);
    const [row] = await db
      .select({
        total: sql<number>`count(*) filter (where ${lineFilter(lines, filters) ?? sql`true`})`.mapWith(Number),
        unfilteredTotal: sql<number>`count(*)`.mapWith(Number),
      })
      .from(lines);
    return row ?? { total: 0, unfilteredTotal: 0 };
  },

  /** The techniques the control's evidence lines are filed on. */
  findEvidenceLineTechniqueIds: async (
    { db, views },
    estate: ResolvedEstate,
    narrowing: ValidationEvidenceNarrowing,
    scored: ScoredTechniques,
    filing: LineFiling,
  ): Promise<Array<string>> => {
    if (keepsNothing(narrowing)) {
      return [];
    }
    const results = lineResults({ db, views }, estate, narrowing, scored, filing);
    return (await db.selectDistinct({ techniqueId: results.techniqueId }).from(results)).map((row) => row.techniqueId);
  },

  /** The first `perLine` assets of each of `lines`, the ones that gave way first, then by name. */
  findFirstEvidenceLineAssets: async (
    { db, views },
    estate: ResolvedEstate,
    narrowing: ValidationEvidenceNarrowing,
    scored: ScoredTechniques,
    lines: ReadonlyArray<EvidenceLineKey>,
    perLine: number,
  ) => {
    if (keepsNothing(narrowing) || lines.length === 0) {
      return [];
    }
    const assets = evidenceLineAssets({ db, views }, estate, narrowing, scored, lines);
    // bounded-by: restricted inside to the assets of `lines`, every one of which the caller reads
    const ranked = db
      .select({
        techniqueId: assets.techniqueId,
        expectationType: assets.expectationType,
        securityPlatformType: assets.securityPlatformType,
        voteKey: assets.voteKey,
        id: sql<string>`${views.supportingAssets.id}`.as('asset_id'),
        name: sql<string | null>`${views.supportingAssets.name}`.as('asset_name'),
        derivedName: sql<string | null>`${views.supportingAssets.derivedName}`.as('asset_derived_name'),
        contradicted: assets.contradicted,
        rank: sql<number>`row_number() over (
          partition by ${assets.techniqueId}, ${assets.expectationType}, ${assets.securityPlatformType}, ${assets.voteKey}
          order by ${assets.contradicted} desc, ${sql.join(orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.name, false), sql`, `)}, ${views.supportingAssets.id}
        )`.as('asset_rank'),
      })
      .from(assets)
      .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, assets.supportingAssetId))
      .as('ranked_line_assets');
    return db
      .select({
        techniqueId: ranked.techniqueId,
        expectationType: ranked.expectationType,
        securityPlatformType: ranked.securityPlatformType,
        voteKey: ranked.voteKey,
        id: ranked.id,
        name: ranked.name,
        derivedName: ranked.derivedName,
        contradicted: ranked.contradicted,
      })
      .from(ranked)
      .where(sql`${ranked.rank} <= ${perLine}`)
      .orderBy(ranked.techniqueId, ranked.expectationType, ranked.securityPlatformType, ranked.voteKey, ranked.rank);
  },

  /**
   * The fresh results of the estate the narrowing keeps, per technique, family and expectation type:
   * the fleet's tallies, which add up across whichever of them a control counts.
   */
  findFleetTallies: async ({ db, views }, estate: ResolvedEstate, narrowing: ValidationEvidenceNarrowing): Promise<Array<FleetTally>> => {
    if (keepsNothing(narrowing)) {
      return [];
    }
    const { latestRun, where } = freshResults({ db, views }, estate, narrowing);
    return db
      .select({
        techniqueId: sql<string>`${views.assetEvidence.mitreTechniqueId}`,
        platformTypeKey: sql<string>`${views.assetEvidence.securityPlatformType}`,
        expectationType: sql<ExpectationType>`${views.assetEvidence.expectationType}`,
        // `resolveMeasuredResult`'s rule: any verdict but `applicable` held.
        held: sql<number>`count(*) filter (where ${latestRun.state} <> 'applicable')`.mapWith(Number),
        total: count(),
        lastRunAt: sql<Date | null>`max(${measuredAt({ views })})`.mapWith(views.assetEvidence.evaluatedAt),
      })
      .from(views.assetEvidence)
      .where(where)
      .groupBy(views.assetEvidence.mitreTechniqueId, views.assetEvidence.securityPlatformType, views.assetEvidence.expectationType);
  },

  /**
   * How many assets of the estate the narrowing keeps were tested, fresh, on each technique by each
   * set of families and expectation types: one count per set, so an asset a control counts through
   * two of them still counts once.
   */
  findFleetCoverage: async (
    { db, views },
    estate: ResolvedEstate,
    narrowing: FleetNarrowing,
  ): Promise<Array<FleetCoverage>> => {
    if (keepsNothing(narrowing)) {
      return [];
    }
    const { where } = freshResults({ db, views }, estate, narrowing);
    const pairs = fleetPairSet(narrowing.securityPlatformTypes);
    const perAsset = db
      .select({
        techniqueId: views.assetEvidence.mitreTechniqueId,
        pairSet: sql<string>`bit_or(${pairs.setOf(views.assetEvidence.securityPlatformType, views.assetEvidence.expectationType)})`.as('pair_set'),
      })
      .from(views.assetEvidence)
      .where(where)
      .groupBy(views.assetEvidence.mitreTechniqueId, views.assetEvidence.supportingAssetId)
      .as('per_asset');
    const groups = await db
      .select({ techniqueId: sql<string>`${perAsset.techniqueId}`, pairSet: perAsset.pairSet, assetCount: count() })
      .from(perAsset)
      .groupBy(perAsset.techniqueId, perAsset.pairSet);
    return groups.map(({ pairSet, ...group }) => ({ ...group, pairs: pairs.pairsIn(pairSet) }));
  },

  /**
   * The fresh tests of the estate's hosts, counted per control, expectation type, technique and grain.
   * A test is one finding: a scenario on a host, technique, expectation type and platform type. It
   * counts whole for every control its platform type implements, under its parent technique, and a
   * test on a sub-technique counts in that sub-technique's own row too. A host counts once per row,
   * however many scenarios or platform types reached it.
   */
  countTechniqueTests: async (
    { db, views },
    estate: ResolvedEstate,
    narrowing: FleetNarrowing,
  ): Promise<Array<TechniqueTestCount>> => {
    if (keepsNothing(narrowing)) {
      return [];
    }
    const { latestRun, where } = freshResults({ db, views }, estate, narrowing);
    const tests = db
      .select({
        supportingAssetId: sql<string>`${views.assetEvidence.supportingAssetId}`.as('supporting_asset_id'),
        mitreTechniqueId: sql<string>`${views.mitreTechniques.id}`.as('mitre_technique_id'),
        parentTechniqueId: sql<string | null>`${views.mitreTechniques.parentTechniqueId}`.as('parent_technique_id'),
        expectationType: sql<ExpectationType>`${views.assetEvidence.expectationType}`.as('expectation_type'),
        securityPlatformType: sql<string>`${views.assetEvidence.securityPlatformType}`.as('security_platform_type'),
        held: sql<boolean>`${latestRun.state} <> 'applicable'`.as('held'),
      })
      .from(views.assetEvidence)
      .innerJoin(views.supportingAssets, eq(views.assetEvidence.supportingAssetId, views.supportingAssets.id))
      .innerJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
      .where(and(where, isHost({ views })))
      .as('tests');
    const platformControls = db
      .selectDistinct({
        platformTypeKey: sql<string>`${views.securityPlatformFamilies.platformTypeKey}`.as('platform_type_key'),
        capabilityId: sql<string>`${views.securityPlatformFamilyControls.capabilityId}`.as('capability_id'),
      })
      .from(views.securityPlatformFamilyControls)
      .innerJoin(views.securityPlatformFamilies, eq(views.securityPlatformFamilies.id, views.securityPlatformFamilyControls.familyId))
      .as('platform_controls');
    return db
      .select({
        capabilityId: sql<string>`platform_controls.capability_id`,
        expectationType: sql<ExpectationType>`tests.expectation_type`,
        mitreTechniqueId: sql<string>`grains.technique_id`,
        grain: sql<TechniqueTestGrain>`grains.grain`,
        tests: sql<number>`count(*)`.mapWith(Number),
        heldTests: sql<number>`count(*) filter (where tests.held)`.mapWith(Number),
        hostsTested: sql<number>`count(distinct tests.supporting_asset_id)`.mapWith(Number),
      })
      .from(sql`${tests}
        join ${platformControls} on platform_controls.platform_type_key = tests.security_platform_type
        cross join lateral (values
          (coalesce(tests.parent_technique_id, tests.mitre_technique_id), 'technique'),
          (case when tests.parent_technique_id is not null then tests.mitre_technique_id end, 'sub_technique')
        ) as grains (technique_id, grain)`)
      .where(sql`grains.technique_id is not null`)
      .groupBy(sql`platform_controls.capability_id, tests.expectation_type, grains.technique_id, grains.grain`);
  },

  /** `N`: the estate's hosts. */
  countScopeHosts: async ({ db, views }, estate: ResolvedEstate): Promise<number> => {
    const [row] = await db
      .select({ count: count() })
      .from(views.supportingAssets)
      .where(and(estateFilter({ db, views }, estate, views.supportingAssets.id), isHost({ views })));
    return row?.count ?? 0;
  },

  findTechniqueTestResults: async ({ db, views }) => db
    .select()
    .from(views.controlTechniqueTestResults),

  /** The risk scopes holding a stored result. */
  findTechniqueTestResultScopeIds: async ({ db, views }): Promise<Array<string>> => (await db
    .selectDistinct({ organizationId: views.controlTechniqueTestResults.organizationId })
    .from(views.controlTechniqueTestResults)
    .where(isNotNull(views.controlTechniqueTestResults.organizationId)))
    .flatMap((row) => (row.organizationId === null ? [] : [row.organizationId])),

  /** The techniques a control has a stored result on, at any level and on either function. */
  findTechniqueTestResultTechniqueIds: async ({ db, views }, capabilityId: string): Promise<Array<string>> => (await db
    .selectDistinct({ mitreTechniqueId: views.controlTechniqueTestResults.mitreTechniqueId })
    .from(views.controlTechniqueTestResults)
    .where(eq(views.controlTechniqueTestResults.capabilityId, capabilityId)))
    .map((row) => row.mitreTechniqueId),

  /** One level's results of a control on one function, every technique at both grains; null is the tenant level. */
  findTechniqueTestResultsOfControl: async (
    { db, views },
    capabilityId: string,
    capabilityFunction: CapabilityFunction,
    organizationId: string | null,
  ) => {
    const results = views.controlTechniqueTestResults;
    return db
      .select({
        capabilityId: results.capabilityId,
        function: results.function,
        mitreTechniqueId: results.mitreTechniqueId,
        grain: results.grain,
        rate: results.rate,
        tests: results.tests,
        heldTests: results.heldTests,
        hostsTested: results.hostsTested,
        scopeHosts: results.scopeHosts,
      })
      .from(results)
      .where(and(
        eq(results.capabilityId, capabilityId),
        eq(results.function, capabilityFunction),
        organizationId === null ? isNull(results.organizationId) : eq(results.organizationId, organizationId),
      ));
  },

  /** One level's results on the given techniques, a sub-technique's own row included; null is the tenant level. */
  findTechniqueTestResultsOfTechniques: async ({ db, views }, mitreTechniqueIds: Array<string>, organizationId: string | null) => {
    if (mitreTechniqueIds.length === 0) {
      return [];
    }
    const results = views.controlTechniqueTestResults;
    return db
      .select({
        capabilityId: results.capabilityId,
        function: results.function,
        mitreTechniqueId: results.mitreTechniqueId,
        grain: results.grain,
        rate: results.rate,
        tests: results.tests,
        heldTests: results.heldTests,
        hostsTested: results.hostsTested,
        scopeHosts: results.scopeHosts,
      })
      .from(results)
      .where(and(
        inArray(results.mitreTechniqueId, mitreTechniqueIds),
        organizationId === null ? isNull(results.organizationId) : eq(results.organizationId, organizationId),
      ));
  },

  deleteTechniqueTestResults: async ({ db }, ids: Array<string>) => {
    for (let i = 0; i < ids.length; i += WRITE_CHUNK_SIZE) {
      await db.delete(controlTechniqueTestResults).where(inArray(controlTechniqueTestResults.id, ids.slice(i, i + WRITE_CHUNK_SIZE)));
    }
  },

  insertTechniqueTestResults: async ({ db }, rows: Array<typeof controlTechniqueTestResults.$inferInsert>) => {
    for (let i = 0; i < rows.length; i += WRITE_CHUNK_SIZE) {
      await db.insert(controlTechniqueTestResults).values(rows.slice(i, i + WRITE_CHUNK_SIZE));
    }
  },

  /** The given techniques and their sub-techniques, the results a cell on one of them can count. */
  findTechniquesWithSubTechniques: async ({ db, views }, techniqueIds: Array<string>) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    return (await db
      .select({ id: views.mitreTechniques.id })
      .from(views.mitreTechniques)
      .where(or(
        inArray(views.mitreTechniques.id, techniqueIds),
        inArray(views.mitreTechniques.parentTechniqueId, techniqueIds),
      )))
      .map((row) => row.id);
  },

  /** {@link findValidationEvidence} for one asset. */
  findAssetValidationEvidence: async ({ db, views }, estate: ResolvedEstate, supportingAssetId: string) => {
    const latestRun = storedFindingVerdict({ views });
    return db
      .select({ ...validationEvidenceColumns({ views }), runVerdict: latestRun.state, runAt: latestRun.observedAt })
      .from(views.assetEvidence)
      .innerJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
      .where(and(
        eq(views.assetEvidence.supportingAssetId, supportingAssetId),
        latestRun.spoken,
        isNotNull(views.assetEvidence.mitreTechniqueId),
        estateFilter({ db, views }, estate, views.assetEvidence.supportingAssetId),
      ));
  },

  findSupportingAsset: async ({ db, views }, supportingAssetId: string) => (await db
    .select({ id: views.supportingAssets.id, categoryId: views.supportingAssets.categoryId })
    .from(views.supportingAssets)
    .where(eq(views.supportingAssets.id, supportingAssetId))
    .limit(1)).at(0),

  isAssetInEstate: async ({ db, views }, supportingAssetId: string, estate: ResolvedEstate) => (await db
    .select({ id: views.supportingAssets.id })
    .from(views.supportingAssets)
    .where(and(
      eq(views.supportingAssets.id, supportingAssetId),
      estateFilter({ db, views }, estate, views.supportingAssets.id),
    ))
    .limit(1)).length > 0,

  /** What the asset's TTP tab adds to its category's techniques: a technique finding still applicable. */
  findApplicableFindingTechniqueIds: async ({ db, views }, supportingAssetId: string) =>
    (await db
      .selectDistinct({ mitreTechniqueId: views.assetEvidence.mitreTechniqueId })
      .from(views.assetEvidence)
      .where(and(
        eq(views.assetEvidence.supportingAssetId, supportingAssetId),
        isNotNull(views.assetEvidence.mitreTechniqueId),
        eq(views.assetEvidence.currentState, 'applicable'),
      )))
      .flatMap((row) => (row.mitreTechniqueId === null ? [] : [row.mitreTechniqueId])),

  findTechniques: async ({ db, views }, techniqueIds: Array<string>) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    return db
      .select({
        id: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        parentTechniqueId: views.mitreTechniques.parentTechniqueId,
      })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.id, techniqueIds));
  },

  findCapabilities: async ({ db, views }, capabilityIds: Array<string>) => {
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
   * Which controls each security-platform family implements, one row per pair.
   *
   * The junction is a platform reference table with no tenant column, so every tenant reads the
   * same mapping. It is what attributes a result: a platform's verdict speaks for the controls it
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

  /**
   * The catalogue coverage and the tenant's overlay on the given techniques, plus the external id
   * of each one.
   *
   * The caller passes the tested techniques AND their parents: a result on a sub-technique lands in
   * the parent's cell when only the parent is covered, so the parent's edges have to be read too.
   */
  findEdgesForTechniques: async ({ db, views }, techniqueIds: Array<string>) => {
    if (techniqueIds.length === 0) {
      return { catalogueEdges: [], overrides: [], techniques: [] };
    }
    const [catalogueEdges, overrides, techniques] = await Promise.all([
      db
        .select({
          capabilityId: views.controlCapabilityEdges.capabilityId,
          techniqueId: views.controlCapabilityEdges.mitreTechniqueId,
          function: views.controlCapabilityEdges.function,
        })
        .from(views.controlCapabilityEdges)
        .where(inArray(views.controlCapabilityEdges.mitreTechniqueId, techniqueIds)),
      db
        .select({
          capabilityId: views.controlCapabilityTechniqueOverrides.capabilityId,
          techniqueId: views.controlCapabilityTechniqueOverrides.mitreTechniqueId,
          kind: views.controlCapabilityTechniqueOverrides.kind,
          function: views.controlCapabilityTechniqueOverrides.function,
        })
        .from(views.controlCapabilityTechniqueOverrides)
        .where(inArray(views.controlCapabilityTechniqueOverrides.mitreTechniqueId, techniqueIds)),
      db
        .select({
          id: views.mitreTechniques.id,
          externalId: views.mitreTechniques.externalId,
        })
        .from(views.mitreTechniques)
        .where(inArray(views.mitreTechniques.id, techniqueIds)),
    ]);
    return { catalogueEdges, overrides, techniques };
  },

  findCreditedEdges: async ({ db, views }, capabilityIds: Array<string>) => {
    if (capabilityIds.length === 0) {
      return { catalogueEdges: [], overrides: [] };
    }
    const catalogueEdges = await db
      .select({
        capabilityId: views.controlCapabilityEdges.capabilityId,
        techniqueId: views.controlCapabilityEdges.mitreTechniqueId,
        function: views.controlCapabilityEdges.function,
      })
      .from(views.controlCapabilityEdges)
      .where(inArray(views.controlCapabilityEdges.capabilityId, capabilityIds));
    const overrides = await db
      .select({
        capabilityId: views.controlCapabilityTechniqueOverrides.capabilityId,
        techniqueId: views.controlCapabilityTechniqueOverrides.mitreTechniqueId,
        kind: views.controlCapabilityTechniqueOverrides.kind,
        function: views.controlCapabilityTechniqueOverrides.function,
      })
      .from(views.controlCapabilityTechniqueOverrides)
      .where(inArray(views.controlCapabilityTechniqueOverrides.capabilityId, capabilityIds));
    return { catalogueEdges, overrides };
  },

  findRiskScopeIds: async ({ db, views }) => (await db
    .select({ id: views.organizations.id })
    .from(views.organizations))
    .map((row) => row.id),

  /**
   * One level's lines of a control, both functions, from the line each function had in force at
   * `since`, so a window opening then starts on the value it held.
   */
  findProvenPostureHistory: async ({ db, views }, capabilityId: string, organizationId: string | null, since: Date) => {
    const history = views.controlProvenPostureHistory;
    const ofLevel = and(
      eq(history.capabilityId, capabilityId),
      organizationId === null ? isNull(history.organizationId) : eq(history.organizationId, organizationId),
    );
    const inForce = await db
      .select({ function: history.function, changedAt: max(history.changedAt) })
      .from(history)
      .where(and(ofLevel, lt(history.changedAt, since)))
      .groupBy(history.function);
    return db
      .select({
        function: history.function,
        at: history.changedAt,
        credited: history.credited,
        tested: history.tested,
        held: history.held,
      })
      .from(history)
      .where(and(ofLevel, or(
        gte(history.changedAt, since),
        ...inForce.flatMap((line) => (line.changedAt === null
          ? []
          : [and(eq(history.function, line.function), gte(history.changedAt, line.changedAt))])),
      )))
      .orderBy(asc(history.changedAt), asc(history.id));
  },

  findLatestProvenPostureLines: async ({ db, views }) => {
    const history = views.controlProvenPostureHistory;
    // eslint-disable-next-line app/no-distinct-on-subquery -- grows with the tenant's proven posture history, which the trim caps by age, not count
    return db
      .selectDistinctOn([history.capabilityId, history.organizationId, history.function], {
        capabilityId: history.capabilityId,
        organizationId: history.organizationId,
        function: history.function,
        credited: history.credited,
        tested: history.tested,
        held: history.held,
      })
      .from(history)
      .orderBy(history.capabilityId, history.organizationId, history.function, desc(history.changedAt), desc(history.id));
  },

  insertProvenPostureHistoryBatch: async ({ db }, rows: Array<typeof controlProvenPostureHistory.$inferInsert>) => {
    for (let i = 0; i < rows.length; i += WRITE_CHUNK_SIZE) {
      await db.insert(controlProvenPostureHistory).values(rows.slice(i, i + WRITE_CHUNK_SIZE));
    }
  },

  /** The line in force at the cut-off survives it, so a window's start is never empty. */
  trimProvenPostureHistory: async ({ db }, before: Date) => {
    await db.delete(controlProvenPostureHistory).where(and(
      lt(controlProvenPostureHistory.changedAt, before),
      exists(sql`(select 1 from ${controlProvenPostureHistory} newer
        where newer.tenant_id = ${controlProvenPostureHistory.tenantId}
          and newer.capability_id = ${controlProvenPostureHistory.capabilityId}
          and newer.organization_id is not distinct from ${controlProvenPostureHistory.organizationId}
          and newer.function = ${controlProvenPostureHistory.function}
          and newer.changed_at > ${controlProvenPostureHistory.changedAt}
          and newer.changed_at < ${before})`),
    ));
  },

  /**
   * The technique results {@link findValidationEvidence} selects, each with every test verdict logged
   * on it, in the order the live read breaks them.
   */
  findValidationEvidenceTimeline: async ({ db, views }, estate: ResolvedEstate) => {
    const rows = await db
      .select({ id: views.assetEvidence.id, ...validationEvidenceColumns({ views }) })
      .from(views.assetEvidence)
      .innerJoin(views.mitreTechniques, eq(views.assetEvidence.mitreTechniqueId, views.mitreTechniques.id))
      .where(and(
        isNotNull(views.assetEvidence.mitreTechniqueId),
        estateFilter({ db, views }, estate, views.assetEvidence.supportingAssetId),
      ));
    const verdicts = await db
      .select({
        assetEvidenceId: views.assetEvidenceVerdicts.assetEvidenceId,
        id: views.assetEvidenceVerdicts.id,
        state: verdictState(views.assetEvidenceVerdicts.isExposed),
        observedAt: views.assetEvidenceVerdicts.observedAt,
        recordedAt: views.assetEvidenceVerdicts.recordedAt,
      })
      .from(views.assetEvidenceVerdicts)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.id, views.assetEvidenceVerdicts.assetEvidenceId))
      .where(and(
        isNotNull(views.assetEvidence.mitreTechniqueId),
        estateFilter({ db, views }, estate, views.assetEvidence.supportingAssetId),
      ))
      .orderBy(
        views.assetEvidenceVerdicts.assetEvidenceId,
        asc(views.assetEvidenceVerdicts.recordedAt),
        asc(views.assetEvidenceVerdicts.observedAt),
        asc(views.assetEvidenceVerdicts.id),
      );

    const verdictsByEvidence = new Map<string, Array<TimelineVerdict>>();
    for (const { assetEvidenceId, ...verdict } of verdicts) {
      const list = verdictsByEvidence.get(assetEvidenceId) ?? [];
      list.push(verdict);
      verdictsByEvidence.set(assetEvidenceId, list);
    }
    return rows.map(({ id, ...row }) => ({ ...row, verdicts: verdictsByEvidence.get(id) ?? [] }));
  },
});
