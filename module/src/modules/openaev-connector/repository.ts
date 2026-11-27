import { newError } from '@app/utils';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { OpenaevStream, ScanResult } from './schema';
import { defineRepository } from '../../registry';
import { openaevAssets, openaevAttackObservations, openaevScanMeasurements, openaevSyncStreams } from './schema';

export interface StreamKey {
  connectorId: string,
  openaevTenantId: string,
  stream: OpenaevStream,
}

/** The columns of an attack observation that OpenAEV serves; the rest of the mirror row is bookkeeping. */
export interface AttackObservationMirror {
  observationId: string,
  sourceAssetId: string,
  scenarioId: string,
  attackPatternExternalId: string,
  expectationType: string,
  simulationStartDate: Date | null,
  simulationStatus: string,
}

export interface ObservationPair {
  sourceAssetId: string,
  scenarioId: string,
}

/** The security platform types the evidence of one mirrored document was written with. */
export interface EvidenceWrittenEntry {
  observationId: string,
  platformTypes: Array<string>,
}

/** One finished vulnerability scan of a supporting asset, as the sync writes it. */
export interface ScanMeasurementInput {
  supportingAssetId: string,
  scenarioId: string,
  scenarioName: string | null,
  simulationId: string | null,
  observationId: string,
  platformTypes: Array<string>,
  result: ScanResult,
  evaluatedAt: Date,
}

/** The latest scan of an asset across its scenarios. */
export interface LastScan {
  evaluatedAt: Date,
  result: ScanResult,
  scenarioId: string,
  scenarioName: string | null,
  platformTypes: Array<string>,
}

/** How many scanned assets of the tenant there are, and how many of them were scanned since a given instant. */
export interface ScanCoverageCounts {
  scanned: number,
  recent: number,
}

export interface OpenaevAssetInput {
  sourceAssetId: string,
  openaevTenantId: string,
  needsDescriptionFetch: boolean,
}

/** The OpenAEV test results of one asset as the sync stored them: findings OpenAEV last proved held, and last proved exposed. */
export interface StoredPostureCounts {
  success: number,
  failed: number,
}

const streamKeyMatches = (key: StreamKey) => and(
  eq(openaevSyncStreams.connectorId, key.connectorId),
  eq(openaevSyncStreams.openaevTenantId, key.openaevTenantId),
  eq(openaevSyncStreams.stream, key.stream),
);

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
const dbNow = () => sql`now()` as unknown as Date;

const UPSERT_CHUNK_SIZE = 1000;
const PAIR_CHUNK_SIZE = 1000;

const chunked = <T>(items: ReadonlyArray<T>, size: number): Array<Array<T>> => {
  const chunks: Array<Array<T>> = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const STREAM_CONFLICT_TARGET = [openaevSyncStreams.connectorId, openaevSyncStreams.openaevTenantId, openaevSyncStreams.stream];

export const openaevConnectorRepository = defineRepository({
  findStreamStates: async ({ db, views }, connectorId: string) =>
    db.select().from(views.openaevSyncStreams)
      .where(eq(views.openaevSyncStreams.connectorId, connectorId)),

  /**
   * The insert path of the stream upserts carries the caller's tenant, but the foreign key only sees
   * the connector id: without this read, a tenant could create a row against another tenant's
   * connector and, through the unique index, shadow that tenant's own stream.
   */
  assertConnectorVisible: async ({ db, views }, connectorId: string): Promise<void> => {
    const found = await db.select({ id: views.integrationSettings.id }).from(views.integrationSettings)
      .where(eq(views.integrationSettings.id, connectorId)).limit(1);
    if (found.length === 0) {
      throw newError('Access Denied');
    }
  },

  upsertStreamCursor: async (
    { db }, id: string, tenantId: string, key: StreamKey, cursor: string | null,
  ): Promise<void> => {
    const updatedAt = dbNow();
    await db.insert(openaevSyncStreams)
      .values([{ id, tenantId, ...key, cursor, updatedAt }])
      .onConflictDoUpdate({ target: STREAM_CONFLICT_TARGET, set: { cursor, updatedAt } });
  },

  upsertFullWalkStart: async (
    { db }, id: string, tenantId: string, key: StreamKey, startedAt: Date,
  ): Promise<void> => {
    const updatedAt = dbNow();
    await db.insert(openaevSyncStreams)
      .values([{ id, tenantId, ...key, cursor: null, fullWalkStartedAt: startedAt, updatedAt }])
      .onConflictDoUpdate({ target: STREAM_CONFLICT_TARGET, set: { cursor: null, fullWalkStartedAt: startedAt, updatedAt } });
  },

  updateFullWalkEnd: async (
    { db }, key: StreamKey, completedAt: Date, ready: boolean,
  ): Promise<void> => {
    await db.update(openaevSyncStreams)
      .set({
        fullWalkStartedAt: null,
        lastFullWalkAttemptedAt: completedAt,
        ...(ready ? { lastFullWalkCompletedAt: completedAt } : {}),
        updatedAt: dbNow(),
      })
      .where(streamKeyMatches(key));
  },

  /** Keeps the earlier instant when the stream already has one: only the oldest unreconciled read matters. */
  upsertStreamUnreconciledSince: async (
    { db }, id: string, tenantId: string, key: StreamKey, since: Date,
  ): Promise<void> => {
    const updatedAt = dbNow();
    await db.insert(openaevSyncStreams)
      .values([{ id, tenantId, ...key, cursor: null, unreconciledSince: since, updatedAt }])
      .onConflictDoUpdate({
        target: STREAM_CONFLICT_TARGET,
        set: { unreconciledSince: since, updatedAt },
        setWhere: isNull(openaevSyncStreams.unreconciledSince),
      });
  },

  clearStreamUnreconciledSince: async ({ db }, key: StreamKey): Promise<void> => {
    await db.update(openaevSyncStreams)
      .set({ unreconciledSince: null, updatedAt: dbNow() })
      .where(and(streamKeyMatches(key), isNotNull(openaevSyncStreams.unreconciledSince)));
  },

  upsertObservationRows: async (
    { db }, tenantId: string, connectorId: string, openaevTenantId: string,
    observations: Array<AttackObservationMirror>, reportedAt: Date,
  ): Promise<void> => {
    // A statement cannot touch the same conflict key twice: the last occurrence wins.
    const byObservation = new Map(observations.map((observation) => [observation.observationId, observation]));
    for (const rows of chunked([...byObservation.values()], UPSERT_CHUNK_SIZE)) {
      await db.insert(openaevAttackObservations)
        .values(rows.map((row) => ({ ...row, tenantId, connectorId, openaevTenantId, lastReportedAt: reportedAt })))
        .onConflictDoUpdate({
          target: [openaevAttackObservations.connectorId, openaevAttackObservations.observationId],
          set: {
            openaevTenantId,
            sourceAssetId: sql`excluded.source_asset_id`,
            scenarioId: sql`excluded.scenario_id`,
            attackPatternExternalId: sql`excluded.attack_pattern_external_id`,
            expectationType: sql`excluded.expectation_type`,
            simulationStartDate: sql`excluded.simulation_start_date`,
            simulationStatus: sql`excluded.simulation_status`,
            lastReportedAt: reportedAt,
          },
        });
    }
  },

  stampEvidenceWritten: async (
    { db }, connectorId: string, entries: Array<EvidenceWrittenEntry>, writtenAt: Date,
  ): Promise<void> => {
    // Documents sharing a set of platform types go in one statement: there are few distinct sets.
    const idsByPlatformTypes = new Map<string, { platformTypes: Array<string>, observationIds: Array<string> }>();
    for (const { observationId, platformTypes } of entries) {
      const sorted = [...new Set(platformTypes)].sort();
      const group = idsByPlatformTypes.get(JSON.stringify(sorted));
      if (group === undefined) {
        idsByPlatformTypes.set(JSON.stringify(sorted), { platformTypes: sorted, observationIds: [observationId] });
      } else {
        group.observationIds.push(observationId);
      }
    }
    for (const { platformTypes, observationIds } of idsByPlatformTypes.values()) {
      for (const ids of chunked(observationIds, UPSERT_CHUNK_SIZE)) {
        await db.update(openaevAttackObservations)
          .set({ evidenceWrittenAt: writtenAt, evidencePlatformTypes: platformTypes })
          .where(and(
            eq(openaevAttackObservations.connectorId, connectorId),
            inArray(openaevAttackObservations.observationId, ids),
          ));
      }
    }
  },

  /**
   * A document is superseded when the latest `FINISHED` start date of its (asset, scenario) is
   * strictly later than its own, or when it has none and a dated `FINISHED` document exists. The
   * window is computed over every row of the pair, so a pair is never split across chunks.
   */
  findCurrentObservationRows: async (
    { db, views }, connectorId: string, pairs: Array<ObservationPair>,
  ): Promise<Array<typeof openaevAttackObservations.$inferSelect>> => {
    const mirror = views.openaevAttackObservations;
    const rows: Array<typeof openaevAttackObservations.$inferSelect> = [];
    for (const batch of chunked(pairs, PAIR_CHUNK_SIZE)) {
      const withLatestFinished = db
        .select({
          tenantId: mirror.tenantId,
          connectorId: mirror.connectorId,
          openaevTenantId: mirror.openaevTenantId,
          observationId: mirror.observationId,
          sourceAssetId: mirror.sourceAssetId,
          scenarioId: mirror.scenarioId,
          attackPatternExternalId: mirror.attackPatternExternalId,
          expectationType: mirror.expectationType,
          simulationStartDate: mirror.simulationStartDate,
          simulationStatus: mirror.simulationStatus,
          lastReportedAt: mirror.lastReportedAt,
          evidenceWrittenAt: mirror.evidenceWrittenAt,
          evidencePlatformTypes: mirror.evidencePlatformTypes,
          latestFinishedStart: sql<Date | null>`max(case when ${mirror.simulationStatus} = 'FINISHED' then ${mirror.simulationStartDate} end)
            over (partition by ${mirror.sourceAssetId}, ${mirror.scenarioId})`.as('latest_finished_start'),
        })
        .from(mirror)
        .where(and(
          eq(mirror.connectorId, connectorId),
          sql`(${mirror.sourceAssetId}, ${mirror.scenarioId}) in (
            select * from unnest(
              ${sql.param(batch.map((pair) => pair.sourceAssetId))}::text[],
              ${sql.param(batch.map((pair) => pair.scenarioId))}::text[]
            )
          )`,
        ))
        .as('with_latest_finished');
      const current = await db
        .select({
          tenantId: withLatestFinished.tenantId,
          connectorId: withLatestFinished.connectorId,
          openaevTenantId: withLatestFinished.openaevTenantId,
          observationId: withLatestFinished.observationId,
          sourceAssetId: withLatestFinished.sourceAssetId,
          scenarioId: withLatestFinished.scenarioId,
          attackPatternExternalId: withLatestFinished.attackPatternExternalId,
          expectationType: withLatestFinished.expectationType,
          simulationStartDate: withLatestFinished.simulationStartDate,
          simulationStatus: withLatestFinished.simulationStatus,
          lastReportedAt: withLatestFinished.lastReportedAt,
          evidenceWrittenAt: withLatestFinished.evidenceWrittenAt,
          evidencePlatformTypes: withLatestFinished.evidencePlatformTypes,
        })
        .from(withLatestFinished)
        .where(sql`${withLatestFinished.latestFinishedStart} is null
          or ${withLatestFinished.simulationStartDate} >= ${withLatestFinished.latestFinishedStart}`);
      rows.push(...current);
    }
    return rows;
  },

  findObservationPairs: async (
    { db, views }, connectorId: string,
  ): Promise<Array<ObservationPair>> => db
    .selectDistinct({
      sourceAssetId: views.openaevAttackObservations.sourceAssetId,
      scenarioId: views.openaevAttackObservations.scenarioId,
    })
    .from(views.openaevAttackObservations)
    .where(eq(views.openaevAttackObservations.connectorId, connectorId)),

  findObservationPairsReportedSince: async (
    { db, views }, connectorId: string, openaevTenantId: string, since: Date,
  ): Promise<Array<ObservationPair>> => db
    .selectDistinct({
      sourceAssetId: views.openaevAttackObservations.sourceAssetId,
      scenarioId: views.openaevAttackObservations.scenarioId,
    })
    .from(views.openaevAttackObservations)
    .where(and(
      eq(views.openaevAttackObservations.connectorId, connectorId),
      eq(views.openaevAttackObservations.openaevTenantId, openaevTenantId),
      gte(views.openaevAttackObservations.lastReportedAt, since),
    )),

  deleteObservationRowsNotReportedSince: async (
    { db }, connectorId: string, openaevTenantId: string, since: Date,
  ): Promise<Array<ObservationPair>> => {
    const deleted = await db.delete(openaevAttackObservations)
      .where(and(
        eq(openaevAttackObservations.connectorId, connectorId),
        eq(openaevAttackObservations.openaevTenantId, openaevTenantId),
        lt(openaevAttackObservations.lastReportedAt, since),
      ))
      .returning();
    const distinct = new Map(deleted.map(({ sourceAssetId, scenarioId }) => [
      `${sourceAssetId}\u0000${scenarioId}`, { sourceAssetId, scenarioId },
    ]));
    return [...distinct.values()];
  },

  /**
   * `setWhere` is what keeps an unchanged inventory free: an asset already registered with the same
   * OpenAEV tenant and description route is not rewritten. `description_fetched_at` is never in the
   * `set`, so a changed asset keeps it.
   */
  upsertAssetRows: async (
    { db }, tenantId: string, connectorId: string, assets: Array<OpenaevAssetInput>,
  ): Promise<void> => {
    // A statement cannot touch the same conflict key twice: the last occurrence wins.
    const bySourceAsset = new Map(assets.map((asset) => [asset.sourceAssetId, asset]));
    for (const rows of chunked([...bySourceAsset.values()], UPSERT_CHUNK_SIZE)) {
      await db.insert(openaevAssets)
        .values(rows.map((row) => ({ ...row, tenantId, connectorId })))
        .onConflictDoUpdate({
          target: [openaevAssets.connectorId, openaevAssets.sourceAssetId],
          set: {
            openaevTenantId: sql`excluded.openaev_tenant_id`,
            needsDescriptionFetch: sql`excluded.needs_description_fetch`,
          },
          setWhere: sql`(${openaevAssets.openaevTenantId}, ${openaevAssets.needsDescriptionFetch})
            is distinct from (excluded.openaev_tenant_id, excluded.needs_description_fetch)`,
        });
    }
  },

  findSourceAssetIds: async (
    { db, views }, connectorId: string, openaevTenantId: string,
  ): Promise<Array<string>> => db
    .select({ sourceAssetId: views.openaevAssets.sourceAssetId })
    .from(views.openaevAssets)
    .where(and(
      eq(views.openaevAssets.connectorId, connectorId),
      eq(views.openaevAssets.openaevTenantId, openaevTenantId),
    ))
    .then((rows) => rows.map((row) => row.sourceAssetId)),

  /** The OpenAEV tenant of every asset the connector has registered. */
  findAssetTenants: async (
    { db, views }, connectorId: string,
  ): Promise<Array<{ sourceAssetId: string, openaevTenantId: string }>> => db
    .select({
      sourceAssetId: views.openaevAssets.sourceAssetId,
      openaevTenantId: views.openaevAssets.openaevTenantId,
    })
    .from(views.openaevAssets)
    .where(eq(views.openaevAssets.connectorId, connectorId)),

  deleteAssetRows: async (
    { db }, connectorId: string, openaevTenantId: string, sourceAssetIds: Array<string>,
  ): Promise<void> => {
    for (const ids of chunked(sourceAssetIds, UPSERT_CHUNK_SIZE)) {
      await db.delete(openaevAssets).where(and(
        eq(openaevAssets.connectorId, connectorId),
        eq(openaevAssets.openaevTenantId, openaevTenantId),
        inArray(openaevAssets.sourceAssetId, ids),
      ));
    }
  },

  findDescriptionCandidates: async (
    { db, views }, connectorId: string, openaevTenantId: string, fetchedBefore: Date, limit: number,
  ): Promise<Array<string>> => db
    .select({ sourceAssetId: views.openaevAssets.sourceAssetId })
    .from(views.openaevAssets)
    .where(and(
      eq(views.openaevAssets.connectorId, connectorId),
      eq(views.openaevAssets.openaevTenantId, openaevTenantId),
      eq(views.openaevAssets.needsDescriptionFetch, true),
      or(isNull(views.openaevAssets.descriptionFetchedAt), lt(views.openaevAssets.descriptionFetchedAt, fetchedBefore)),
    ))
    .orderBy(sql`${views.openaevAssets.descriptionFetchedAt} asc nulls first`, asc(views.openaevAssets.sourceAssetId))
    .limit(limit)
    .then((rows) => rows.map((row) => row.sourceAssetId)),

  /**
   * One row per (connector, asset, scenario); a delivery older than the stored scan leaves it alone,
   * so a full walk replaying an old document never rolls the measurement back.
   */
  upsertScanMeasurementRows: async (
    { db }, tenantId: string, connectorId: string, rows: Array<ScanMeasurementInput>,
  ): Promise<void> => {
    // A statement cannot touch the same conflict key twice: the newest scan of a pair wins.
    const byKey = new Map<string, ScanMeasurementInput>();
    for (const row of rows) {
      const key = `${row.supportingAssetId}\u0000${row.scenarioId}`;
      const kept = byKey.get(key);
      if (kept === undefined || kept.evaluatedAt.getTime() <= row.evaluatedAt.getTime()) {
        byKey.set(key, row);
      }
    }
    for (const chunk of chunked([...byKey.values()], UPSERT_CHUNK_SIZE)) {
      await db.insert(openaevScanMeasurements)
        .values(chunk.map((row) => ({ ...row, tenantId, connectorId, updatedAt: dbNow() })))
        .onConflictDoUpdate({
          target: [openaevScanMeasurements.connectorId, openaevScanMeasurements.supportingAssetId, openaevScanMeasurements.scenarioId],
          set: {
            scenarioName: sql`excluded.scenario_name`,
            simulationId: sql`excluded.simulation_id`,
            observationId: sql`excluded.observation_id`,
            platformTypes: sql`excluded.platform_types`,
            result: sql`excluded.result`,
            evaluatedAt: sql`excluded.evaluated_at`,
            updatedAt: dbNow(),
          },
          setWhere: sql`excluded.evaluated_at >= ${openaevScanMeasurements.evaluatedAt}`,
        });
    }
  },

  findLastScan: async (
    { db, views }, supportingAssetId: string,
  ): Promise<LastScan | null> => {
    const scans = views.openaevScanMeasurements;
    const [row] = await db
      .select({
        evaluatedAt: scans.evaluatedAt,
        result: scans.result,
        scenarioId: scans.scenarioId,
        scenarioName: scans.scenarioName,
        platformTypes: scans.platformTypes,
      })
      .from(scans)
      .where(eq(scans.supportingAssetId, supportingAssetId))
      .orderBy(sql`${scans.evaluatedAt} desc`, asc(scans.scenarioId))
      .limit(1);
    return row ?? null;
  },

  countScanCoverage: async (
    { db, views }, recentSince: Date,
  ): Promise<ScanCoverageCounts> => {
    const scans = views.openaevScanMeasurements;
    const [row] = await db
      .select({
        scanned: sql<number>`count(distinct ${scans.supportingAssetId})`.mapWith(Number),
        recent: sql<number>`count(distinct ${scans.supportingAssetId}) filter (where ${scans.evaluatedAt} >= ${recentSince})`.mapWith(Number),
      })
      .from(scans);
    return row ?? { scanned: 0, recent: 0 };
  },

  findStoredPosture: async (
    { db, views }, supportingAssetId: string,
  ): Promise<StoredPostureCounts | null> => {
    const exposed = views.assetEvidence.latestVerdictExposed;
    const fromOpenaev = db.select({ assetEvidenceId: views.assetEvidenceSources.assetEvidenceId })
      .from(views.assetEvidenceSources)
      .innerJoin(views.integrationSettings, and(
        eq(views.integrationSettings.id, views.assetEvidenceSources.connectorId),
        eq(views.integrationSettings.source, 'openaev'),
      ));
    const [row] = await db
      .select({
        success: sql<number>`count(*) filter (where ${exposed} = false)`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${exposed} = true)`.mapWith(Number),
      })
      .from(views.assetEvidence)
      .where(and(
        eq(views.assetEvidence.supportingAssetId, supportingAssetId),
        isNotNull(exposed),
        inArray(views.assetEvidence.id, fromOpenaev),
      ));
    return row && row.success + row.failed > 0 ? row : null;
  },

  stampDescriptionsFetched: async (
    { db }, connectorId: string, sourceAssetIds: Array<string>, fetchedAt: Date,
  ): Promise<void> => {
    for (const ids of chunked(sourceAssetIds, UPSERT_CHUNK_SIZE)) {
      await db.update(openaevAssets)
        .set({ descriptionFetchedAt: fetchedAt })
        .where(and(
          eq(openaevAssets.connectorId, connectorId),
          inArray(openaevAssets.sourceAssetId, ids),
        ));
    }
  },

  deleteSnapshotState: async ({ db }, connectorId: string): Promise<void> => {
    await db.delete(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, connectorId));
    await db.delete(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, connectorId));
  },

  deleteConnectorState: async ({ db }, connectorId: string): Promise<void> => {
    await db.delete(openaevSyncStreams).where(eq(openaevSyncStreams.connectorId, connectorId));
    await db.delete(openaevAttackObservations).where(eq(openaevAttackObservations.connectorId, connectorId));
    await db.delete(openaevAssets).where(eq(openaevAssets.connectorId, connectorId));
    await db.delete(openaevScanMeasurements).where(eq(openaevScanMeasurements.connectorId, connectorId));
  },
});
