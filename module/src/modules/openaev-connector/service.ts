import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type {
  AttackObservationMirror,
  EvidenceWrittenEntry,
  LastScan,
  ObservationPair,
  OpenaevAssetInput,
  ScanCoverageCounts,
  ScanMeasurementInput,
  StoredPostureCounts,
} from './repository';
import type { OpenaevStream } from './schema';
import { defineService } from '../../registry';
import { openaevConnectorRepository } from './repository';

export interface StreamStateInput {
  connectorId: string,
  openaevTenantId: string,
  stream: OpenaevStream,
}

/** How long an asset's description is left alone after it was fetched. */
const DESCRIPTION_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const tenantOf = (origin: object): string => {
  if (!('tenantId' in origin) || typeof origin.tenantId !== 'string') {
    throw newError('Tenant context required');
  }
  return origin.tenantId;
};

export const openaevConnectorService = defineService(
  'openaevConnector',
  openaevConnectorRepository,
).implement({
  /**
   * Every stream state of the connector, one row per (OpenAEV tenant, stream), `unreconciledSince`
   * included. A stream never read has no row. Rows of another tenant are never returned.
   */
  getStreamStates: async ({ repo }, connectorId: string) => repo.findStreamStates(connectorId),

  /**
   * Records where the differential read resumes, creating the stream's row when it has none. Leaves
   * the full-walk columns alone: a cursor saved during a walk does not end it. Throws
   * `Access Denied` for a connector the caller's tenant does not own.
   */
  saveStreamCursor: async (
    { repo, eventOrigin }, input: StreamStateInput & { cursor: string | null },
  ): Promise<void> => {
    await repo.assertConnectorVisible(input.connectorId);
    await repo.upsertStreamCursor(uuidv7(), tenantOf(eventOrigin), input, input.cursor);
  },

  /**
   * Opens a full walk: clears the cursor so the read restarts from the beginning, and marks the
   * walk as in progress at `startedAt`. Creates the stream's row when it has none. Throws
   * `Access Denied` for a connector the caller's tenant does not own.
   */
  startFullWalk: async (
    { repo, eventOrigin }, input: StreamStateInput & { startedAt: Date },
  ): Promise<void> => {
    await repo.assertConnectorVisible(input.connectorId);
    await repo.upsertFullWalkStart(uuidv7(), tenantOf(eventOrigin), input, input.startedAt);
  },

  /**
   * Closes a full walk: the walk is no longer in progress and `completedAt` is recorded as the
   * attempt. It is recorded as a completion only when `ready`, so a walk against a source that was
   * not ready is retried on the retry interval rather than waiting a week. Does nothing for a stream
   * that has no row.
   */
  completeFullWalk: async (
    { repo }, input: StreamStateInput & { completedAt: Date, ready: boolean },
  ): Promise<void> => {
    await repo.updateFullWalkEnd(input, input.completedAt, input.ready);
  },

  /**
   * Notes that a read of the stream, which began at `since`, has not been reconciled into evidence
   * yet. The stream keeps the oldest such instant: a call while one is already noted changes
   * nothing. Creates the stream's row when it has none. Throws `Access Denied` for a connector the
   * caller's tenant does not own.
   */
  markStreamUnreconciled: async (
    { repo, eventOrigin }, input: StreamStateInput & { since: Date },
  ): Promise<void> => {
    await repo.assertConnectorVisible(input.connectorId);
    await repo.upsertStreamUnreconciledSince(uuidv7(), tenantOf(eventOrigin), input, input.since);
  },

  /** Notes that everything read from the stream has been reconciled. Does nothing for a stream that has no row. */
  markStreamReconciled: async ({ repo }, input: StreamStateInput): Promise<void> => {
    await repo.clearStreamUnreconciledSince(input);
  },

  /**
   * Records the attack observations OpenAEV served, one mirror row per document: a document already
   * mirrored has its fields and `last_reported_at` overwritten but keeps `evidence_written_at` and
   * `evidence_platform_types`. A document
   * listed twice keeps its last occurrence. Throws `Access Denied` for a connector the caller's
   * tenant does not own.
   */
  upsertAttackObservations: async (
    { repo, eventOrigin },
    input: { connectorId: string, openaevTenantId: string, observations: Array<AttackObservationMirror>, reportedAt: Date },
  ): Promise<void> => {
    await repo.assertConnectorVisible(input.connectorId);
    await repo.upsertObservationRows(
      tenantOf(eventOrigin), input.connectorId, input.openaevTenantId, input.observations, input.reportedAt,
    );
  },

  /**
   * Stamps the mirror rows whose evidence was just written, with the instant and the security
   * platform types (`unknown` included) the evidence was written with, replacing the types of the
   * previous write. An unknown observation id is ignored.
   */
  markEvidenceWritten: async (
    { repo }, input: { connectorId: string, entries: Array<EvidenceWrittenEntry>, writtenAt: Date },
  ): Promise<void> => {
    await repo.stampEvidenceWritten(input.connectorId, input.entries, input.writtenAt);
  },

  /**
   * The documents still current for each (asset, scenario) pair: the mirror rows of those pairs that
   * a later run did not supersede. A document is superseded when another document of the same
   * connector, asset and scenario is `FINISHED` and started strictly later. Only a `FINISHED`
   * document with a start date supersedes; a document with no start date is therefore superseded
   * by any dated `FINISHED` document of its pair, and can never supersede one. A document that is
   * not `FINISHED` is current unless superseded, and two documents with the same start date never
   * supersede each other. A pair with no mirror row yields nothing. Each row carries
   * `observationId` and `evidencePlatformTypes`, `null` while no evidence was written.
   */
  findCurrentObservations: async (
    { repo }, input: { connectorId: string, pairs: Array<ObservationPair> },
  ) => repo.findCurrentObservationRows(input.connectorId, input.pairs),

  /** Every distinct (asset, scenario) pair the connector's mirror holds. */
  listObservationPairs: async ({ repo }, connectorId: string) => repo.findObservationPairs(connectorId),

  /**
   * The distinct (asset, scenario) pairs of one OpenAEV tenant that have a mirror row reported at or
   * after `since`.
   */
  listObservationPairsReportedSince: async (
    { repo }, input: { connectorId: string, openaevTenantId: string, since: Date },
  ) => repo.findObservationPairsReportedSince(input.connectorId, input.openaevTenantId, input.since),

  /**
   * Removes the mirror rows of one OpenAEV tenant that were not reported since `since` (strictly
   * earlier `last_reported_at`) and returns the distinct (asset, scenario) pairs they belonged to. Touches
   * neither another OpenAEV tenant of the connector nor another connector.
   */
  deleteObservationsNotReportedSince: async (
    { repo }, input: { connectorId: string, openaevTenantId: string, since: Date },
  ) => repo.deleteObservationRowsNotReportedSince(input.connectorId, input.openaevTenantId, input.since),

  /**
   * Registers the OpenAEV assets of one inventory, one row per `(connector, source asset)`. A row
   * already registered is rewritten only when its OpenAEV tenant or its description route differs,
   * and `description_fetched_at` is never touched: an inventory that changed nothing writes nothing.
   * An asset listed twice keeps its last occurrence. Throws `Access Denied` for a connector the
   * caller's tenant does not own.
   */
  upsertAssets: async (
    { repo, eventOrigin }, input: { connectorId: string, assets: Array<OpenaevAssetInput> },
  ): Promise<void> => {
    await repo.assertConnectorVisible(input.connectorId);
    await repo.upsertAssetRows(tenantOf(eventOrigin), input.connectorId, input.assets);
  },

  /** The ids OpenAEV gives the assets of one OpenAEV tenant that the connector has registered. */
  listSourceAssetIds: async (
    { repo }, input: { connectorId: string, openaevTenantId: string },
  ) => repo.findSourceAssetIds(input.connectorId, input.openaevTenantId),

  /**
   * The OpenAEV tenant each registered asset belongs to, for every tenant of the connector. An
   * asset the connector does not register, because OpenAEV deleted it or its inventory never
   * listed it, is absent.
   */
  getAssetTenantMap: async ({ repo }, connectorId: string): Promise<Map<string, string>> => {
    const rows = await repo.findAssetTenants(connectorId);
    return new Map(rows.map((row) => [row.sourceAssetId, row.openaevTenantId]));
  },

  /**
   * The assets registered under one OpenAEV tenant that a completed inventory of that tenant did not
   * list (`reportedSourceAssetIds`). Only meaningful against the whole inventory: an asset left out
   * of a partial one would read as gone while OpenAEV still serves it. Touches neither another
   * OpenAEV tenant of the connector nor another connector.
   */
  listUnreportedAssets: async (
    { repo }, input: { connectorId: string, openaevTenantId: string, reportedSourceAssetIds: ReadonlyArray<string> },
  ): Promise<Array<string>> => {
    const reported = new Set(input.reportedSourceAssetIds);
    return (await repo.findSourceAssetIds(input.connectorId, input.openaevTenantId))
      .filter((sourceAssetId) => !reported.has(sourceAssetId));
  },

  /**
   * Unregisters the given assets of one OpenAEV tenant, those `listUnreportedAssets` returned. An
   * asset registered under another OpenAEV tenant or connector is left alone.
   */
  pruneAssets: async (
    { repo }, input: { connectorId: string, openaevTenantId: string, sourceAssetIds: Array<string> },
  ): Promise<void> => {
    await repo.deleteAssetRows(input.connectorId, input.openaevTenantId, input.sourceAssetIds);
  },

  /**
   * The assets of one OpenAEV tenant whose description is only served by `GET /assets/{id}`
   * (`needsDescriptionFetch`), in the order they should be fetched: never fetched first, then the
   * one fetched longest ago, ties broken by source asset id. An asset fetched less than
   * `DESCRIPTION_MIN_AGE_MS` ago is left out, so a small estate is not fetched again on every run.
   * At most `limit` ids; an asset the connector has not registered, or whose description a batch
   * route already carries, never appears.
   */
  listDescriptionCandidates: async (
    { repo }, input: { connectorId: string, openaevTenantId: string, limit: number },
  ): Promise<Array<string>> => repo.findDescriptionCandidates(
    input.connectorId,
    input.openaevTenantId,
    new Date(Date.now() - DESCRIPTION_MIN_AGE_MS),
    input.limit,
  ),

  /**
   * The asset's OpenAEV posture as the sync stored it, read under the caller's tenant isolation and
   * never live from OpenAEV: the OpenAEV findings of the asset whose latest test held (`success`)
   * and whose latest test found it exposed (`failed`). `null` while no OpenAEV test spoke about the
   * asset, for an unknown asset, and for another tenant's asset.
   */
  getStoredPosture: async (
    { repo }, supportingAssetId: string,
  ): Promise<StoredPostureCounts | null> => repo.findStoredPosture(supportingAssetId),

  /**
   * Records the finished vulnerability scans of one attack-stream page (opencrq #332), one row per
   * (asset, scenario): an older delivery never replaces a newer scan. Throws `Access Denied` for a
   * connector the caller's tenant does not own.
   */
  upsertScanMeasurements: async (
    { repo, eventOrigin }, input: { connectorId: string, measurements: Array<ScanMeasurementInput> },
  ): Promise<void> => {
    if (input.measurements.length === 0) {
      return;
    }
    await repo.assertConnectorVisible(input.connectorId);
    await repo.upsertScanMeasurementRows(tenantOf(eventOrigin), input.connectorId, input.measurements);
  },

  /**
   * The asset's latest vulnerability scan as the sync stored it (date, scanner, clean or findings),
   * read under the caller's tenant isolation; `null` while no scan of it was imported.
   */
  getLastScan: async ({ repo }, supportingAssetId: string): Promise<LastScan | null> => repo.findLastScan(supportingAssetId),

  /** The tenant's scanned assets, and those scanned since `recentSince`, for the scan coverage of the patch capability. */
  getScanCoverage: async ({ repo }, recentSince: Date): Promise<ScanCoverageCounts> => repo.countScanCoverage(recentSince),

  /**
   * Stamps `description_fetched_at` on the given registered assets, sending them to the back of the
   * candidate order. An unregistered id is ignored, and so is one of another tenant's connector.
   */
  markDescriptionsFetched: async (
    { repo }, input: { connectorId: string, sourceAssetIds: Array<string>, fetchedAt: Date },
  ): Promise<void> => {
    await repo.stampDescriptionsFetched(input.connectorId, input.sourceAssetIds, input.fetchedAt);
  },

  /**
   * Forgets what the snapshot streams left behind: the stream states and the attack observation
   * mirror. The asset registry stays, since the inventory that feeds it runs on either path. The
   * next snapshot run restarts every stream from a full walk.
   */
  forgetSnapshotState: async ({ repo }, connectorId: string): Promise<void> => {
    await repo.deleteSnapshotState(connectorId);
  },

  /**
   * Forgets everything the connector remembers about OpenAEV: the stream states, the attack
   * observation mirror and the asset registry. The next run starts over, as on a first install.
   */
  resetState: async ({ repo }, connectorId: string): Promise<void> => {
    await repo.deleteConnectorState(connectorId);
  },
});
