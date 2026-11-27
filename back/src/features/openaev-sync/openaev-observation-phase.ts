import type { AttackObservationMirror, EvidenceWrittenEntry, FullWalkTimestamps, ObservationPair, OpenaevStream, ScanMeasurementInput } from '@app/module';
import { isFullWalkDue } from '@app/module';
import type { createOpenaevClient } from './openaev-api-client';
import type { CveFindingsTransaction } from './cve-findings-transaction';
import type { AttackObservation, CveEvidenceRow, ExpectationEvidenceRow, SnapshotPage, VulnerabilityObservation } from './openaev-types';
import { createLogger } from '../../utils/logger';
import { buildAttackEvidenceRows, buildScanMeasurements, buildVulnerabilityEvidenceRows, cveIdentifierOfObservation } from './openaev-mapping-utils';

const { logTrace } = createLogger({ feature: 'openaev-sync' });

export type ObservationStreamState = FullWalkTimestamps & {
  openaevTenantId: string,
  stream: OpenaevStream,
  cursor: string | null,
  unreconciledSince: Date | null,
};

interface StreamKey {
  connectorId: string,
  openaevTenantId: string,
  stream: OpenaevStream,
}

/** The service methods the phase calls, as plain functions so a test can hand them over as `vi.fn()`. */
export interface ObservationPhaseServices {
  openaevConnector: {
    getStreamStates: (connectorId: string) => Promise<Array<ObservationStreamState>>,
    saveStreamCursor: (input: StreamKey & { cursor: string | null }) => Promise<void>,
    startFullWalk: (input: StreamKey & { startedAt: Date }) => Promise<void>,
    markStreamUnreconciled: (input: StreamKey & { since: Date }) => Promise<void>,
    upsertAttackObservations: (input: {
      connectorId: string,
      openaevTenantId: string,
      observations: Array<AttackObservationMirror>,
      reportedAt: Date,
    }) => Promise<void>,
    findCurrentObservations: (input: { connectorId: string, pairs: Array<ObservationPair> }) => Promise<Array<{ observationId: string }>>,
    markEvidenceWritten: (input: { connectorId: string, entries: Array<EvidenceWrittenEntry>, writtenAt: Date }) => Promise<void>,
    upsertScanMeasurements: (input: { connectorId: string, measurements: Array<ScanMeasurementInput> }) => Promise<void>,
  },
  supportingAssets: {
    bulkUpsertEvidence: (evidences: Array<ExpectationEvidenceRow | CveEvidenceRow>) => Promise<unknown>,
  },
  mitreAttack: {
    getTechniqueIdsByExternalIds: (externalIds: Array<string>) => Promise<Map<string, string>>,
  },
}

export interface ObservationPhaseProgress {
  stream: OpenaevStream,
  /** Pages of this stream processed in this run, the one just saved included. */
  pages: number,
  /** Observations of this stream received in this run. */
  observations: number,
}

export interface ObservationPhaseDeps {
  client: Pick<ReturnType<typeof createOpenaevClient>, 'searchAttackObservations' | 'searchVulnerabilityObservations'>,
  svc: ObservationPhaseServices,
  inCveFindingsTransaction: CveFindingsTransaction,
  connectorId: string,
  openaevTenantId: string,
  /** When the run began: what a stream read in this run is noted as unreconciled from, unless an earlier read already is. */
  runStartedAt: Date,
  /** OpenAEV asset id to supporting asset id, as the inventory of this OpenAEV tenant left it. */
  assetIdMap: ReadonlyMap<string, string>,
  /**
   * Runs the inventory of this OpenAEV tenant unless it already ran in this run, and returns the map
   * it built; `null` when it did not run again. May return a partial map when `signal` aborts.
   */
  ensureInventory: () => Promise<Map<string, string> | null>,
  signal: AbortSignal,
  now: () => Date,
  onProgress?: (progress: ObservationPhaseProgress) => Promise<void>,
}

export interface StreamOutcome {
  /**
   * Non-null only when the last page of a full walk was reached in this run: when the walk started
   * (this run's or an earlier one's, for a resumed walk) and whether that page said OpenAEV's
   * snapshot was ready, the only case in which a document the walk did not see may be treated as
   * deleted. The walk is left in progress: the caller ends it once it has reconciled what it read.
   */
  fullWalk: { startedAt: Date, ready: boolean } | null,
  /**
   * Whether this run read the stream as part of a full walk, completed or not. A walk delivers an
   * asset's documents across pages and possibly across runs, so what a run read of such a stream
   * says nothing about what the asset no longer reports.
   */
  walked: boolean,
  /**
   * The instant from which what was read of this stream has not been reconciled: the stream's
   * `unreconciledSince` when an earlier run left one, this run's start otherwise.
   */
  reconcileFrom: Date,
}

/** What the phase read and wrote, for the run's step counts. */
export interface ObservationPhaseCounts {
  /** Observations received, both streams. */
  read: number,
  /** Finding evidence rows written. */
  written: number,
  /** Observations that wrote nothing: an asset unknown after the inventory, a technique or CVE unknown, a superseded document. */
  skipped: number,
}

export interface ObservationPhaseResult {
  attack: StreamOutcome,
  vulnerability: StreamOutcome,
  counts: ObservationPhaseCounts,
}

const toMirror = (observation: AttackObservation): AttackObservationMirror => {
  const startDate = observation.last_simulation_start_date === null ? null : new Date(observation.last_simulation_start_date);
  return {
    observationId: observation.id,
    sourceAssetId: observation.asset_id,
    scenarioId: observation.scenario_id,
    attackPatternExternalId: observation.attack_pattern_external_id,
    expectationType: observation.expectation_type,
    simulationStartDate: startDate === null || Number.isNaN(startDate.getTime()) ? null : startDate,
    simulationStatus: observation.last_simulation_status,
  };
};

/**
 * Reads the attack stream, then the vulnerability stream, of one OpenAEV tenant and writes what they
 * carry. A stream resumes from its stored cursor; it restarts from the beginning, as a full walk,
 * when `isFullWalkDue` says so, and a walk left in progress by an earlier run resumes from its
 * cursor without starting a new one. Before a stream is read it is noted unreconciled from
 * `runStartedAt` (`markStreamUnreconciled`); the phase never clears that note nor ends a walk, so
 * what it read is reconciled by the caller and a failure before then leaves it to the next run.
 *
 * Each page is written in this order: attack mirror rows (every document, including those of an
 * unknown asset), evidence of the documents that are still current for their (asset, scenario) —
 * a superseded document, such as an old one a full walk delivers again, writes nothing —
 * `evidence_written_at` and the platform types of the documents that produced evidence, then the
 * stream cursor. A crash between two of them redelivers the page, which every write tolerates.
 * An asset missing from the map triggers `ensureInventory` once per call and the page is resolved
 * again against the map it returns; an asset still missing afterwards is skipped, never holding the
 * cursor back. An abort stops the phase without reporting a walk as completed.
 *
 * A failure of the client (a 404 meaning the snapshot export is off, for one) propagates, leaving
 * the cursor on the last page written.
 */
export const syncObservationStreams = async (deps: ObservationPhaseDeps): Promise<ObservationPhaseResult> => {
  const { svc, client, connectorId, openaevTenantId, runStartedAt, signal, now, onProgress, inCveFindingsTransaction } = deps;
  const assets = { map: deps.assetIdMap, inventoryRan: false };
  const counts: ObservationPhaseCounts = { read: 0, written: 0, skipped: 0 };

  // The inventory can return a partial map when it aborts, and a page written against it would
  // skip assets and still advance the cursor: the caller must not write once `signal` is aborted.
  const resolveAssets = async (observations: ReadonlyArray<{ asset_id: string }>): Promise<ReadonlyMap<string, string>> => {
    if (!assets.inventoryRan && observations.some((observation) => !assets.map.has(observation.asset_id))) {
      assets.inventoryRan = true;
      const refreshed = await deps.ensureInventory();
      if (refreshed !== null) {
        assets.map = refreshed;
      }
    }
    return assets.map;
  };

  const writeAttackPage = async (observations: Array<AttackObservation>): Promise<boolean> => {
    if (observations.length === 0) {
      return true;
    }
    const assetIdMap = await resolveAssets(observations);
    if (signal.aborted) {
      return false;
    }
    await svc.openaevConnector.upsertAttackObservations({
      connectorId,
      openaevTenantId,
      observations: observations.map(toMirror),
      reportedAt: now(),
    });

    const pairs = new Map<string, ObservationPair>();
    for (const { asset_id: sourceAssetId, scenario_id: scenarioId } of observations) {
      pairs.set(`${sourceAssetId}\u0000${scenarioId}`, { sourceAssetId, scenarioId });
    }
    const currentIds = new Set(
      (await svc.openaevConnector.findCurrentObservations({ connectorId, pairs: [...pairs.values()] }))
        .map((observation) => observation.observationId),
    );

    const externalIds = [...new Set(observations.map((observation) => observation.attack_pattern_external_id))];
    const techniqueIdMap = await svc.mitreAttack.getTechniqueIdsByExternalIds(externalIds);
    const skippedTechniques = new Set<string>();
    const evidenceRows: Array<ExpectationEvidenceRow> = [];
    const written: Array<EvidenceWrittenEntry> = [];
    // One call per observation, so the observations that yield evidence are known without the
    // rows having to carry their origin.
    for (const observation of observations) {
      if (!currentIds.has(observation.id)) {
        continue;
      }
      const rows = buildAttackEvidenceRows({
        observations: [observation],
        assetIdMap,
        techniqueIdMap,
        connectorId,
        onSkippedTechnique: (externalId) => skippedTechniques.add(externalId),
      });
      if (rows.length > 0) {
        evidenceRows.push(...rows);
        written.push({ observationId: observation.id, platformTypes: rows.map((row) => row.securityPlatformType) });
      }
    }
    if (evidenceRows.length > 0) {
      await svc.supportingAssets.bulkUpsertEvidence(evidenceRows);
      await svc.openaevConnector.markEvidenceWritten({ connectorId, entries: written, writtenAt: now() });
    }
    // A VULNERABILITY document is a scan of the asset, not a technique test: it writes a measurement
    // (clean or findings) and never a finding. Every delivery is offered, current or not: the upsert
    // keeps the newest scan of each (asset, scenario).
    const measurements = buildScanMeasurements({ observations, assetIdMap });
    if (measurements.length > 0) {
      await svc.openaevConnector.upsertScanMeasurements({ connectorId, measurements });
    }
    counts.read += observations.length;
    counts.written += evidenceRows.length;
    // A document that wrote a scan measurement wrote something: it is not a skip.
    const wroteSomething = new Set([...written.map((entry) => entry.observationId), ...measurements.map((row) => row.observationId)]);
    counts.skipped += observations.filter((observation) => !wroteSomething.has(observation.id)).length;
    logTrace('Attack observations written', {
      openaevTenantId,
      observations: observations.length,
      evidenceRows: evidenceRows.length,
      scanMeasurements: measurements.length,
      skippedUnknownTechniques: skippedTechniques.size,
    });
    return true;
  };

  const writeVulnerabilityPage = async (observations: Array<VulnerabilityObservation>): Promise<boolean> => {
    if (observations.length === 0) {
      return true;
    }
    const assetIdMap = await resolveAssets(observations);
    if (signal.aborted) {
      return false;
    }
    const usable = observations.filter((observation) => assetIdMap.has(observation.asset_id));
    const cveIds = [...new Set(usable.flatMap((observation) => cveIdentifierOfObservation(observation) ?? []))];
    counts.read += observations.length;
    if (cveIds.length === 0) {
      counts.skipped += observations.length;
      return true;
    }
    const evidenceRows = await inCveFindingsTransaction(async (tx) => {
      // The observations carry no CVSS or exploit data, so those fields stay null.
      await tx.cve.upsertCves(cveIds.map((cveId) => ({ cveId })));
      const cveIdMap = await tx.cve.getCveIdMap(cveIds);
      const rows = buildVulnerabilityEvidenceRows({ observations: usable, cveIdMap, assetIdMap, connectorId });
      if (rows.length > 0) {
        await tx.supportingAssets.bulkUpsertEvidence(rows);
      }
      return rows;
    });
    counts.written += evidenceRows.length;
    counts.skipped += observations.length - usable.filter((observation) => cveIdentifierOfObservation(observation) !== null).length;
    logTrace('Vulnerability observations written', { openaevTenantId, observations: observations.length, evidenceRows: evidenceRows.length });
    return true;
  };

  const states = await svc.openaevConnector.getStreamStates(connectorId);

  const syncStream = async <T extends { asset_id: string }>(
    stream: OpenaevStream,
    readPage: (cursor: string | null) => Promise<SnapshotPage<T>>,
    writePage: (observations: Array<T>) => Promise<boolean>,
  ): Promise<StreamOutcome> => {
    const key = { connectorId, openaevTenantId, stream };
    const state = states.find((candidate) => candidate.openaevTenantId === openaevTenantId && candidate.stream === stream) ?? null;
    const reconcileFrom = state?.unreconciledSince ?? runStartedAt;
    if (signal.aborted) {
      return { fullWalk: null, walked: false, reconcileFrom };
    }
    await svc.openaevConnector.markStreamUnreconciled({ ...key, since: runStartedAt });
    let cursor = state?.cursor ?? null;
    let walkStartedAt = state?.fullWalkStartedAt ?? null;
    if (walkStartedAt === null && isFullWalkDue(state, now())) {
      walkStartedAt = now();
      cursor = null;
      await svc.openaevConnector.startFullWalk({ ...key, startedAt: walkStartedAt });
    }

    let pages = 0;
    let received = 0;
    const walked = walkStartedAt !== null;
    for (;;) {
      if (signal.aborted) {
        return { fullWalk: null, walked, reconcileFrom };
      }
      const page = await readPage(cursor);
      if (signal.aborted || !(await writePage(page.observations))) {
        return { fullWalk: null, walked, reconcileFrom };
      }
      cursor = page.next_cursor ?? cursor;
      await svc.openaevConnector.saveStreamCursor({ ...key, cursor });
      pages += 1;
      received += page.observations.length;
      await onProgress?.({ stream, pages, observations: received });

      // An empty page that still claims more would hand back the cursor it was sent, forever.
      if (!page.has_more || page.observations.length === 0) {
        return {
          fullWalk: walkStartedAt === null ? null : { startedAt: walkStartedAt, ready: page.snapshot_ready },
          walked,
          reconcileFrom,
        };
      }
    }
  };

  const attack = await syncStream(
    'attack',
    (cursor) => client.searchAttackObservations(openaevTenantId, { cursor }),
    writeAttackPage,
  );
  const vulnerability = await syncStream(
    'vulnerability',
    (cursor) => client.searchVulnerabilityObservations(openaevTenantId, { cursor }),
    writeVulnerabilityPage,
  );

  return { attack, vulnerability, counts };
};
