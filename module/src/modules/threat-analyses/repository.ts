import { and, asc, desc, eq, exists, getTableColumns, gt, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { PgTransaction, unionAll } from 'drizzle-orm/pg-core';
import type { ActivityAttributionEdge } from './activity-lineage';
import type { ThreatEntityType } from './entity-types';
import type { ThreatListSortKey } from './list-sort';
import type { ThreatSourceKind } from './source-kinds';
import type { RepositoryContext } from '../../registry';
import { foldedLike, orderByFolded } from '../../db/fold-text';
import { orderNullsLast } from '../../db/order-nulls-last';
import { diffRows } from '../../db/row-diff';
import { updatedAtOnDataChange } from '../../db/write-guards';
import { inUuids } from '../../db/uuid-array';
import { defineRepository } from '../../registry';
import { techniqueSuccessorsOf } from '../mitre-attack/technique-successors';
import { ACTIVITY_ANCHOR_CHUNK_SIZE, DEFAULT_RELATION_CONFIDENCE, OUTCOME_SCORE_UPSERT_CHUNK_SIZE } from './constants';
import { OUTCOME_WEIGHT_THRESHOLD } from './outcome-counter/outcome-weight';
import {
  threatActivityAnchors,
  threatAnalyses,
  threatAnalysisAliases,
  threatAnalysisAttributions,
  threatAnalysisCounts,
  threatAnalysisCves,
  threatAnalysisGoals,
  threatAnalysisLocations,
  threatAnalysisOutcomeProbabilities,
  threatAnalysisRoles,
  threatAnalysisSecondaryMotivations,
  threatAnalysisSectors,
  threatAnalysisTechniques,
  threatAnalysisThreatActorTypes,
  threatOutcomeCounterVersions,
  threatOutcomeScores,
} from './schema';

// The ten claim tables differ in their value columns only: `id` and `analysisId` are common, and a
// claim's rows are handled as opaque records, so one table stands for all of them inside the helper.
type ClaimTable = typeof threatAnalysisAliases;

/**
 * Makes an analysis's rows of one claim table equal to `wanted`, writing only the difference. A
 * claim is its whole tuple of values, `id` and `analysisId` apart, so a row whose value changes is
 * one deletion and one insertion, and a claim stated again keeps its row. Returns whether it wrote.
 */
const replaceClaims = async <Table extends PgTable & { id: AnyPgColumn, analysisId: AnyPgColumn }>(
  db: RepositoryContext['db'],
  analysisId: string,
  claims: {
    table: Table,
    /** The table's secured view, which `ClaimTable` stands for like the table. */
    view: object,
    wanted: Array<Table['$inferInsert']>,
    /** A value the database drops on its unique index is skipped instead of aborting the threat. */
    skipConflicts: boolean,
  },
): Promise<boolean> => {
  const { wanted, skipConflicts } = claims;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see ClaimTable
  const table = claims.table as unknown as ClaimTable;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see ClaimTable
  const view = claims.view as RepositoryContext['views']['threatAnalysisAliases'];
  const valueKeys = Object.entries(getTableColumns(table))
    .filter(([key, column]) => key !== 'id' && key !== 'analysisId' && column.generated === undefined)
    .map(([key]) => key);
  const keyOf = (row: Record<string, unknown>) => JSON.stringify(valueKeys.map((key) => row[key] ?? null));
  const held: Array<Record<string, unknown>> = await db.select().from(view).where(eq(view.analysisId, analysisId));
  const { stale, missing } = diffRows(held, wanted, keyOf, keyOf);
  if (stale.length > 0) {
    await db.delete(table).where(inArray(table.id, stale.map((row) => String(row.id))));
  }
  let inserted = 0;
  if (missing.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see ClaimTable
    const insert = db.insert(table).values(missing as Array<ClaimTable['$inferInsert']>);
    // A skipped conflict is not a write: counting the attempt would report every replay as a change.
    inserted = (await (skipConflicts ? insert.onConflictDoNothing() : insert).returning()).length;
  }
  return stale.length + inserted > 0;
};

// Two percentages closer than this are the same one: a recompute rebuilds them from float arithmetic.
const PROBABILITY_TOLERANCE = 1e-9;

// Case-insensitive equality match on a name column. STIX and OpenCRQ countries/sectors both
// come from the OpenCTI dataset, so names should align exactly bar casing differences.
// `lower(...) = lower(...)` (not ILIKE): the STIX-provided name is untrusted input and ILIKE
// treats its right-hand side as a pattern, so a name containing `%`/`_` would match incorrectly.
const caseInsensitiveNameMatch = (first: AnyPgColumn, second: AnyPgColumn) => sql`lower(${first}) = lower(${second})`;

// What the four claim collections share, so one projection reads them all while each keeps the
// column types of its own table.
interface ActivityClaimView {
  analysisId: AnyPgColumn,
  stixRelationId: AnyPgColumn,
  relCreated: AnyPgColumn,
  relStartTime: AnyPgColumn,
  relStopTime: AnyPgColumn,
  relConfidence: AnyPgColumn,
  producerStixId: AnyPgColumn,
}

// The only place a confidence comparison is expressed. Every claim read passes through it, so a
// claim below the gate is stored but never read anywhere — counts, anchors, admission or detail.
export const gatedClaims = (claim: { relConfidence: AnyPgColumn }, gate: number) =>
  sql`coalesce(${claim.relConfidence}, ${DEFAULT_RELATION_CONFIDENCE}) >= ${gate}`;

// One bound array rather than an `in` list, so the statement text and its parameter count do not
// vary with the batch: the recompute's observed read set is matched on statement shape.
const analysisIdIn = (column: AnyPgColumn, analysisIds: Array<string>) =>
  sql`${column} = any(${sql.param(analysisIds)}::uuid[])`;

/**
 * A `timestamptz` at the precision a JavaScript `Date` carries it: Postgres stores microseconds and
 * the driver's decoder truncates them, the same way `date_trunc` does here. Anything read out and
 * written back has lost them, so a stored timestamp compared against the raw column it came from is
 * never equal to it again — an analysis whose `updated_at` came from the column default would read
 * as stale on every run of the sweep, for good.
 */
const millisecondsOf = (column: AnyPgColumn) => sql`date_trunc('milliseconds', ${column})`;

/**
 * One row per STIX relationship: a join can match one claim twice, which carries no new evidence and
 * would be rendered as two claims.
 */
const dedupeClaimsByRelation = <T extends { stixRelationId: string }>(rows: Array<T>): Array<T> => {
  const byRelation = new Map<string, T>();
  for (const row of rows) {
    if (!byRelation.has(row.stixRelationId)) {
      byRelation.set(row.stixRelationId, row);
    }
  }
  return [...byRelation.values()];
};

const analysisCveClaims = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, params: { id: string, gate: number }) => db
  .select({
    id: views.threatAnalysisCves.id,
    stixId: views.threatAnalysisCves.stixId,
    stixRelationId: views.threatAnalysisCves.stixRelationId,
    cveId: views.threatAnalysisCves.cveId,
    relCreated: views.threatAnalysisCves.relCreated,
    relStartTime: views.threatAnalysisCves.relStartTime,
    relStopTime: views.threatAnalysisCves.relStopTime,
    relModified: views.threatAnalysisCves.relModified,
    relConfidence: views.threatAnalysisCves.relConfidence,
  })
  .from(views.threatAnalysisCves)
  .where(and(
    eq(views.threatAnalysisCves.analysisId, params.id),
    gatedClaims(views.threatAnalysisCves, params.gate),
  ));

// Correlated targeting predicates, shared by the display query (`findRelevantForScenario`) and the
// mixture's targeting read (`findTargetingMatches`) so the two surfaces can never disagree
// on what "this organization is targeted" means. An empty profile matches nothing rather than
// everything: with no country (or no sector) on the organization there is no targeting evidence.
const targetingCountryMatch = (
  db: RepositoryContext['db'],
  views: RepositoryContext['views'],
  countryIds: Array<string>,
  gate: number,
) =>
  (countryIds.length > 0
    ? exists(
      db.select({ one: sql`1` })
        .from(views.threatAnalysisLocations)
        .innerJoin(views.countries, caseInsensitiveNameMatch(views.countries.name, views.threatAnalysisLocations.country))
        .where(and(
          eq(views.threatAnalysisLocations.analysisId, views.threatAnalyses.id),
          inArray(views.countries.id, countryIds),
          gatedClaims(views.threatAnalysisLocations, gate),
        )),
    )
    : sql<boolean>`false`);

const targetingSectorMatch = (
  db: RepositoryContext['db'],
  views: RepositoryContext['views'],
  sectorIds: Array<string>,
  gate: number,
) =>
  (sectorIds.length > 0
    ? exists(
      db.select({ one: sql`1` })
        .from(views.threatAnalysisSectors)
        .innerJoin(views.sectors, caseInsensitiveNameMatch(views.sectors.name, views.threatAnalysisSectors.name))
        .where(and(
          eq(views.threatAnalysisSectors.analysisId, views.threatAnalyses.id),
          inArray(views.sectors.id, sectorIds),
          gatedClaims(views.threatAnalysisSectors, gate),
        )),
    )
    : sql<boolean>`false`);

export const threatAnalysesRepository = defineRepository({
  // Existence within the caller's tenant, and where the actor came from: the secured views filter a
  // foreign analysis out rather than erroring, so an unchecked identifier reads as an actor with no
  // evidence at all.
  findAnalysisOrigin: async ({ db, views }, analysisId: string) =>
    (await db
      .select({
        id: views.threatAnalyses.id,
        kind: views.threatAnalyses.kind,
        stixId: views.threatAnalyses.stixId,
        entityType: views.threatAnalyses.entityType,
        outcomeEvidenceSufficient: views.threatAnalyses.outcomeEvidenceSufficient,
        outcomeModelVersion: views.threatAnalyses.outcomeModelVersion,
        outcomeJudgedAt: views.threatAnalyses.outcomeJudgedAt,
      })
      .from(views.threatAnalyses)
      .where(eq(views.threatAnalyses.id, analysisId))
      .limit(1)).at(0),

  // The actor the next ingestion of that upstream object updates in place: one STIX id is one actor
  // within a tenant, whatever name or MITRE group id it shares with another.
  findAnalysisByStixId: async ({ db, views }, tenantId: string, stixId: string) =>
    (await db
      .select()
      .from(views.threatAnalyses)
      .where(and(
        eq(views.threatAnalyses.tenantId, tenantId),
        eq(views.threatAnalyses.stixId, stixId),
      ))
      .limit(1)).at(0),

  /**
   * The analysis each upstream STIX id names, which is the order a caller updating several actors
   * of a tenant in one transaction must take them in. Scoped by kind like the delete below: one
   * feed's id never resolves to another feed's actor.
   */
  findAnalysisIdsByStixIds: async ({ db, views }, tenantId: string, kind: ThreatSourceKind, stixIds: Array<string>) => {
    if (stixIds.length === 0) {
      return [];
    }
    return db
      .select({ stixId: views.threatAnalyses.stixId, analysisId: views.threatAnalyses.id })
      .from(views.threatAnalyses)
      .where(and(
        eq(views.threatAnalyses.tenantId, tenantId),
        eq(views.threatAnalyses.kind, kind),
        inArray(views.threatAnalyses.stixId, stixIds),
      ));
  },

  /**
   * The claims, the aliases, the activity anchors and the stored outcome probabilities all cascade
   * from the analysis row.
   *
   * The kind is part of the delete rather than of a select feeding it: Postgres rechecks it against
   * the row it is about to remove, so an actor another feed requalified since the caller decided to
   * retract it is left alone.
   */
  deleteAnalysesByStixIds: async (
    { db }, tenantId: string, kind: ThreatSourceKind, stixIds: Array<string>,
  ): Promise<Array<string>> => {
    if (stixIds.length === 0) {
      return [];
    }
    const deleted = await db.delete(threatAnalyses)
      .where(and(
        eq(threatAnalyses.tenantId, tenantId),
        eq(threatAnalyses.kind, kind),
        inArray(threatAnalyses.stixId, stixIds),
      ))
      .returning();
    return deleted.map((row) => row.id);
  },

  deleteAnalysesByIds: async ({ db }, kind: ThreatSourceKind, ids: Array<string>): Promise<Array<string>> => {
    if (ids.length === 0) {
      return [];
    }
    const deleted = await db.delete(threatAnalyses)
      .where(and(eq(threatAnalyses.kind, kind), inArray(threatAnalyses.id, ids)))
      .returning();
    return deleted.map((row) => row.id);
  },

  insertAnalysis: async ({ db }, values: typeof threatAnalyses.$inferInsert) =>
    (await db.insert(threatAnalyses).values(values).returning())[0],

  // `tenantId` is intentionally excluded from the update shape — it must never change once a
  // row is inserted, to avoid accidentally moving an analysis to a different tenant.
  updateAnalysis: async ({ db }, id: string, values: Omit<Partial<typeof threatAnalyses.$inferInsert>, 'tenantId'>) =>
    (await db.update(threatAnalyses).set(values).where(eq(threatAnalyses.id, id)).returning())[0],

  /**
   * Writes an actor's re-ingestion: the stated attributes, and `updated_at` only when one of them
   * changes, since it is the watermark the threat recomputes read. `last_ingested_at` moves
   * every time and rings nothing. Both dates are the ingestion's own instant, a millisecond `Date`:
   * the activity fold guards on `updated_at` being equal to the `Date` it read.
   */
  restateAnalysis: async (
    { db },
    id: string,
    stated: Omit<typeof threatAnalyses.$inferInsert, 'id' | 'tenantId' | 'firstIngestedAt' | 'lastIngestedAt'> & { lastIngestedAt: Date },
  ) =>
    (await db.update(threatAnalyses)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: CASE expressions carry no column type
      .set({ ...stated, updatedAt: updatedAtOnDataChange(threatAnalyses, stated, stated.lastIngestedAt) as unknown as Date })
      .where(eq(threatAnalyses.id, id))
      .returning())[0],

  /**
   * Makes everything the actor's upstream object claims equal to `children`: a relationship dropped
   * upstream is deleted and a new one inserted, and a claim stated again is not written. Returns
   * whether any claim was written.
   */
  replaceAnalysisChildren: async ({ db, views }, analysisId: string, children: {
    aliases: Array<typeof threatAnalysisAliases.$inferInsert>,
    secondaryMotivations: Array<typeof threatAnalysisSecondaryMotivations.$inferInsert>,
    goals: Array<typeof threatAnalysisGoals.$inferInsert>,
    threatActorTypes: Array<typeof threatAnalysisThreatActorTypes.$inferInsert>,
    roles: Array<typeof threatAnalysisRoles.$inferInsert>,
    attributions: Array<typeof threatAnalysisAttributions.$inferInsert>,
    locations: Array<typeof threatAnalysisLocations.$inferInsert>,
    sectors: Array<typeof threatAnalysisSectors.$inferInsert>,
    cves: Array<typeof threatAnalysisCves.$inferInsert>,
    techniques: Array<typeof threatAnalysisTechniques.$inferInsert>,
  }) => {
    // Sequential on purpose: this runs inside `atomic()`, so `db` is bound to a single
    // transactional pg connection — concurrent queries on one connection aren't real
    // parallelism (pg just queues them) and `pg` is deprecating/removing that queuing
    // behavior in v9. Keep these awaited one at a time.
    //
    // The five text sets take `onConflictDoNothing`: the service dedups them before they get here,
    // and it keeps a disagreement between JS `toLowerCase()` and the deployed Postgres `lower()`
    // collation (STIX values are untrusted third-party strings) a dropped duplicate instead of a
    // 23505 that aborts the whole threat.
    const wrote = [
      await replaceClaims(db, analysisId, { table: threatAnalysisAliases, view: views.threatAnalysisAliases, wanted: children.aliases, skipConflicts: true }),
      await replaceClaims(db, analysisId, { table: threatAnalysisSecondaryMotivations, view: views.threatAnalysisSecondaryMotivations, wanted: children.secondaryMotivations, skipConflicts: true }),
      await replaceClaims(db, analysisId, { table: threatAnalysisGoals, view: views.threatAnalysisGoals, wanted: children.goals, skipConflicts: true }),
      await replaceClaims(db, analysisId, { table: threatAnalysisThreatActorTypes, view: views.threatAnalysisThreatActorTypes, wanted: children.threatActorTypes, skipConflicts: true }),
      await replaceClaims(db, analysisId, { table: threatAnalysisRoles, view: views.threatAnalysisRoles, wanted: children.roles, skipConflicts: true }),
      await replaceClaims(db, analysisId, { table: threatAnalysisAttributions, view: views.threatAnalysisAttributions, wanted: children.attributions, skipConflicts: false }),
      await replaceClaims(db, analysisId, { table: threatAnalysisLocations, view: views.threatAnalysisLocations, wanted: children.locations, skipConflicts: false }),
      await replaceClaims(db, analysisId, { table: threatAnalysisSectors, view: views.threatAnalysisSectors, wanted: children.sectors, skipConflicts: false }),
      await replaceClaims(db, analysisId, { table: threatAnalysisCves, view: views.threatAnalysisCves, wanted: children.cves, skipConflicts: false }),
      await replaceClaims(db, analysisId, { table: threatAnalysisTechniques, view: views.threatAnalysisTechniques, wanted: children.techniques, skipConflicts: false }),
    ];
    return wrote.some(Boolean);
  },

  findAnalysesTargetingCves: async ({ db, views }, params: { cveIds: Array<string>, gate: number }) => {
    if (params.cveIds.length === 0) {
      return [];
    }
    return db
      .select({
        analysisId: views.threatAnalysisCves.analysisId,
        cveId: views.threatAnalysisCves.cveId,
      })
      .from(views.threatAnalysisCves)
      // `views.threatAnalyses` is already tenant-scoped — this join both restricts the
      // result to the current tenant and guards against orphaned rows.
      .innerJoin(views.threatAnalyses, eq(views.threatAnalyses.id, views.threatAnalysisCves.analysisId))
      .where(and(
        inArray(sql`upper(trim(${views.threatAnalysisCves.cveId}))`, params.cveIds.map((cveId) => cveId.trim().toUpperCase())),
        or(
          isNull(views.threatAnalysisCves.relStopTime),
          sql`${views.threatAnalysisCves.relStopTime} > now()`,
        ),
        gatedClaims(views.threatAnalysisCves, params.gate),
      ));
  },

  /**
   * Every flaw the tenant's threats cite, each with the analysis that cites it so the caller can
   * weigh the citation by that actor's activity.
   *
   * Closed relationships are excluded on the same rule as `findAnalysesTargetingCves`: a citation
   * that has stopped no longer says the actor uses it.
   */
  findOngoingCveCitations: async ({ db, views }, { gate }: { gate: number }) => db
    .select({
      analysisId: views.threatAnalysisCves.analysisId,
      cveId: views.threatAnalysisCves.cveId,
    })
    .from(views.threatAnalysisCves)
    .innerJoin(views.threatAnalyses, eq(views.threatAnalyses.id, views.threatAnalysisCves.analysisId))
    .where(and(
      or(
        isNull(views.threatAnalysisCves.relStopTime),
        sql`${views.threatAnalysisCves.relStopTime} > now()`,
      ),
      gatedClaims(views.threatAnalysisCves, gate),
    )),

  findAnalysesByCveId: async (context, params: { cveId: string, gate: number }) => {
    const { db, views } = context;
    // Counted as played, so the count matches the rows of the actor's TTP tab. Per actor rather than
    // joined into the grouped rows, where the join with the successors makes the planner scan every
    // claim of the tenant.
    const played = techniqueSuccessorsOf(context, views.threatAnalysisTechniques.mitreExternalId);
    const techniqueCount = db.select({ count: sql<number>`count(distinct ${played.playedAs})::int` })
      .from(views.threatAnalysisTechniques)
      .leftJoin(played.successors, played.on)
      .where(and(
        eq(views.threatAnalysisTechniques.analysisId, views.threatAnalyses.id),
        gatedClaims(views.threatAnalysisTechniques, params.gate),
      ));
    return db.select({
      id: views.threatAnalyses.id,
      stixId: views.threatAnalyses.stixId,
      name: views.threatAnalyses.name,
      entityType: views.threatAnalyses.entityType,
      mitreGroupId: views.threatAnalyses.mitreGroupId,
      stixCreated: views.threatAnalyses.stixCreated,
      updatedAt: views.threatAnalyses.updatedAt,
      lastObservedAt: views.threatAnalyses.lastObservedAt,
      lastAuthoredAt: views.threatAnalyses.lastAuthoredAt,
      activityScore: views.threatAnalyses.activityScore,
      cveCount: sql<number>`count(distinct ${views.threatAnalysisCves.cveId})::int`,
      techniqueCount: sql<number>`(${techniqueCount})`,
      // Two OpenCTI instances describing the same flaw carry two vulnerability ids; any of them
      // resolves on the tenant's own platform, so the aggregate picks one rather than fanning out.
      vulnerabilityStixId: sql<string | null>`max(${views.threatAnalysisCves.stixId}) filter (where ${views.threatAnalysisCves.cveId} = ${params.cveId})`,
    })
      .from(views.threatAnalyses)
      .leftJoin(views.threatAnalysisCves, and(
        eq(views.threatAnalysisCves.analysisId, views.threatAnalyses.id),
        gatedClaims(views.threatAnalysisCves, params.gate),
      ))
      .where(exists(
        db.select({ one: sql`1` })
          .from(views.threatAnalysisCves)
          .where(and(
            eq(views.threatAnalysisCves.analysisId, views.threatAnalyses.id),
            eq(views.threatAnalysisCves.cveId, params.cveId),
            gatedClaims(views.threatAnalysisCves, params.gate),
          )),
      ))
      .groupBy(
        views.threatAnalyses.id,
        views.threatAnalyses.stixId,
        views.threatAnalyses.name,
        views.threatAnalyses.entityType,
        views.threatAnalyses.mitreGroupId,
        views.threatAnalyses.stixCreated,
        views.threatAnalyses.updatedAt,
        views.threatAnalyses.lastObservedAt,
        views.threatAnalyses.lastAuthoredAt,
        views.threatAnalyses.activityScore,
      )
      .orderBy(desc(views.threatAnalyses.updatedAt));
  },

  /** The CVE claims the detail reads, with the analysis kind that decides whether their relationships link to OpenCTI. */
  findAnalysisCves: async (context, params: { id: string, gate: number }) => {
    const { db, views } = context;
    const [analysis] = await db
      .select({ kind: views.threatAnalyses.kind })
      .from(views.threatAnalyses)
      .where(eq(views.threatAnalyses.id, params.id))
      .limit(1);
    if (analysis === undefined) {
      return undefined;
    }
    return { kind: analysis.kind, cves: await analysisCveClaims(context, params) };
  },

  /** The catalogue techniques an analysis plays, as its detail's techniques match them; none for one the tenant cannot read. */
  findMatchedTechniqueIds: async (context, params: { id: string, gate: number }): Promise<Array<string>> => {
    const { db, views } = context;
    const played = techniqueSuccessorsOf(context, views.threatAnalysisTechniques.mitreExternalId);
    const rows = await db
      .selectDistinct({ mitreTechniqueId: views.mitreTechniques.id })
      .from(views.threatAnalysisTechniques)
      .innerJoin(views.threatAnalyses, eq(views.threatAnalyses.id, views.threatAnalysisTechniques.analysisId))
      .leftJoin(played.successors, played.on)
      .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.externalId, played.playedAs))
      .where(and(
        eq(views.threatAnalysisTechniques.analysisId, params.id),
        gatedClaims(views.threatAnalysisTechniques, params.gate),
      ));
    return rows.map((row) => row.mitreTechniqueId);
  },

  findAnalysisDetail: async (context, params: { id: string, gate: number }) => {
    const { db, views } = context;
    const { id, gate } = params;
    const played = techniqueSuccessorsOf(context, views.threatAnalysisTechniques.mitreExternalId);
    const analysis = (await db
      .select()
      .from(views.threatAnalyses)
      .where(eq(views.threatAnalyses.id, id))
      .limit(1)).at(0);

    if (!analysis) {
      return undefined;
    }

    const [lastObservedVia, locations, sectors, cves, techniques, secondaryMotivations, goals, threatActorTypes, roles] = await Promise.all([
      analysis.lastObservedViaAnalysisId === null
        ? undefined
        : db
          .select({
            id: views.threatAnalyses.id,
            name: views.threatAnalyses.name,
          })
          .from(views.threatAnalyses)
          .where(and(
            eq(views.threatAnalyses.id, analysis.lastObservedViaAnalysisId),
            eq(views.threatAnalyses.tenantId, analysis.tenantId),
          ))
          .limit(1)
          .then((rows) => rows.at(0)),

      db.select({
        id: views.threatAnalysisLocations.id,
        stixId: views.threatAnalysisLocations.stixId,
        stixRelationId: views.threatAnalysisLocations.stixRelationId,
        name: views.threatAnalysisLocations.name,
        country: views.threatAnalysisLocations.country,
        relCreated: views.threatAnalysisLocations.relCreated,
        relStartTime: views.threatAnalysisLocations.relStartTime,
        relStopTime: views.threatAnalysisLocations.relStopTime,
        relModified: views.threatAnalysisLocations.relModified,
        relConfidence: views.threatAnalysisLocations.relConfidence,
        countryId: views.countries.id,
        countryIsoAlpha2: views.countries.isoAlpha2,
        // Does this recognized country match at least one of the tenant's organizations?
        // Drives the "This concerns you" highlighting on the Overview tab.
        matchesOrganization: exists(
          db.select({ one: sql`1` })
            .from(views.organizations)
            .where(eq(views.organizations.countryId, views.countries.id)),
        ),
      })
        .from(views.threatAnalysisLocations)
        .leftJoin(views.countries, caseInsensitiveNameMatch(views.countries.name, views.threatAnalysisLocations.country))
        .where(and(
          eq(views.threatAnalysisLocations.analysisId, id),
          gatedClaims(views.threatAnalysisLocations, gate),
        )),

      db.select({
        id: views.threatAnalysisSectors.id,
        stixId: views.threatAnalysisSectors.stixId,
        stixRelationId: views.threatAnalysisSectors.stixRelationId,
        name: views.threatAnalysisSectors.name,
        relCreated: views.threatAnalysisSectors.relCreated,
        relStartTime: views.threatAnalysisSectors.relStartTime,
        relStopTime: views.threatAnalysisSectors.relStopTime,
        relModified: views.threatAnalysisSectors.relModified,
        relConfidence: views.threatAnalysisSectors.relConfidence,
        sectorId: views.sectors.id,
        matchesOrganization: exists(
          db.select({ one: sql`1` })
            .from(views.organizations)
            .where(eq(views.organizations.sectorId, views.sectors.id)),
        ),
      })
        .from(views.threatAnalysisSectors)
        .leftJoin(views.sectors, caseInsensitiveNameMatch(views.sectors.name, views.threatAnalysisSectors.name))
        .where(and(
          eq(views.threatAnalysisSectors.analysisId, id),
          gatedClaims(views.threatAnalysisSectors, gate),
        )),

      analysisCveClaims(context, params),

      db.select({
        id: views.threatAnalysisTechniques.id,
        stixId: views.threatAnalysisTechniques.stixId,
        stixRelationId: views.threatAnalysisTechniques.stixRelationId,
        name: played.playedNameOf(views.threatAnalysisTechniques.name),
        mitreExternalId: played.playedAs,
        citedExternalId: views.threatAnalysisTechniques.mitreExternalId,
        relCreated: views.threatAnalysisTechniques.relCreated,
        relStartTime: views.threatAnalysisTechniques.relStartTime,
        relStopTime: views.threatAnalysisTechniques.relStopTime,
        relModified: views.threatAnalysisTechniques.relModified,
        relConfidence: views.threatAnalysisTechniques.relConfidence,
        mitreTechniqueId: views.mitreTechniques.id,
        mitreTechniqueUrl: views.mitreTechniques.url,
      })
        .from(views.threatAnalysisTechniques)
        .leftJoin(played.successors, played.on)
        .leftJoin(views.mitreTechniques, eq(views.mitreTechniques.externalId, played.playedAs))
        .where(and(
          eq(views.threatAnalysisTechniques.analysisId, id),
          gatedClaims(views.threatAnalysisTechniques, gate),
        )),

      // Never gated: declared intent carries no confidence column at all. Ordered on purpose, so two
      // requests list the values in the same order.
      db.select({ id: views.threatAnalysisSecondaryMotivations.id, value: views.threatAnalysisSecondaryMotivations.value })
        .from(views.threatAnalysisSecondaryMotivations)
        .where(eq(views.threatAnalysisSecondaryMotivations.analysisId, id))
        .orderBy(asc(views.threatAnalysisSecondaryMotivations.id)),

      db.select({ id: views.threatAnalysisGoals.id, value: views.threatAnalysisGoals.value })
        .from(views.threatAnalysisGoals)
        .where(eq(views.threatAnalysisGoals.analysisId, id))
        .orderBy(asc(views.threatAnalysisGoals.id)),

      db.select({ value: views.threatAnalysisThreatActorTypes.value })
        .from(views.threatAnalysisThreatActorTypes)
        .where(eq(views.threatAnalysisThreatActorTypes.analysisId, id))
        .orderBy(asc(views.threatAnalysisThreatActorTypes.id)),

      db.select({ value: views.threatAnalysisRoles.value })
        .from(views.threatAnalysisRoles)
        .where(eq(views.threatAnalysisRoles.analysisId, id))
        .orderBy(asc(views.threatAnalysisRoles.id)),
    ]);

    return {
      analysis,
      lastObservedVia: lastObservedVia ?? null,
      locations,
      sectors,
      cves,
      techniques,
      secondaryMotivations,
      goals,
      threatActorTypes: threatActorTypes.map((row) => row.value),
      roles: roles.map((row) => row.value),
    };
  },

  findAttributionsForAnalysis: async ({ db, views }, params: { tenantId: string, analysisId: string, stixId: string, gate: number }) => {
    const threat = {
      id: views.threatAnalyses.id,
      name: views.threatAnalyses.name,
      entityType: views.threatAnalyses.entityType,
    };
    const [attributedTo, attributedFrom] = await Promise.all([
      db.select(threat)
        .from(views.threatAnalysisAttributions)
        .innerJoin(views.threatAnalyses, and(
          eq(views.threatAnalyses.stixId, views.threatAnalysisAttributions.targetStixId),
          eq(views.threatAnalyses.tenantId, params.tenantId),
        ))
        .where(and(
          eq(views.threatAnalysisAttributions.analysisId, params.analysisId),
          gatedClaims(views.threatAnalysisAttributions, params.gate),
        )),
      db.select(threat)
        .from(views.threatAnalysisAttributions)
        .innerJoin(views.threatAnalyses, eq(views.threatAnalyses.id, views.threatAnalysisAttributions.analysisId))
        .where(and(
          eq(views.threatAnalysisAttributions.targetStixId, params.stixId),
          eq(views.threatAnalyses.tenantId, params.tenantId),
          gatedClaims(views.threatAnalysisAttributions, params.gate),
        )),
    ]);
    return { attributedTo, attributedFrom };
  },

  findTacticsForTechniques: async ({ db, views }, mitreTechniqueIds: Array<string>) => {
    if (mitreTechniqueIds.length === 0) {
      return [];
    }
    return db.select({
      techniqueId: views.mitreTechniqueTactics.techniqueId,
      tacticId: views.mitreTactics.id,
      externalId: views.mitreTactics.externalId,
      name: views.mitreTactics.name,
    })
      .from(views.mitreTechniqueTactics)
      .innerJoin(views.mitreTactics, eq(views.mitreTactics.id, views.mitreTechniqueTactics.tacticId))
      .where(inArray(views.mitreTechniqueTactics.techniqueId, mitreTechniqueIds));
  },

  // Raw targeting windows (start/stop) for every threat known to target the given CVE —
  // the service turns each window into "started"/"stopped" activity events for the CVE detail
  // page's Threats activity heatmap (same shape as the asset evidence activity heatmap).
  // Distinct: several sources reporting the same targeting window would otherwise stack identical
  // events on the same day of the heatmap.
  findCveTargetingWindowsByCveId: async ({ db, views }, params: { cveId: string, gate: number }) => db
    .selectDistinct({
      analysisId: views.threatAnalysisCves.analysisId,
      relStartTime: views.threatAnalysisCves.relStartTime,
      relStopTime: views.threatAnalysisCves.relStopTime,
      relCreated: views.threatAnalysisCves.relCreated,
    })
    .from(views.threatAnalysisCves)
    // `views.threatAnalyses` is already tenant-scoped — this join both restricts the
    // result to the current tenant and guards against orphaned rows.
    .innerJoin(views.threatAnalyses, eq(views.threatAnalyses.id, views.threatAnalysisCves.analysisId))
    .where(and(
      eq(views.threatAnalysisCves.cveId, params.cveId),
      gatedClaims(views.threatAnalysisCves, params.gate),
    )),

  /**
   * One page of the threat-center list, every derived value and both filters resolved in SQL:
   * `cveCount`/`techniqueCount`, `activityScore` and `outcomeScore` alike are read
   * from columns their recompute jobs materialize — `threatAnalysisCounts` and
   * `threatOutcomeScores` joined in 1:1 on `analysisId`, never aggregated here — the outcome
   * score either narrowed to `outcomeId` (an INNER JOIN drops the zero-scoring analyses the
   * projection holds no row for) or read from the winner the projection already marked.
   */
  findScoredAnalysesPage: async ({ db, views }, params: {
    outcomeId?: string,
    search?: string,
    entityType?: ThreatEntityType,
    kind?: ThreatSourceKind,
    sortBy: ThreatListSortKey,
    sortDesc: boolean,
    limit: number,
    offset: number,
  }) => {
    const searchFilter = and(
      params.search ? foldedLike(views.threatAnalyses.nameFolded, params.search, 'prefix') : undefined,
      params.entityType ? eq(views.threatAnalyses.entityType, params.entityType) : undefined,
      params.kind ? eq(views.threatAnalyses.kind, params.kind) : undefined,
    );

    const selectBase = {
      id: views.threatAnalyses.id,
      stixId: views.threatAnalyses.stixId,
      name: views.threatAnalyses.name,
      entityType: views.threatAnalyses.entityType,
      kind: views.threatAnalyses.kind,
      mitreGroupId: views.threatAnalyses.mitreGroupId,
      stixCreated: views.threatAnalyses.stixCreated,
      updatedAt: views.threatAnalyses.updatedAt,
      lastObservedAt: views.threatAnalyses.lastObservedAt,
      lastAuthoredAt: views.threatAnalyses.lastAuthoredAt,
      activityScore: views.threatAnalyses.activityScore,
      // Raw, not `coalesce`d: a missing row means the recompute has never covered this analysis
      // yet, and the list surfaces that as `null` rather than a misleading zero.
      cveCount: views.threatAnalysisCounts.cveCount,
      techniqueCount: views.threatAnalysisCounts.techniqueCount,
    };

    const sortColumns = {
      name: views.threatAnalyses.name,
      mitreGroupId: views.threatAnalyses.mitreGroupId,
      stixCreated: views.threatAnalyses.stixCreated,
      updatedAt: views.threatAnalyses.updatedAt,
      cveCount: sql`coalesce(${views.threatAnalysisCounts.cveCount}, 0)`,
      techniqueCount: sql`coalesce(${views.threatAnalysisCounts.techniqueCount}, 0)`,
      activityScore: views.threatAnalyses.activityScore,
      lastObservedAt: views.threatAnalyses.lastObservedAt,
      // Not `coalesce`d: `score` is `NOT NULL` and the outcome-filtered branch reaches this column
      // through an INNER JOIN, so the row is never absent there either. Coalescing it defeats the
      // index this sort is meant to use — `nulls last` already puts an unscored row last, which is
      // the same place a coalesced zero would sort it.
      outcomeScore: views.threatOutcomeScores.score,
    };
    const sortColumn = sortColumns[params.sortBy];
    const sortOrder = params.sortBy === 'name' ? orderByFolded(views.threatAnalyses.nameFolded, views.threatAnalyses.name, params.sortDesc) : [orderNullsLast(sortColumn, params.sortDesc)];
    // The unfiltered branch reaches `score` through a LEFT JOIN, which leaves it empty on an unscored analysis.
    const outerSortOrder = params.sortBy === 'outcomeScore' ? [orderNullsLast(sql`${sortColumn}`, params.sortDesc)] : sortOrder;

    const selectScored = {
      ...selectBase,
      topOutcomeName: views.attackOutcomes.name,
      // The counts row, not the score row, is what tells apart "computed, scores nothing" (a real
      // `0`) from "never computed" (`null`): an analysis can legitimately clear the recompute with
      // no scoring outcome, but it never clears it without a counts row.
      topOutcomeScore: sql<number | null>`case when ${views.threatAnalysisCounts.analysisId} is null then null else coalesce(${views.threatOutcomeScores.score}, 0) end`,
    };

    if (params.outcomeId) {
      return db.select(selectScored)
        .from(views.threatAnalyses)
        .innerJoin(views.threatOutcomeScores, and(
          eq(views.threatOutcomeScores.analysisId, views.threatAnalyses.id),
          eq(views.threatOutcomeScores.attackOutcomeId, params.outcomeId),
        ))
        .innerJoin(views.attackOutcomes, eq(views.attackOutcomes.id, views.threatOutcomeScores.attackOutcomeId))
        .leftJoin(views.threatAnalysisCounts, eq(views.threatAnalysisCounts.analysisId, views.threatAnalyses.id))
        .where(searchFilter)
        .orderBy(...sortOrder, asc(views.threatAnalyses.id))
        .limit(params.limit)
        .offset(params.offset);
    }

    return db.select(selectScored)
      .from(views.threatAnalyses)
      .leftJoin(views.threatOutcomeScores, and(
        eq(views.threatOutcomeScores.analysisId, views.threatAnalyses.id),
        eq(views.threatOutcomeScores.isTop, true),
      ))
      .leftJoin(views.attackOutcomes, eq(views.attackOutcomes.id, views.threatOutcomeScores.attackOutcomeId))
      .leftJoin(views.threatAnalysisCounts, eq(views.threatAnalysisCounts.analysisId, views.threatAnalyses.id))
      .where(searchFilter)
      .orderBy(...outerSortOrder, asc(views.threatAnalyses.id))
      .limit(params.limit)
      .offset(params.offset);
  },

  // Sibling count of `findScoredAnalysesPage`, same admission rule: unfiltered, every analysis
  // matching the search; outcome-filtered, only the ones the sweep's projection admits.
  countScoredAnalyses: async ({ db, views }, params: { outcomeId?: string, search?: string, entityType?: ThreatEntityType, kind?: ThreatSourceKind }) => {
    const searchFilter = and(
      params.search ? foldedLike(views.threatAnalyses.nameFolded, params.search, 'prefix') : undefined,
      params.entityType ? eq(views.threatAnalyses.entityType, params.entityType) : undefined,
      params.kind ? eq(views.threatAnalyses.kind, params.kind) : undefined,
    );
    if (!params.outcomeId) {
      const [row] = await db.select({ count: sql<number>`count(*)::int` })
        .from(views.threatAnalyses)
        .where(searchFilter);
      return row?.count ?? 0;
    }
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(views.threatAnalyses)
      .innerJoin(views.threatOutcomeScores, and(
        eq(views.threatOutcomeScores.analysisId, views.threatAnalyses.id),
        eq(views.threatOutcomeScores.attackOutcomeId, params.outcomeId),
      ))
      .where(searchFilter);
    return row?.count ?? 0;
  },

  // Analyses the recompute has never covered yet, reported next to the list rather than hidden
  // from it: unlike the findings list, this one is a browser of the analyses themselves, not only
  // a ranking of their scores, so a not-yet-computed row still belongs on the page.
  countPendingAnalyses: async ({ db, views }, params: { search?: string, entityType?: ThreatEntityType, kind?: ThreatSourceKind }) => {
    const searchFilter = and(
      params.search ? foldedLike(views.threatAnalyses.nameFolded, params.search, 'prefix') : undefined,
      params.entityType ? eq(views.threatAnalyses.entityType, params.entityType) : undefined,
      params.kind ? eq(views.threatAnalyses.kind, params.kind) : undefined,
    );
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(views.threatAnalyses)
      .leftJoin(views.threatAnalysisCounts, eq(views.threatAnalysisCounts.analysisId, views.threatAnalyses.id))
      .where(and(searchFilter, isNull(views.threatAnalysisCounts.analysisId)));
    return row?.count ?? 0;
  },

  /**
   * Refreshes the planner statistics the claim reads depend on for a good join plan, right after
   * `ingestBundle` has written a batch of claims. Postgres's own autovacuum eventually does this on its own, but the window between a large bulk ingestion and
   * the next autoanalyze has been observed to leave the planner with stale, order-of-magnitude-off
   * row estimates for these tables. `ANALYZE` alone (no `VACUUM`) is sample-based and cheap relative
   * to that risk, and unlike `VACUUM` it is safe to run outside `atomic()` without holding a table
   * lock that would block concurrent ingestion.
   *
   * Never propagates: a statistics refresh must not fail the ingestion that just committed — the
   * connector would replay the flush over rows already written.
   *
   * Skipped inside an ambient transaction (the platform seed builds its services on its own): a JS
   * `catch` cannot undo a Postgres transaction abort, so an error here would surface as
   * `current transaction is aborted` on whatever the seed runs next, and even on success the lock
   * would outlive the ~440ms it takes standalone, held until that transaction commits. The seed's
   * data is small and disposable, so the stale-statistics window this guards against never applies
   * to it.
   */
  analyzeClaimTablesAfterIngestion: async ({ rawDb }) => {
    // eslint-disable-next-line no-restricted-syntax -- deliberate planner-statistics refresh, not a tenant-scoped read/write: ANALYZE has no tenant dimension to bypass, it just needs a real DB handle
    const connection = rawDb();
    if (connection instanceof PgTransaction) {
      return;
    }
    try {
      await connection.execute(sql`analyze threat_analyses, threat_analysis_techniques, threat_analysis_cves, threat_analysis_outcome_probabilities`);
    } catch {
      // Best-effort: see the docstring above.
    }
  },

  /**
   * A digest of what the list fold reads outside the analyses: each attack outcome's id and name,
   * which break a tie between an analysis's top outcomes, and each revoked technique's successor,
   * which the technique counts are taken through since a claim counts as its successor plays it.
   *
   * One digest for the whole tenant, compared like the confidence gate rather than per analysis —
   * a catalogue move is a tenant-wide event and sweeps the tenant whole.
   */
  findCatalogueFingerprint: async ({ db, views }) => {
    const read = unionAll(
      db.select({ pair: sql<string>`${views.attackOutcomes.id}::text || ':' || ${views.attackOutcomes.name}`.as('pair') })
        .from(views.attackOutcomes),
      db.select({
        pair: sql<string>`${views.mitreTechniques.externalId} || '>' || ${views.mitreTechniques.replacedByTechniqueId}::text`.as('pair'),
      })
        .from(views.mitreTechniques)
        .where(and(eq(views.mitreTechniques.revoked, true), isNotNull(views.mitreTechniques.replacedByTechniqueId))),
    ).as('read');

    // Ordered inside the aggregate: `string_agg` has no order of its own, and an unordered digest
    // would differ between two reads of an unchanged catalogue and sweep the tenant for nothing.
    const [row] = await db.select({
      fingerprint: sql<string>`coalesce(md5(string_agg(${read.pair}, '|' order by ${read.pair})), '')`,
    }).from(read);
    return row?.fingerprint ?? '';
  },

  /**
   * The analyses the outcome-score recompute still owes a fold, in a stable order so one page of
   * ids follows the last. Analyses carrying no claim are included, not skipped: a row whose last
   * claim was just removed owes the deletion of the scores it used to have.
   *
   * Stale is the whole of it, and it is one predicate rather than a watermark read into JS: an
   * analysis with no projected row yet, one whose projection was folded from a different
   * `updated_at`, a different gate, a different projection version, or a different catalogue. The
   * four cover every input the fold reads — everything ingestion writes, the stored percentages
   * included, moves `updated_at`, the tenant setting moves the gate, a deploy moves
   * `LIST_PROJECTION_VERSION`, and the boot seeder moves the catalogue digest — so a run with none of
   * them moved is a run with nothing to write.
   *
   * The `updated_at` and the digest travel back with the ids, and the sweep stamps these exact values
   * rather than re-reading them per batch: an ingestion committing between this statement and the fold is seen
   * by the fold (the transaction is `read committed`) but leaves the stamp differing from the
   * analysis's own, so the next run folds it again instead of the change being lost.
   */
  findStaleAnalysisIdBatch: async ({ db, views }, params: {
    afterAnalysisId: string | null, limit: number, gate: number, projectionVersion: string, catalogueFingerprint: string,
  }) => (
    await db.select({
      id: views.threatAnalyses.id,
      sourceUpdatedAt: views.threatAnalyses.updatedAt,
    })
      .from(views.threatAnalyses)
      .leftJoin(views.threatAnalysisCounts, eq(views.threatAnalysisCounts.analysisId, views.threatAnalyses.id))
      .where(and(
        params.afterAnalysisId ? gt(views.threatAnalyses.id, params.afterAnalysisId) : undefined,
        or(
          isNull(views.threatAnalysisCounts.analysisId),
          ne(views.threatAnalysisCounts.sourceUpdatedAt, millisecondsOf(views.threatAnalyses.updatedAt)),
          ne(views.threatAnalysisCounts.confidenceGate, params.gate),
          ne(views.threatAnalysisCounts.projectionVersion, params.projectionVersion),
          ne(views.threatAnalysisCounts.catalogueFingerprint, params.catalogueFingerprint),
        ),
      ))
      .orderBy(asc(views.threatAnalyses.id))
      .limit(params.limit)
  ),

  /**
   * The two claim counts for one batch of analyses, driven from the analyses themselves so an
   * actor whose claims are all gated out still answers, with zeros. Each count is pre-aggregated in
   * its own subquery and joined 1:1, so the two sibling one-to-many joins never cross-multiply.
   */
  findComputedAnalysisCounts: async (context, params: { gate: number, analysisIds: Array<string> }) => {
    const { db, views } = context;
    const cveCounts = db.select({
      analysisId: views.threatAnalysisCves.analysisId,
      cveCount: sql<number>`count(distinct ${views.threatAnalysisCves.cveId})::int`.as('cve_count'),
    })
      .from(views.threatAnalysisCves)
      .where(and(
        gatedClaims(views.threatAnalysisCves, params.gate),
        analysisIdIn(views.threatAnalysisCves.analysisId, params.analysisIds),
      ))
      .groupBy(views.threatAnalysisCves.analysisId)
      .as('cve_counts');

    // Counted as played, so the count matches the rows of the actor's TTP tab.
    const played = techniqueSuccessorsOf(context, views.threatAnalysisTechniques.mitreExternalId);
    const techniqueCounts = db.select({
      analysisId: views.threatAnalysisTechniques.analysisId,
      techniqueCount: sql<number>`count(distinct ${played.playedAs})::int`.as('technique_count'),
    })
      .from(views.threatAnalysisTechniques)
      .leftJoin(played.successors, played.on)
      .where(and(
        gatedClaims(views.threatAnalysisTechniques, params.gate),
        analysisIdIn(views.threatAnalysisTechniques.analysisId, params.analysisIds),
      ))
      .groupBy(views.threatAnalysisTechniques.analysisId)
      .as('technique_counts');

    return db.select({
      analysisId: views.threatAnalyses.id,
      cveCount: sql<number>`coalesce(${cveCounts.cveCount}, 0)`,
      techniqueCount: sql<number>`coalesce(${techniqueCounts.techniqueCount}, 0)`,
    })
      .from(views.threatAnalyses)
      .leftJoin(cveCounts, eq(cveCounts.analysisId, views.threatAnalyses.id))
      .leftJoin(techniqueCounts, eq(techniqueCounts.analysisId, views.threatAnalyses.id))
      .where(analysisIdIn(views.threatAnalyses.id, params.analysisIds));
  },

  /**
   * `onConflictDoOverwrite`, not `onConflictDoUpdate` with `excluded.*`: the sweep computes every
   * column of the row from scratch, and only the certified form proves the write reads none of the
   * stored one. Certifying it needs `tenantId` — the tenant policy's overwrite key — inside the
   * conflict target, which is why the table's primary key leads with it.
   */
  upsertAnalysisCountBatch: async ({ db }, rows: Array<typeof threatAnalysisCounts.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(threatAnalysisCounts).values(rows).onConflictDoOverwrite({
      target: [threatAnalysisCounts.tenantId, threatAnalysisCounts.analysisId],
      columns: ['cveCount', 'techniqueCount', 'sourceUpdatedAt', 'confidenceGate', 'projectionVersion', 'catalogueFingerprint'],
    });
  },

  /**
   * Guarded like `upsertAnalysisCountBatch`, and for the same reason. Chunked, unlike it: a batch
   * holds one row per (analysis, scoring outcome) rather than one per analysis, so its row count
   * scales with the outcome catalogue's size, not only with the sweep's own batch size.
   */
  upsertOutcomeScoreBatch: async ({ db }, rows: Array<typeof threatOutcomeScores.$inferInsert>) => {
    for (let start = 0; start < rows.length; start += OUTCOME_SCORE_UPSERT_CHUNK_SIZE) {
      await db.insert(threatOutcomeScores).values(rows.slice(start, start + OUTCOME_SCORE_UPSERT_CHUNK_SIZE)).onConflictDoOverwrite({
        target: [threatOutcomeScores.tenantId, threatOutcomeScores.analysisId, threatOutcomeScores.attackOutcomeId],
        columns: ['score', 'isTop'],
      });
    }
  },

  /**
   * Drops what the batch's analyses used to score and no longer do, which is how an outcome that
   * fell to zero leaves the filtered list. The kept pairs travel as two parallel arrays so the
   * statement's shape does not vary with the batch; empty ones clear every score in the batch,
   * which is what an analysis whose last claim was removed owes.
   */
  deleteOutcomeScoresOutsideBatch: async (
    { db },
    params: { analysisIds: Array<string>, keptAnalysisIds: Array<string>, keptAttackOutcomeIds: Array<string> },
  ) => {
    await db.delete(threatOutcomeScores).where(and(
      analysisIdIn(threatOutcomeScores.analysisId, params.analysisIds),
      sql`(${threatOutcomeScores.analysisId}, ${threatOutcomeScores.attackOutcomeId}) not in (
        select * from unnest(${sql.param(params.keptAnalysisIds)}::uuid[], ${sql.param(params.keptAttackOutcomeIds)}::uuid[])
      )`,
    ));
  },

  hasAnyAnalysis: async ({ db, views }) =>
    (await db.select({ one: sql`1` }).from(views.threatAnalyses).limit(1)).length > 0,

  analysisExists: async ({ db, views }, id: string) =>
    (await db.select({ one: sql`1` }).from(views.threatAnalyses).where(eq(views.threatAnalyses.id, id)).limit(1)).length > 0,

  countCatalogByType: async ({ db, views }, params: { activeSince: Date }) =>
    db.select({
      entityType: views.threatAnalyses.entityType,
      total: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${gt(views.threatAnalyses.lastObservedAt, params.activeSince)}))::int`,
    })
      .from(views.threatAnalyses)
      .groupBy(views.threatAnalyses.entityType),

  countCitedCves: async ({ db, views }) => {
    const [cves] = await db.select({ total: sql<number>`count(distinct ${views.threatAnalysisCves.cveId})::int` })
      .from(views.threatAnalysisCves);
    return cves?.total ?? 0;
  },

  countCatalogExposure: async ({ db, views }, params: { strongScore: number, gate: number }) => {
    const [[strong], [cves]] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` })
        .from(views.threatOutcomeScores)
        .where(and(eq(views.threatOutcomeScores.isTop, true), gte(views.threatOutcomeScores.score, params.strongScore))),
      db.select({
        targeted: sql<number>`count(distinct ${views.threatAnalysisCves.cveId})::int`,
        onEstate: sql<number>`(count(distinct ${views.threatAnalysisCves.cveId}) filter (where ${isNotNull(views.uniqueFindingScores.id)}))::int`,
      })
        .from(views.threatAnalysisCves)
        .leftJoin(views.cve, eq(views.cve.cveId, views.threatAnalysisCves.cveId))
        .leftJoin(views.uniqueFindingScores, and(
          eq(views.uniqueFindingScores.cveId, views.cve.id),
          isNull(views.uniqueFindingScores.organizationId),
        ))
        .where(gatedClaims(views.threatAnalysisCves, params.gate)),
    ]);
    return {
      strongOutcomeMatches: strong?.total ?? 0,
      targetedCves: cves?.targeted ?? 0,
      targetedCvesOnEstate: cves?.onEstate ?? 0,
    };
  },

  // Every alias of the given analyses. Alias equality is one of the three identity signals the
  // attacker-mixture clustering folds duplicated actors on.
  findAliasesForAnalyses: async ({ db, views }, analysisIds: Array<string>) => {
    if (analysisIds.length === 0) {
      return [];
    }
    return db.select({
      analysisId: views.threatAnalysisAliases.analysisId,
      alias: views.threatAnalysisAliases.alias,
    })
      .from(views.threatAnalysisAliases)
      .where(inArray(views.threatAnalysisAliases.analysisId, analysisIds));
  },

  // Whole ingested repertoire of the given analyses: this is `playbook(g)` and, at the same time,
  // the link universe the per-technique weight is computed over. The two must come from the same
  // universe, so they are deliberately served by a single query. A revoked technique reads as its
  // successor, as the attack run reads it.
  findTechniqueLinksForAnalyses: async (context, params: { analysisIds: Array<string>, gate: number }) => {
    if (params.analysisIds.length === 0) {
      return [];
    }
    const { db, views } = context;
    const { successors, on, playedAs } = techniqueSuccessorsOf(context, views.threatAnalysisTechniques.mitreExternalId);
    return db.selectDistinct({
      analysisId: views.threatAnalysisTechniques.analysisId,
      mitreExternalId: playedAs,
    })
      .from(views.threatAnalysisTechniques)
      .leftJoin(successors, on)
      .where(and(
        inArray(views.threatAnalysisTechniques.analysisId, params.analysisIds),
        gatedClaims(views.threatAnalysisTechniques, params.gate),
      ));
  },

  // Outcome list for the scenario-independent per-outcome scores. Read straight from the secured
  // view rather than through `attackOutcomesService`: attack-outcomes now depends on this module
  // for the technique weighting, and a service-level cycle would be unresolvable.
  // `tenantId` lets `resolveCatalogAttackOutcomeRowIds` derive each row's catalogue identifier
  // forward — the row's own id is not it.
  findAttackOutcomeNames: async ({ db, views }) =>
    db.select({ id: views.attackOutcomes.id, name: views.attackOutcomes.name, tenantId: views.attackOutcomes.tenantId })
      .from(views.attackOutcomes)
      .orderBy(...orderByFolded(views.attackOutcomes.nameFolded, views.attackOutcomes.name, false)),

  // Narrow counterpart of `findAttackOutcomeNames` for a caller that already knows which outcome
  // ids it needs (the single-outcome proof/scenario path, and the mixture's several ids): just
  // enough to resolve each row's catalogue identifier and name it, with no join.
  findAttackOutcomesByIds: async ({ db, views }, attackOutcomeIds: Array<string>) => {
    if (attackOutcomeIds.length === 0) {
      return [];
    }
    return db.select({ id: views.attackOutcomes.id, name: views.attackOutcomes.name, tenantId: views.attackOutcomes.tenantId })
      .from(views.attackOutcomes)
      .where(inArray(views.attackOutcomes.id, attackOutcomeIds));
  },

  /**
   * The percentages stored for the tenant's analyses of these STIX ids, the counter's or judged, one row
   * per (analysis, attack outcome), whether or not the analysis has minimum evidence: a child reads its
   * parents' percentages as the counter expects. A STIX id with no analysis, or an analysis
   * never scored, is simply absent.
   */
  findOutcomeProbabilitiesByStixIds: async ({ db, views }, tenantId: string, stixIds: Array<string>) => {
    if (stixIds.length === 0) {
      return [];
    }
    return db.select({
      stixId: views.threatAnalyses.stixId,
      attackOutcomeId: views.threatAnalysisOutcomeProbabilities.attackOutcomeId,
      probability: views.threatAnalysisOutcomeProbabilities.probability,
      evidenceSufficient: views.threatAnalyses.outcomeEvidenceSufficient,
    })
      .from(views.threatAnalysisOutcomeProbabilities)
      .innerJoin(views.threatAnalyses, and(
        eq(views.threatAnalyses.id, views.threatAnalysisOutcomeProbabilities.analysisId),
        eq(views.threatAnalyses.tenantId, views.threatAnalysisOutcomeProbabilities.tenantId),
      ))
      .where(and(
        eq(views.threatAnalysisOutcomeProbabilities.tenantId, tenantId),
        inArray(views.threatAnalyses.stixId, stixIds),
      ));
  },

  /**
   * Replaces one analysis's stored percentages, the counter's or judged, and returns the largest move:
   * `Infinity` when a row is added or dropped, 0 when every percentage is within
   * `PROBABILITY_TOLERANCE` of the stored one, in which case nothing is written unless a row changes
   * between judged and filled by the counter.
   */
  replaceOutcomeProbabilitiesForAnalysis: async (
    { db, views }, tenantId: string, analysisId: string, rows: Array<{ attackOutcomeId: string, probability: number, judged: boolean }>,
  ): Promise<number> => {
    const held = await db.select({
      attackOutcomeId: views.threatAnalysisOutcomeProbabilities.attackOutcomeId,
      probability: views.threatAnalysisOutcomeProbabilities.probability,
      judged: views.threatAnalysisOutcomeProbabilities.judged,
    }).from(views.threatAnalysisOutcomeProbabilities).where(eq(views.threatAnalysisOutcomeProbabilities.analysisId, analysisId));
    const heldById = new Map(held.map((row) => [row.attackOutcomeId, row]));
    const largestMove = held.length !== rows.length
      ? Infinity
      : Math.max(0, ...rows.map((row) => {
        const before = heldById.get(row.attackOutcomeId);
        return before === undefined ? Infinity : Math.abs(before.probability - row.probability);
      }));
    const provenanceMoved = rows.some((row) => heldById.get(row.attackOutcomeId)?.judged !== row.judged);
    if (largestMove <= PROBABILITY_TOLERANCE && !provenanceMoved) {
      return 0;
    }
    const key = (row: { attackOutcomeId: string, probability: number, judged: boolean }): string =>
      `${row.attackOutcomeId}:${row.probability}:${row.judged}`;
    const { stale, missing } = diffRows(held, rows, key, key);
    if (stale.length > 0) {
      await db.delete(threatAnalysisOutcomeProbabilities).where(and(
        eq(threatAnalysisOutcomeProbabilities.analysisId, analysisId),
        inArray(threatAnalysisOutcomeProbabilities.attackOutcomeId, stale.map((row) => row.attackOutcomeId)),
      ));
    }
    if (missing.length > 0) {
      await db.insert(threatAnalysisOutcomeProbabilities).values(missing.map((row) => ({ tenantId, analysisId, ...row })));
    }
    return largestMove;
  },

  // What the model-version backfill compares against `OUTCOME_COUNTER_VERSION`; the STIX id is what
  // finds an analysis's inputs again, in the mirror or in an uploaded bundle.
  findDispatchedOutcomeCounterVersion: async ({ db, views }): Promise<string | null> => (
    await db.select({ version: views.threatOutcomeCounterVersions.dispatchedVersion })
      .from(views.threatOutcomeCounterVersions)
  ).at(0)?.version ?? null,

  upsertDispatchedOutcomeCounterVersion: async ({ db }, tenantId: string, version: string) => {
    await db.insert(threatOutcomeCounterVersions).values([{ tenantId, dispatchedVersion: version }]).onConflictDoOverwrite({
      target: [threatOutcomeCounterVersions.tenantId],
      columns: ['dispatchedVersion'],
    });
  },

  findOutcomeModelWatermarks: async ({ db, views }) => db.select({
    id: views.threatAnalyses.id,
    stixId: views.threatAnalyses.stixId,
    outcomeModelVersion: views.threatAnalyses.outcomeModelVersion,
  }).from(views.threatAnalyses)
    .where(ne(views.threatAnalyses.kind, 'default-threats'))
    .orderBy(views.threatAnalyses.id),

  /**
   * The threats that lead to the given outcomes: one row per (threat, outcome) whose stored
   * probability is above `OUTCOME_WEIGHT_THRESHOLD` on a record with enough evidence, which is exactly
   * where `effectiveOutcomeWeight` is positive. The filter is SQL on
   * `threat_analysis_outcome_probabilities_tenant_outcome_probability_idx`, so no claim, motivation or
   * other analysis of the tenant is read.
   *
   * `tenantId` is set only when the caller runs outside a tenant-scoped origin (the CRQ job and the
   * platform seed run as `system`, where the secured views apply no tenant filter at all): without it
   * the index would not be led by its tenant column, and every tenant's threats would be mixed.
   * `analysisIds` narrows to the threats a caller already holds (the CVE path).
   */
  findSelectedThreats: async ({ db, views }, params: {
    attackOutcomeIds: Array<string>,
    tenantId?: string,
    analysisIds?: Array<string>,
  }) => {
    if (params.attackOutcomeIds.length === 0 || params.analysisIds?.length === 0) {
      return [];
    }
    return db.select({
      id: views.threatAnalyses.id,
      name: views.threatAnalyses.name,
      entityType: views.threatAnalyses.entityType,
      mitreGroupId: views.threatAnalyses.mitreGroupId,
      stixId: views.threatAnalyses.stixId,
      resourceLevel: views.threatAnalyses.resourceLevel,
      primaryMotivation: views.threatAnalyses.primaryMotivation,
      lastObservedAt: views.threatAnalyses.lastObservedAt,
      lastAuthoredAt: views.threatAnalyses.lastAuthoredAt,
      activityScore: views.threatAnalyses.activityScore,
      attackOutcomeId: views.threatAnalysisOutcomeProbabilities.attackOutcomeId,
      probability: views.threatAnalysisOutcomeProbabilities.probability,
    })
      .from(views.threatAnalysisOutcomeProbabilities)
      .innerJoin(views.threatAnalyses, and(
        eq(views.threatAnalyses.id, views.threatAnalysisOutcomeProbabilities.analysisId),
        eq(views.threatAnalyses.tenantId, views.threatAnalysisOutcomeProbabilities.tenantId),
      ))
      .where(and(
        params.tenantId ? eq(views.threatAnalysisOutcomeProbabilities.tenantId, params.tenantId) : undefined,
        inUuids(views.threatAnalysisOutcomeProbabilities.attackOutcomeId, params.attackOutcomeIds),
        gt(views.threatAnalysisOutcomeProbabilities.probability, OUTCOME_WEIGHT_THRESHOLD),
        eq(views.threatAnalyses.outcomeEvidenceSufficient, true),
        params.analysisIds ? inUuids(views.threatAnalysisOutcomeProbabilities.analysisId, params.analysisIds) : undefined,
      ))
      .orderBy(asc(views.threatAnalyses.id), asc(views.threatAnalysisOutcomeProbabilities.attackOutcomeId));
  },

  /**
   * Whether each of the given threats targets one of the profile's countries or sectors, through
   * the gated claims. Join-free and read for the selected threats alone.
   */
  findTargetingMatches: async ({ db, views }, params: {
    analysisIds: Array<string>,
    countryIds: Array<string>,
    sectorIds: Array<string>,
    gate: number,
  }) => {
    if (params.analysisIds.length === 0) {
      return [];
    }
    return db.select({
      id: views.threatAnalyses.id,
      countryMatch: targetingCountryMatch(db, views, params.countryIds, params.gate),
      sectorMatch: targetingSectorMatch(db, views, params.sectorIds, params.gate),
    })
      .from(views.threatAnalyses)
      .where(inUuids(views.threatAnalyses.id, params.analysisIds));
  },

  /**
   * The percentages stored for a batch of analyses, flat: one row per (analysis, outcome),
   * and none for an analysis without minimum evidence, whose percentages say nothing a reader may show.
   */
  findSufficientOutcomeProbabilities: async ({ db, views }, analysisIds: Array<string>) =>
    db.select({
      analysisId: views.threatAnalysisOutcomeProbabilities.analysisId,
      attackOutcomeId: views.threatAnalysisOutcomeProbabilities.attackOutcomeId,
      probability: views.threatAnalysisOutcomeProbabilities.probability,
      judged: views.threatAnalysisOutcomeProbabilities.judged,
    })
      .from(views.threatAnalysisOutcomeProbabilities)
      .innerJoin(views.threatAnalyses, and(
        eq(views.threatAnalyses.id, views.threatAnalysisOutcomeProbabilities.analysisId),
        eq(views.threatAnalyses.tenantId, views.threatAnalysisOutcomeProbabilities.tenantId),
      ))
      .where(and(
        analysisIdIn(views.threatAnalysisOutcomeProbabilities.analysisId, analysisIds),
        eq(views.threatAnalyses.outcomeEvidenceSufficient, true),
      )),

  findRelevantForScenario: async ({ db, views }, params: {
    countryIds: Array<string>,
    sectorIds: Array<string>,
    gate: number,
    analysisIds?: Array<string>,
  }) => {
    const countryMatch = targetingCountryMatch(db, views, params.countryIds, params.gate);
    const sectorMatch = targetingSectorMatch(db, views, params.sectorIds, params.gate);

    return db.select({
      id: views.threatAnalyses.id,
      // The key the other XTM products hold the same threat under, for the row's pivots.
      stixId: views.threatAnalyses.stixId,
      name: views.threatAnalyses.name,
      entityType: views.threatAnalyses.entityType,
      mitreGroupId: views.threatAnalyses.mitreGroupId,
      resourceLevel: views.threatAnalyses.resourceLevel,
      lastObservedAt: views.threatAnalyses.lastObservedAt,
      lastAuthoredAt: views.threatAnalyses.lastAuthoredAt,
      activityScore: views.threatAnalyses.activityScore,
      countryMatch,
      sectorMatch,
      // Distinct raw targeted names (locations/sectors), independent of country/sector matching —
      // gives the CISO the full targeting context, not just the matched entry.
      // Regions (no resolved `country` field, e.g. "Western Europe") are excluded from the
      // countries list — they aren't actual countries and just clutter the column.
      countries: sql<Array<string>>`coalesce(array_agg(distinct ${views.threatAnalysisLocations.name}) filter (where ${views.threatAnalysisLocations.country} is not null), array[]::text[])`,
      sectors: sql<Array<string>>`array_remove(array_agg(distinct ${views.threatAnalysisSectors.name}), null)`,
    })
      .from(views.threatAnalyses)
      .leftJoin(views.threatAnalysisLocations, and(
        eq(views.threatAnalysisLocations.analysisId, views.threatAnalyses.id),
        gatedClaims(views.threatAnalysisLocations, params.gate),
      ))
      .leftJoin(views.threatAnalysisSectors, and(
        eq(views.threatAnalysisSectors.analysisId, views.threatAnalyses.id),
        gatedClaims(views.threatAnalysisSectors, params.gate),
      ))
      .where(params.analysisIds ? inUuids(views.threatAnalyses.id, params.analysisIds) : undefined)
      // No relevance filter here: the caller names the selected threats and weighs these match flags.
      // Cartesian expansion from the 2 one-to-many joins is safe here: every aggregate uses
      // DISTINCT, so duplicated rows collapse back down (same pattern as `findAnalyses`).
      .groupBy(
        views.threatAnalyses.id,
        views.threatAnalyses.stixId,
        views.threatAnalyses.name,
        views.threatAnalyses.entityType,
        views.threatAnalyses.mitreGroupId,
        views.threatAnalyses.resourceLevel,
        views.threatAnalyses.lastObservedAt,
        views.threatAnalyses.lastAuthoredAt,
        views.threatAnalyses.activityScore,
      );
  },

  /**
   * Every targeting claim behind one actor's relevance, for the proof panel: the location claims
   * matching the organization's countries and the sector claims matching its sectors. One analysis
   * at a time — one row per claim multiplies the claim count behind every row, which is exactly what
   * the list payload must not carry.
   *
   * Every field is returned exactly as stored, producer and inferred marker included: the detail
   * projections strip those, and stripping them here would ship an empty proof.
   */
  findRelevanceProofClaims: async (context, params: {
    analysisId: string,
    countryIds: Array<string>,
    sectorIds: Array<string>,
    gate: number,
  }) => {
    const { db, views } = context;
    const [locations, sectors] = await Promise.all([
      params.countryIds.length === 0 ? [] : db.select({
        stixRelationId: views.threatAnalysisLocations.stixRelationId,
        producerStixId: views.threatAnalysisLocations.producerStixId,
        producerName: views.threatAnalysisLocations.producerName,
        isInferred: views.threatAnalysisLocations.isInferred,
        relConfidence: views.threatAnalysisLocations.relConfidence,
        relCreated: views.threatAnalysisLocations.relCreated,
        relStartTime: views.threatAnalysisLocations.relStartTime,
        relStopTime: views.threatAnalysisLocations.relStopTime,
        relModified: views.threatAnalysisLocations.relModified,
        name: views.threatAnalysisLocations.name,
      })
        .from(views.threatAnalysisLocations)
        .innerJoin(views.countries, caseInsensitiveNameMatch(views.countries.name, views.threatAnalysisLocations.country))
        .where(and(
          eq(views.threatAnalysisLocations.analysisId, params.analysisId),
          inArray(views.countries.id, params.countryIds),
          gatedClaims(views.threatAnalysisLocations, params.gate),
        )),

      params.sectorIds.length === 0 ? [] : db.select({
        stixRelationId: views.threatAnalysisSectors.stixRelationId,
        producerStixId: views.threatAnalysisSectors.producerStixId,
        producerName: views.threatAnalysisSectors.producerName,
        isInferred: views.threatAnalysisSectors.isInferred,
        relConfidence: views.threatAnalysisSectors.relConfidence,
        relCreated: views.threatAnalysisSectors.relCreated,
        relStartTime: views.threatAnalysisSectors.relStartTime,
        relStopTime: views.threatAnalysisSectors.relStopTime,
        relModified: views.threatAnalysisSectors.relModified,
        name: views.threatAnalysisSectors.name,
      })
        .from(views.threatAnalysisSectors)
        .innerJoin(views.sectors, caseInsensitiveNameMatch(views.sectors.name, views.threatAnalysisSectors.name))
        .where(and(
          eq(views.threatAnalysisSectors.analysisId, params.analysisId),
          inArray(views.sectors.id, params.sectorIds),
          gatedClaims(views.threatAnalysisSectors, params.gate),
        )),
    ]);

    return {
      locations: dedupeClaimsByRelation(locations),
      sectors: dedupeClaimsByRelation(sectors),
    };
  },

  // An actor no producer ever dated (a NULL `last_observed_at`) is not one that stopped operating,
  // so it stays in: excluding it would drop the actors nobody reports on.
  findActiveAnalysisIds: async ({ db, views }, params: { activeSince: Date }) => (await db
    .select({ id: views.threatAnalyses.id })
    .from(views.threatAnalyses)
    .where(or(
      isNull(views.threatAnalyses.lastObservedAt),
      gt(views.threatAnalyses.lastObservedAt, params.activeSince),
    ))).map((row) => row.id),

  /** The actors of these STIX ids, for the cross-product lookup; the caller bounds the list. */
  findByStixIds: async ({ db, views }, stixIds: Array<string>) => {
    if (stixIds.length === 0) {
      return [];
    }
    return db.select({
      id: views.threatAnalyses.id,
      stixId: views.threatAnalyses.stixId,
      name: views.threatAnalyses.name,
      entityType: views.threatAnalyses.entityType,
    }).from(views.threatAnalyses).where(inArray(views.threatAnalyses.stixId, stixIds));
  },

  findActivityWatermarks: async ({ db, views }) => db.select({
    id: views.threatAnalyses.id,
    updatedAt: views.threatAnalyses.updatedAt,
    activityComputedAt: views.threatAnalyses.activityComputedAt,
    activityGate: views.threatAnalyses.activityGate,
    lastObservedViaAnalysisId: views.threatAnalyses.lastObservedViaAnalysisId,
  }).from(views.threatAnalyses),

  /**
   * The rows an anchor is built from. Ungated, and the batch travels as one bound array rather than
   * an `in` list so the statement text and its parameter count never vary with it: both are
   * invariants `recomputeActivity` states and depends on.
   */
  findActivityClaimsForAnalyses: async ({ db, views }, analysisIds: Array<string>) => {
    const claimColumns = <T extends ActivityClaimView>(claim: T) => ({
      analysisId: claim.analysisId,
      stixRelationId: claim.stixRelationId,
      relCreated: claim.relCreated,
      relStartTime: claim.relStartTime,
      relStopTime: claim.relStopTime,
      relConfidence: claim.relConfidence,
      producerStixId: claim.producerStixId,
    });
    // Interpolated bare, Drizzle spreads an array into one placeholder per element.
    const scopedTo = (column: AnyPgColumn) => sql`${column} = any(${sql.param(analysisIds)}::uuid[])`;
    // Sequential, not `Promise.all`: the platform seed folds activity on its transaction's one connection.
    const locations = await db.select(claimColumns(views.threatAnalysisLocations))
      .from(views.threatAnalysisLocations)
      .where(scopedTo(views.threatAnalysisLocations.analysisId));
    const sectors = await db.select(claimColumns(views.threatAnalysisSectors))
      .from(views.threatAnalysisSectors)
      .where(scopedTo(views.threatAnalysisSectors.analysisId));
    const cves = await db.select(claimColumns(views.threatAnalysisCves))
      .from(views.threatAnalysisCves)
      .where(scopedTo(views.threatAnalysisCves.analysisId));
    const techniques = await db.select(claimColumns(views.threatAnalysisTechniques))
      .from(views.threatAnalysisTechniques)
      .where(scopedTo(views.threatAnalysisTechniques.analysisId));
    const actors = await db.select({
      analysisId: views.threatAnalyses.id,
      stixId: views.threatAnalyses.stixId,
      firstSeen: views.threatAnalyses.firstSeen,
      lastSeen: views.threatAnalyses.lastSeen,
    })
      .from(views.threatAnalyses)
      .where(scopedTo(views.threatAnalyses.id));
    return { locations, sectors, cves, techniques, actors };
  },

  /**
   * Every stated attribution of the tenant, ungated: the gate is applied where the lineage is built,
   * so the statement is the same on every run. A target of another tenant sharing the STIX id does
   * not resolve.
   */
  findActivityAttributionEdges: async ({ db, views }, tenantId: string): Promise<Array<ActivityAttributionEdge>> => {
    // The secured view is already a subquery named after the table, so the second read of it goes
    // through a subquery of its own rather than alias(), which only takes a table.
    const target = db
      .select({ id: views.threatAnalyses.id, stixId: views.threatAnalyses.stixId })
      .from(views.threatAnalyses)
      .where(eq(views.threatAnalyses.tenantId, tenantId))
      .as('attribution_target');
    return db.select({
      sourceId: views.threatAnalysisAttributions.analysisId,
      sourceEntityType: views.threatAnalyses.entityType,
      targetStixId: views.threatAnalysisAttributions.targetStixId,
      targetId: target.id,
      confidence: views.threatAnalysisAttributions.relConfidence,
    })
      .from(views.threatAnalysisAttributions)
      .innerJoin(views.threatAnalyses, eq(views.threatAnalyses.id, views.threatAnalysisAttributions.analysisId))
      .leftJoin(target, eq(target.stixId, views.threatAnalysisAttributions.targetStixId))
      .where(and(
        eq(views.threatAnalyses.tenantId, tenantId),
        eq(views.threatAnalysisAttributions.isInferred, false),
      ));
  },

  deleteActivityAnchorsForAnalyses: async ({ db }, analysisIds: Array<string>) => {
    await db.delete(threatActivityAnchors)
      .where(sql`${threatActivityAnchors.analysisId} = any(${sql.param(analysisIds)}::uuid[])`);
  },

  insertActivityAnchors: async ({ db }, rows: Array<typeof threatActivityAnchors.$inferInsert>) => {
    for (let start = 0; start < rows.length; start += ACTIVITY_ANCHOR_CHUNK_SIZE) {
      await db.insert(threatActivityAnchors).values(rows.slice(start, start + ACTIVITY_ANCHOR_CHUNK_SIZE));
    }
  },

  /**
    * The anchors of the actors being folded, the batch bound as one array like the claim reads: the
    * statement's shape does not follow it, so a run folding three actors reads three actors' rows
    * and still subscribes to the whole table.
    */
  findActivityAnchorRows: async ({ db, views }, analysisIds: Array<string>) => db.select({
    analysisId: views.threatActivityAnchors.analysisId,
    kind: views.threatActivityAnchors.kind,
    observedAt: views.threatActivityAnchors.observedAt,
    authoredAt: views.threatActivityAnchors.authoredAt,
    confidence: views.threatActivityAnchors.confidence,
  })
    .from(views.threatActivityAnchors)
    .where(sql`${views.threatActivityAnchors.analysisId} = any(${sql.param(analysisIds)}::uuid[])`),

  /**
   * Writes a fold back onto the actors, one statement each: the values differ per row and
   * `ProtectedDB` offers neither `update ... from` nor an expression in `set`, and the parent table
   * cannot be upserted since a full row would race an ingestion over the actor's own attributes.
   *
   * Only a pass that rebuilt the anchors may move `activity_computed_at` (`withWatermark`). A
   * whole-tenant pass that moved it would mark an actor an ingestion touched mid-run as already
   * folded, and nothing would ever come back for it.
   *
   * That pass also carries `seenUpdatedAt` and refuses the row when `updated_at` has moved since it
   * was read. An ingestion stamps `updated_at` in the process, before its transaction commits, so
   * it can commit after a run started and still carry an earlier instant: advancing the watermark
   * past it would bury its claims until something else touched the actor. Writing nothing leaves
   * the actor stale, and the doorbell that ingestion rings brings the run back.
   */
  /**
   * The rows travel with their own watermark flag and are taken in `id` order, which is the order
   * every writer of several analysis rows of a tenant agrees on: the rebuild walks the same key,
   * so the two cannot take the same pair of rows the opposite way round and deadlock.
   */
  updateActivityFold: async (
    { db },
    rows: Array<{
      id: string,
      seenUpdatedAt: Date,
      lastObservedAt: Date | null,
      lastObservedViaId: string | null,
      lastAuthoredAt: Date | null,
      activityScore: number | null,
      withWatermark: boolean,
    }>,
    { gate, now }: { gate: number, now: Date },
  ) => {
    for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
      await db.update(threatAnalyses)
        .set({
          lastObservedAt: row.lastObservedAt,
          lastObservedViaAnalysisId: row.lastObservedViaId,
          lastAuthoredAt: row.lastAuthoredAt,
          activityScore: row.activityScore,
          activityGate: gate,
          ...(row.withWatermark ? { activityComputedAt: now } : {}),
        })
        .where(row.withWatermark
          ? and(eq(threatAnalyses.id, row.id), eq(threatAnalyses.updatedAt, row.seenUpdatedAt))
          : eq(threatAnalyses.id, row.id));
    }
  },
});
