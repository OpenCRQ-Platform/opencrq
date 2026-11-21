import { newError, StructuredError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type {
  AiTargetModality,
  AiTargetProvider,
  AssetCategory,
  AssetCriticality,
  assetEvidenceVerdicts,
  AssetManualAttribute,
  AssetSortKey,
  AssetSourceOrigin,
  AssetSubcategory,
  CloudProvider,
  EndpointArch,
  EvidenceState,
  ExpectationType,
  supportingAssetAiTargetProperties,
  SupportingAssetExposure,
  supportingAssetIdentityProperties,
  supportingAssetMachineProperties,
  supportingAssetSources,
} from './schema';
import type { AffectedAssetsFlaw, AffectedAssetSortKey, AssetCriticalityRule, AssetIdentityProvider, AssetRelationKind, AssetRelationSource, DismissalReasonCode, DismissalType, EvidenceActivityScope } from './constants';
import type { EvidenceActivityDay } from './evidence-activity';
import type { ExtractPublicFromDef, InferRepository, ServiceContext } from '../../registry';
import type { AssetManualValue, AssetObservation, AssetObservationProperties, ConnectorAssetInput, ManualAssetProperties, ReportedSoftware } from './types';
import type { IdentityFamily } from './identity-families';
import type { FindingStateRow, SourceStanding } from './finding-state';
import type { DependencyCandidateScope } from './repository';
import type { DisplayedTag, TagMergeRefusal } from './tag-merge';
import type { AssetOwnerSource, OwnerDecision } from './owner-resolution';
import type { PushedAssetGroup } from './asset-group-resolution';
import type { EventOrigin } from '../../security';
import { isForeignKeyViolationOf, isUniqueViolationOf } from '../../db/pg-errors';
import { defineService } from '../../registry';
import { originUserId, requireTenantId } from '../../security';
import { organizationsService } from '../organizations/service';
import { techniqueMappingService } from '../technique-mapping/service';
import { identityFamilyOf } from './identity-families';
import { DISMISSAL_REASON_CODES_BY_TYPE, EVIDENCE_ACTIVITY_DAYS, SUBCATEGORY_TO_CATEGORY } from './constants';
import { calendarDayIn, countSpansByDay, daysEndingOn } from './evidence-activity';
import { supportingAssetsRepository } from './repository';
import { ASSET_EVIDENCE_KEY, ASSET_EVIDENCE_UNIQUE, EVIDENCE_HISTORY_TENANT_FK, TAG_NAME_UNIQUE } from './schema';
import { normalizeAiTargetProperties, normalizeEndpointUrl, normalizeHostname, normalizeIdentifier, normalizeIdentityProperties, normalizeMachineProperties, normalizeMacs, normalizeSid } from './normalization';
import { buildAssetIdentityIndex } from './asset-identity';
import { isSourceStillReporting, sourceVerdictAt } from './evidence-source-freshness';
import { compareFindingKeys } from './finding-lock-order';
import { deriveFindingState } from './finding-state';
import { resolveAssetAttributes, resolveDerivedName, resolveObservationProperties } from './attribute-resolution';
import { computeCriticalityLifts, diffCriticalityLifts, toReprojectionBatches } from './criticality-lift';
import { assembleManagedTags, checkTagMerge, displayAssetTags, resolveTagRoot, subtreeAssetCounts } from './tag-merge';
import { normalizeManualTagNames, resolveTagOrigin } from './tag-resolution';
import { decideOwnerWrite, resolveOwner } from './owner-resolution';
import { diffMemberships, matchPushedGroup, normalizePushedGroups } from './asset-group-resolution';

// PostgreSQL limit: 65535 params per query. With ~10 cols per row, 1000 rows stays safe.
const BATCH_CHUNK_SIZE = 1000;

export class EvidenceAlreadyExistsError extends StructuredError {
  override readonly name: string = 'EvidenceAlreadyExistsError';

  constructor() {
    super('This evidence already exists', { data: {} });
  }
}

export class ConnectorBackedEvidenceError extends StructuredError {
  override readonly name: string = 'ConnectorBackedEvidenceError';

  constructor() {
    super('This finding was reported by a connector and cannot be deleted', { data: {} });
  }
}

// The policy proves only the row's own tenant: a finding outside it is refused by the foreign key that names the tenant.
const refusingForeignEvidence = async (write: () => PromiseLike<unknown>): Promise<void> => {
  try {
    await write();
  } catch (error) {
    if (isForeignKeyViolationOf(error, EVIDENCE_HISTORY_TENANT_FK)) {
      throw newError('Evidence not found');
    }
    throw error;
  }
};

// Enforces the mutual-exclusivity invariant backed by the `asset_evidence_fk_exclusive_chk`
// DB constraint: exactly one of cveId/mitreTechniqueId is set, and expectationType is
// null for CVE findings, required for MITRE technique findings.
const assertValidEvidenceFinding = (row: {
  cveId: string | null,
  mitreTechniqueId: string | null,
  expectationType: ExpectationType | null,
}) => {
  if (row.cveId && row.mitreTechniqueId) {
    throw newError('assetEvidence: cveId and mitreTechniqueId are mutually exclusive');
  }
  if (!row.cveId && !row.mitreTechniqueId) {
    throw newError('assetEvidence: exactly one of cveId or mitreTechniqueId must be set');
  }
  if (row.cveId && row.expectationType !== null) {
    throw newError('assetEvidence: expectationType must be null when cveId is set');
  }
  if (row.mitreTechniqueId && !row.expectationType) {
    throw newError('assetEvidence: expectationType must be set when mitreTechniqueId is set');
  }
};

// Mirrors the `asset_evidence_uq` DB unique constraint (nulls treated as equal). `connectorId`
// is deliberately absent: the same CVE or technique on the same asset is one finding whatever
// number of connectors report it (CAP-3); per-connector provenance lives on assetEvidenceSources.
const evidenceUniqueKey = (row: {
  supportingAssetId: string,
  cveId: string | null,
  mitreTechniqueId: string | null,
  expectationType: ExpectationType | null,
  securityPlatformType?: string | null,
  sourceScenarioId?: string | null,
}): string => JSON.stringify(ASSET_EVIDENCE_KEY.map(({ column }) => row[column] ?? null));

// `a` counts as more recent than `b` when it has a later timestamp; a null/undefined
// timestamp never wins over an actual one (an unknown observation time is treated as
// the least informative, not as "now").
const isMoreRecent = (a: Date | null | undefined, b: Date | null | undefined): boolean => {
  if (!a) {
    return false;
  }
  if (!b) {
    return true;
  }
  return a.getTime() > b.getTime();
};

/**
 * Whether observation `a` of a source, sent after `b`, replaces it: a later one does, and so does
 * one of the same instant unless it would put a not exposed result over an exposed one, since one
 * test of a run that exposes the finding is enough. The source upsert applies the same rule.
 */
const supersedes = (
  a: { evaluatedAt?: Date | null, isExposed: boolean },
  b: { evaluatedAt?: Date | null, isExposed: boolean },
): boolean => isMoreRecent(a.evaluatedAt, b.evaluatedAt)
  || ((a.evaluatedAt?.getTime() ?? null) === (b.evaluatedAt?.getTime() ?? null) && (a.isExposed || !b.isExposed));

type BulkEvidenceRow = {
  id: string,
  supportingAssetId: string,
  cveId: string | null,
  mitreTechniqueId: string | null,
  expectationType: ExpectationType | null,
  isExposed: boolean,
  securityPlatformType?: string | null,
  /** When the connector observed it. Required, or the verdict log and the source would date it differently. */
  evaluatedAt: Date,
  sourceScenarioId?: string | null,
  sourceScenarioName?: string | null,
  sourceSimulationId?: string | null,
  sourceInjectId?: string | null,
  connectorId: string,
  sourceFindingId: string,
  /** Which repeated probe made this assertion, matched against the connector's enumeration marks. */
  scope?: string,
  externalReference?: string | null,
  reportedSeverity?: string | null,
  reason?: string | null,
  /** The whole list the source now names, replacing the one it held unless the source holds a newer observation. Absent, the held list stays. */
  software?: ReadonlyArray<ReportedSoftware>,
};

type UpsertedEvidenceRow = {
  id: string,
  isNew: boolean,
  supportingAssetId: string,
  cveId: string | null,
  mitreTechniqueId: string | null,
  expectationType: ExpectationType | null,
  securityPlatformType: string | null,
  sourceScenarioId: string | null,
};

type EvidenceSourceRefsUpdateRow = {
  id: string,
  sourceScenarioName: string | null,
  sourceSimulationId: string | null,
  sourceInjectId: string | null,
};

const dedupeEvidenceByMostRecent = (evidences: Array<BulkEvidenceRow>): Array<BulkEvidenceRow> => {
  const mostRecentByKey = new Map<string, BulkEvidenceRow>();
  for (const evidence of evidences) {
    const key = evidenceUniqueKey(evidence);
    const current = mostRecentByKey.get(key);
    if (!current || supersedes(evidence, current)) {
      mostRecentByKey.set(key, evidence);
    }
  }
  return [...mostRecentByKey.values()];
};

// One source row per (finding, connector, source finding id), the key the source upsert conflicts
// on: two sources of one connector reporting the same finding, such as two of its assets folded
// onto one, each keep their own row.
const dedupeSourcesByMostRecent = (evidences: Array<BulkEvidenceRow>): Array<BulkEvidenceRow> => {
  const mostRecentByKey = new Map<string, BulkEvidenceRow>();
  for (const evidence of evidences) {
    const key = JSON.stringify([evidenceUniqueKey(evidence), evidence.connectorId, evidence.sourceFindingId]);
    const current = mostRecentByKey.get(key);
    if (!current || supersedes(evidence, current)) {
      mostRecentByKey.set(key, evidence);
    }
  }
  return [...mostRecentByKey.values()];
};

const sourceKey = (assetEvidenceId: string, connectorId: string | null, sourceFindingId: string | null) =>
  JSON.stringify([assetEvidenceId, connectorId, sourceFindingId]);

type SourceStandingRow = { isExposed: boolean, evaluatedAt: Date | null };

/**
 * The verdicts of a batch that change what their source stands on: its first verdict, then each
 * that differs from the one before it. An observation that does not supersede the verdict its
 * source holds changes nothing, as the source upsert keeps that verdict.
 */
const buildVerdictChanges = (params: {
  evidences: Array<BulkEvidenceRow>,
  upsertedByKey: ReadonlyMap<string, UpsertedEvidenceRow>,
  standings: ReadonlyMap<string, SourceStandingRow>,
  tenantId: string,
  now: Date,
}): Array<typeof assetEvidenceVerdicts.$inferInsert> => {
  const observationsBySource = new Map<string, { assetEvidenceId: string, rows: Array<BulkEvidenceRow> }>();
  for (const evidence of params.evidences) {
    const upserted = params.upsertedByKey.get(evidenceUniqueKey(evidence));
    if (!upserted) {
      continue;
    }
    const key = sourceKey(upserted.id, evidence.connectorId, evidence.sourceFindingId);
    const entry = observationsBySource.get(key) ?? { assetEvidenceId: upserted.id, rows: [] };
    entry.rows.push(evidence);
    observationsBySource.set(key, entry);
  }

  const observedAt = (row: BulkEvidenceRow) => row.evaluatedAt.getTime();
  return [...observationsBySource].flatMap(([key, { assetEvidenceId, rows }]) => {
    let standing = params.standings.get(key);
    const changes: Array<typeof assetEvidenceVerdicts.$inferInsert> = [];
    // Ordered so the observation `supersedes` keeps comes last among those of one instant.
    const sorted = rows.toSorted((a, b) => observedAt(a) - observedAt(b) || Number(a.isExposed) - Number(b.isExposed));
    const lastOfEachInstant = sorted.filter((row, index) => {
      const next = sorted[index + 1];
      return next === undefined || observedAt(next) !== observedAt(row);
    });
    for (const row of lastOfEachInstant) {
      if (standing && !supersedes(row, standing)) {
        continue;
      }
      if (standing?.isExposed !== row.isExposed) {
        changes.push({
          id: uuidv7(),
          tenantId: params.tenantId,
          assetEvidenceId,
          connectorId: row.connectorId,
          sourceFindingId: row.sourceFindingId,
          isExposed: row.isExposed,
          observedAt: row.evaluatedAt,
          recordedAt: params.now,
        });
      }
      standing = { isExposed: row.isExposed, evaluatedAt: row.evaluatedAt };
    }
    return changes;
  });
};

type SupportingAssetsRepo = InferRepository<typeof supportingAssetsRepository>;

/**
 * Refuses a step locking findings in a transaction that already locked or wrote one: each
 * step takes its set in the one order (`compareFindingKeys`), but a set taken while the transaction
 * holds another finding is out of that order, so the transaction can deadlock with another writer.
 * `atomic` joins an outer transaction, so this would otherwise go unnoticed until it deadlocks under
 * concurrency.
 */
const claimFindingLocks = async (repo: SupportingAssetsRepo): Promise<void> => {
  if (await repo.holdsFindingLocks()) {
    throw newError('A transaction locks findings in one step, and this one already holds some');
  }
};

/**
 * Appends, dated now, the history row each finding's sources call for (`deriveFindingState`), over
 * the given findings, or over the findings of the given assets the caller holds locked. A finding
 * no connector reports is left alone. Returns the rows written, each with the state its finding
 * held before.
 */
const rederiveFindings = async (
  repo: SupportingAssetsRepo,
  tenantId: string,
  scope: { assetIds: Array<string>, lockedIds: ReadonlySet<string> } | { evidenceIds: Array<string> },
  retirementReason: string | null,
) => {
  const ids = 'assetIds' in scope ? scope.assetIds : scope.evidenceIds;
  const sourcesByEvidenceId = new Map<string, Array<SourceStanding>>();
  for (let i = 0; i < ids.length; i += BATCH_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + BATCH_CHUNK_SIZE);
    for (const source of await repo.findEvidenceSourceVerdicts('assetIds' in scope ? { assetIds: chunk } : { evidenceIds: chunk })) {
      // A finding a sync created after the lock is not held, and its sync derived it already.
      if ('lockedIds' in scope && !scope.lockedIds.has(source.assetEvidenceId)) {
        continue;
      }
      const sources = sourcesByEvidenceId.get(source.assetEvidenceId) ?? [];
      sources.push({
        id: source.id,
        verdictAt: sourceVerdictAt(source),
        exposed: source.isExposed,
        reporting: isSourceStillReporting(source),
        reason: source.reason,
      });
      sourcesByEvidenceId.set(source.assetEvidenceId, sources);
    }
  }

  const evidenceIds = [...sourcesByEvidenceId.keys()];
  const latestByEvidenceId = new Map<string, FindingStateRow>();
  const handedBackAtByEvidenceId = new Map<string, Date>();
  for (let i = 0; i < evidenceIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = evidenceIds.slice(i, i + BATCH_CHUNK_SIZE);
    for (const row of await repo.findLatestStatesByEvidenceIds(chunk)) {
      latestByEvidenceId.set(row.assetEvidenceId, row);
    }
    for (const row of await repo.findLatestResetsByEvidenceIds(chunk)) {
      handedBackAtByEvidenceId.set(row.assetEvidenceId, row.stateChangedAt);
    }
  }

  const now = new Date();
  const written = [...sourcesByEvidenceId].flatMap(([assetEvidenceId, sources]) => {
    const latest = latestByEvidenceId.get(assetEvidenceId) ?? null;
    const derived = deriveFindingState({
      sources,
      latest,
      handedBackAt: handedBackAtByEvidenceId.get(assetEvidenceId) ?? null,
      retirementReason,
    });
    return derived === null ? [] : [{
      row: {
        id: uuidv7(),
        tenantId,
        assetEvidenceId,
        stateChangedAt: now,
        observedAt: derived.observedAt,
        state: derived.state,
        reason: derived.reason,
        changedByUserId: null,
        origin: derived.origin,
      },
      previousState: latest?.state ?? null,
    }];
  });
  for (let i = 0; i < written.length; i += BATCH_CHUNK_SIZE) {
    await repo.insertEvidenceHistoryBatch(written.slice(i, i + BATCH_CHUNK_SIZE).map(({ row }) => row));
  }
  return written;
};

type EvidenceWriteContext = Omit<
  ServiceContext<
    InferRepository<typeof supportingAssetsRepository>,
    { techniqueMapping: ExtractPublicFromDef<typeof techniqueMappingService> }
  >,
  'atomic'
>;

const upsertEvidenceBatch = async (
  { repo, deps, eventOrigin }: EvidenceWriteContext,
  evidences: Array<BulkEvidenceRow>,
): Promise<void> => {
  if (!('tenantId' in eventOrigin)) {
    throw newError('Tenant context required');
  }
  for (const row of evidences) {
    assertValidEvidenceFinding(row);
  }
  await claimFindingLocks(repo);
  // Collapse duplicates targeting the same DB row before the upsert: Postgres rejects a
  // batch INSERT ... ON CONFLICT that targets the same row twice. Keep the most recent
  // evaluatedAt among duplicates. The upsert locks its rows in batch order, so the batch is sorted
  // into the one order findings are locked in (`compareFindingKeys`).
  const dedupedForUpsert = dedupeEvidenceByMostRecent(evidences).toSorted(compareFindingKeys);

  const upsertResults: Array<UpsertedEvidenceRow> = [];
  for (let i = 0; i < dedupedForUpsert.length; i += BATCH_CHUNK_SIZE) {
    const chunk = dedupedForUpsert.slice(i, i + BATCH_CHUNK_SIZE);
    const results = await repo.upsertAssetEvidenceBatch(chunk.map((e) => ({
      ...e,
      tenantId: eventOrigin.tenantId,
      userId: null,
    })));
    upsertResults.push(...results);
  }
  // Resolves every original evidence row (including duplicates collapsed above) to its
  // real DB id, which on conflict differs from the id we attempted to insert.
  const upsertedByKey = new Map(upsertResults.map((r) => [evidenceUniqueKey(r), r]));
  const evidenceIds = upsertResults.map((r) => r.id);

  const standings = new Map<string, SourceStandingRow>();
  for (let i = 0; i < evidenceIds.length; i += BATCH_CHUNK_SIZE) {
    for (const row of await repo.findEvidenceSourceStandings(evidenceIds.slice(i, i + BATCH_CHUNK_SIZE))) {
      standings.set(sourceKey(row.assetEvidenceId, row.connectorId, row.sourceFindingId), row);
    }
  }
  const now = new Date();
  const verdictRows = buildVerdictChanges({ evidences, upsertedByKey, standings, tenantId: eventOrigin.tenantId, now });

  // Per-source observation: one row per canonical finding for this connector's own sync,
  // carrying its own first/last seen and reported severity (CAP-4/CAP-5).
  const sourceReports = dedupeSourcesByMostRecent(evidences).flatMap((e) => {
    const upserted = upsertedByKey.get(evidenceUniqueKey(e));
    if (!upserted) {
      return [];
    }
    return [{ software: e.software, row: {
      id: uuidv7(),
      tenantId: eventOrigin.tenantId,
      assetEvidenceId: upserted.id,
      connectorId: e.connectorId,
      sourceFindingId: e.sourceFindingId,
      scope: e.scope ?? '',
      isExposed: e.isExposed,
      reason: e.reason ?? null,
      externalReference: e.externalReference ?? null,
      reportedSeverity: e.reportedSeverity ?? null,
      firstSeenAt: e.evaluatedAt,
      lastSeenAt: e.evaluatedAt,
      // The sync clock, never the connector's evaluation time: this is what the derived state
      // compares against the mark of the run that walked the asset.
      lastReportedAt: now,
      evaluatedAt: e.evaluatedAt,
    } }];
  });
  const sourceRows = sourceReports.map(({ row }) => row);
  for (let i = 0; i < sourceRows.length; i += BATCH_CHUNK_SIZE) {
    await repo.upsertAssetEvidenceSourceBatch(sourceRows.slice(i, i + BATCH_CHUNK_SIZE));
  }
  const softwareReports = sourceReports.flatMap(({ row, software }) => {
    const standing = standings.get(sourceKey(row.assetEvidenceId, row.connectorId, row.sourceFindingId));
    return software === undefined || (standing && !supersedes(row, standing)) ? [] : [{
      assetEvidenceId: row.assetEvidenceId,
      connectorId: row.connectorId,
      sourceFindingId: row.sourceFindingId,
      software,
    }];
  });
  for (let i = 0; i < softwareReports.length; i += BATCH_CHUNK_SIZE) {
    await repo.writeEvidenceSourceSoftware(eventOrigin.tenantId, softwareReports.slice(i, i + BATCH_CHUNK_SIZE));
  }
  for (let i = 0; i < verdictRows.length; i += BATCH_CHUNK_SIZE) {
    await repo.insertEvidenceVerdictBatch(verdictRows.slice(i, i + BATCH_CHUNK_SIZE));
  }

  // A finding whose state this batch moved points at the observation of the batch that agrees
  // with its new state, the latest one, rather than at the one it last pointed to.
  const changedEvidenceIds = new Map((await rederiveFindings(repo, eventOrigin.tenantId, { evidenceIds }, null))
    .map(({ row }) => [row.assetEvidenceId, row.state]));
  const agreeingByEvidenceId = new Map<string, BulkEvidenceRow>();
  for (const evidence of evidences) {
    const evidenceId = upsertedByKey.get(evidenceUniqueKey(evidence))?.id;
    const changedTo = evidenceId === undefined ? undefined : changedEvidenceIds.get(evidenceId);
    if (evidenceId === undefined || changedTo === undefined || evidence.isExposed !== (changedTo === 'applicable')) {
      continue;
    }
    const current = agreeingByEvidenceId.get(evidenceId);
    if (!current || supersedes(evidence, current)) {
      agreeingByEvidenceId.set(evidenceId, evidence);
    }
  }
  const sourceRefsUpdates: Array<EvidenceSourceRefsUpdateRow> = [...agreeingByEvidenceId].map(([id, evidence]) => ({
    id,
    sourceScenarioName: evidence.sourceScenarioName ?? null,
    sourceSimulationId: evidence.sourceSimulationId ?? null,
    sourceInjectId: evidence.sourceInjectId ?? null,
  }));
  for (let i = 0; i < sourceRefsUpdates.length; i += BATCH_CHUNK_SIZE) {
    await repo.updateEvidenceSourceRefsBatch(sourceRefsUpdates.slice(i, i + BATCH_CHUNK_SIZE));
  }

  await deps.techniqueMapping.resolveTechniquesForCves(
    upsertResults.map((row) => row.cveId).filter((cveId) => cveId !== null),
  );
};

/** The per-family property block a left-joined row carries — shared shape between `AssetObservation` and the tRPC-facing source DTO. */
interface JoinedPropertyColumns {
  machineProperties: {
    tenantId: string,
    hostname: string | null,
    ipAddresses: ReadonlyArray<string> | null,
    macAddresses: ReadonlyArray<string> | null,
    seenIp: string | null,
    hardwareUuid: string | null,
    directoryDeviceId: string | null,
    cloudVmId: string | null,
    cloudResourceId: string | null,
    cloudProvider: CloudProvider | null,
    cloudNativeType: string | null,
    cloudRegion: string | null,
    platform: string | null,
    arch: EndpointArch | null,
    vendor: string | null,
    model: string | null,
    operatingSystem: string | null,
    osVersion: string | null,
    isEol: boolean | null,
    agentExternalReference: string | null,
    agentExecutorType: string | null,
  } | null,
  aiTargetProperties: {
    tenantId: string,
    provider: AiTargetProvider | null,
    endpointUrl: string | null,
    normalizedEndpointUrl: string | null,
    model: string | null,
    modality: AiTargetModality | null,
    systemPrompt: string | null,
  } | null,
  identityProperties: {
    tenantId: string,
    directoryObjectId: string | null,
    cloudSid: string | null,
    onPremSid: string | null,
    userPrincipalName: string | null,
    accountDomain: string | null,
    accountName: string | null,
    directoryType: string | null,
    identityProvider: AssetIdentityProvider | null,
    department: string | null,
    jobTitle: string | null,
    isEnabled: boolean | null,
    assignedRoles: ReadonlyArray<string> | null,
    privilegedPimRoles: ReadonlyArray<string> | null,
  } | null,
}

/**
 * Discriminates a left-joined row's per-family block. Drizzle nulls out a whole nested-selection
 * object (`machineProperties`, `aiTargetProperties`, `identityProperties`) when its left join finds no row, rather than
 * each of its columns individually, which is exactly the "no properties" case this maps onto
 * `undefined`. A connector's row carries at most one block, but the manual one can carry
 * several: a person who moves an asset to another family keeps what they typed for the first, so a
 * wrong category pick can be undone. `family` is the one block the caller wants, and the other
 * is left unread.
 * `selectAssetObservations` (repository.ts) is the other half building the shape this reads, and
 * the two must agree.
 */
const toObservationProperties = (row: JoinedPropertyColumns, family: IdentityFamily): AssetObservationProperties | undefined => {
  const machine: AssetObservationProperties | undefined = row.machineProperties === null ? undefined : {
    family: 'machine' as const,
    hostname: row.machineProperties.hostname,
    ipAddresses: row.machineProperties.ipAddresses ?? [],
    macAddresses: row.machineProperties.macAddresses ?? [],
    seenIp: row.machineProperties.seenIp,
    hardwareUuid: row.machineProperties.hardwareUuid,
    directoryDeviceId: row.machineProperties.directoryDeviceId,
    cloudVmId: row.machineProperties.cloudVmId,
    cloudResourceId: row.machineProperties.cloudResourceId,
    cloudProvider: row.machineProperties.cloudProvider,
    cloudNativeType: row.machineProperties.cloudNativeType,
    cloudRegion: row.machineProperties.cloudRegion,
    platform: row.machineProperties.platform,
    arch: row.machineProperties.arch,
    vendor: row.machineProperties.vendor,
    model: row.machineProperties.model,
    operatingSystem: row.machineProperties.operatingSystem,
    osVersion: row.machineProperties.osVersion,
    isEol: row.machineProperties.isEol,
    agentExternalReference: row.machineProperties.agentExternalReference,
    agentExecutorType: row.machineProperties.agentExecutorType,
  };
  const aiTarget: AssetObservationProperties | undefined = row.aiTargetProperties === null ? undefined : {
    family: 'ai_target' as const,
    provider: row.aiTargetProperties.provider,
    endpointUrl: row.aiTargetProperties.endpointUrl,
    normalizedEndpointUrl: row.aiTargetProperties.normalizedEndpointUrl,
    model: row.aiTargetProperties.model,
    modality: row.aiTargetProperties.modality,
    systemPrompt: row.aiTargetProperties.systemPrompt,
  };
  const identity: AssetObservationProperties | undefined = row.identityProperties === null ? undefined : {
    family: 'identity' as const,
    directoryObjectId: row.identityProperties.directoryObjectId,
    cloudSid: row.identityProperties.cloudSid,
    onPremSid: row.identityProperties.onPremSid,
    userPrincipalName: row.identityProperties.userPrincipalName,
    accountDomain: row.identityProperties.accountDomain,
    accountName: row.identityProperties.accountName,
    directoryType: row.identityProperties.directoryType,
    identityProvider: row.identityProperties.identityProvider,
    department: row.identityProperties.department,
    jobTitle: row.identityProperties.jobTitle,
    isEnabled: row.identityProperties.isEnabled,
    assignedRoles: row.identityProperties.assignedRoles ?? [],
    privilegedPimRoles: row.identityProperties.privilegedPimRoles ?? [],
  };
  return [machine, aiTarget, identity].find((block) => block?.family === family);
};

/**
 * Maps a stored/candidate observation row (repo shape) to the pure-logic `AssetObservation`
 * shape. `selectAssetObservations` (repository.ts) is the other half building this same shape,
 * and the two must agree. Its block is the one of `family`; the others are kept out of it.
 */
const toObservationOfFamily = (row: {
  id: string,
  assetCategoryId: AssetCategory,
  connectorId: string | null,
  origin: AssetSourceOrigin,
  source: string | null,
  sourceAssetId: string,
  reportedName: string | null,
  reportedCategoryId: AssetCategory,
  reportedSubcategoryId: AssetSubcategory | null,
  reportedDescription: string | null,
  reportedExposure: SupportingAssetExposure,
  reportedCriticality: AssetCriticality,
  externalReference: string | null,
  reportedUrl: string | null,
  reportedLinkedPerson: string | null,
  firstSeenAt: Date | null,
  lastSeenAt: Date | null,
  sourceLastActivityAt: Date,
} & JoinedPropertyColumns, family: IdentityFamily): AssetObservation => ({
  id: row.id,
  connectorId: row.connectorId,
  origin: row.origin,
  source: row.source,
  sourceAssetId: row.sourceAssetId,
  reportedName: row.reportedName,
  reportedCategoryId: row.reportedCategoryId,
  reportedSubcategoryId: row.reportedSubcategoryId,
  reportedDescription: row.reportedDescription,
  reportedExposure: row.reportedExposure,
  reportedCriticality: row.reportedCriticality,
  externalReference: row.externalReference,
  reportedUrl: row.reportedUrl,
  reportedLinkedPerson: row.reportedLinkedPerson,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
  sourceLastActivityAt: row.sourceLastActivityAt,
  properties: toObservationProperties(row, family),
});

/** The observation as the asset's current family reads it. */
const toAssetObservation = (row: Parameters<typeof toObservationOfFamily>[0]): AssetObservation =>
  toObservationOfFamily(row, identityFamilyOf(row.assetCategoryId));

interface SourceRow {
  supportingAssetId: string,
  connectorId: string | null,
  origin: AssetSourceOrigin,
  source: string | null,
  sourceAssetId: string,
  firstSeenAt: Date | null,
  lastSeenAt: Date | null,
  sourceLastActivityAt: Date,
  reportedName: string | null,
  reportedDescription: string | null,
  reportedCategoryId: AssetCategory,
  reportedSubcategoryId: AssetSubcategory | null,
  reportedExposure: SupportingAssetExposure,
  reportedCriticality: AssetCriticality,
  reportedCriticalityRule: AssetCriticalityRule | null,
  reportedUrl: string | null,
  reportedLinkedPerson: string | null,
}

/**
 * The Sources card's own row: what each connector reported, stripped of every family block. Which
 * block speaks for the asset is `resolveAssetProperties`' answer, one per asset rather than one per
 * source, so `sourceLastActivityAt` — the ranking's own key — never has to leave the service.
 *
 * Every block of `JoinedPropertyColumns` has to be named here. One left out rides along in the rest,
 * which nothing else rejects: an integration test asserts the keys a summary carries.
 */
const toSourceSummary = (
  { machineProperties, aiTargetProperties, identityProperties, sourceLastActivityAt, ...common }: SourceRow & JoinedPropertyColumns,
): Omit<SourceRow, 'sourceLastActivityAt'> => common;

/**
 * The block of `family` that speaks for the asset, ranked exactly as every other resolved
 * attribute is. Never a block of another family: the edit drawer offers only the current family's
 * fields, so the reader could not correct a card of another family.
 */
const resolveAssetProperties = (rows: Array<SourceRow & JoinedPropertyColumns>, family: IdentityFamily): AssetObservationProperties | null =>
  resolveObservationProperties(rows.map((row) => ({
    source: row.source,
    origin: row.origin,
    sourceAssetId: row.sourceAssetId,
    sourceLastActivityAt: row.sourceLastActivityAt,
    properties: toObservationProperties(row, family),
  })));

/** The families a person can type a block for. */
const PROPERTY_FAMILIES = ['machine', 'ai_target', 'identity'] as const satisfies ReadonlyArray<IdentityFamily>;

const toManualValue = (row: { attribute: AssetManualAttribute, value: string | null }): AssetManualValue | null =>
  (row.value === null ? null : { attribute: row.attribute, value: row.value });

type ObservationRow = Parameters<typeof toObservationOfFamily>[0];

const NAMING_FAMILIES = ['machine', 'identity', 'ai_target'] as const satisfies ReadonlyArray<IdentityFamily>;

/**
 * An unclassified asset has no property block of its own family, yet a connector files devices
 * there with a machine block: it is named by the first family whose block its sources carry. Every
 * other asset is named from the block of its own family, as `getSupportingAsset` reads it.
 */
const deriveNameFromRows = (rows: ReadonlyArray<ObservationRow>): string | null => {
  if (rows.length === 0) {
    return null;
  }
  if (identityFamilyOf(rows[0].assetCategoryId) !== 'unclassified') {
    return resolveDerivedName(rows.map((row) => toAssetObservation(row)));
  }
  for (const family of NAMING_FAMILIES) {
    const name = resolveDerivedName(rows.map((row) => toObservationOfFamily(row, family)));
    if (name !== null) {
      return name;
    }
  }
  return null;
};

/** Reads the manual observation too, unlike `resolveAssetAttributes`: a hostname typed by hand names the asset. */
const writeDerivedNames = (
  repo: SupportingAssetsRepo,
  assetIds: ReadonlyArray<string>,
  rowsByAssetId: ReadonlyMap<string, ReadonlyArray<ObservationRow>>,
) => repo.updateDerivedNames(assetIds.map((id) => ({ id, derivedName: deriveNameFromRows(rowsByAssetId.get(id) ?? []) })));

const refreshDerivedName = async (repo: SupportingAssetsRepo, assetId: string) => {
  const rows = await repo.findAssetObservationsByAssetIds([assetId]);
  await writeDerivedNames(repo, [assetId], new Map([[assetId, rows]]));
};

/**
 * Re-derives these assets from what is on file: their observations, their hand-set values and their
 * lift. An asset left with no connector observation keeps the values it has, since reprojecting
 * from none would blank a name and a band its hand-set values still explain.
 */
const reprojectAssets = async (repo: SupportingAssetsRepo, assetIds: Array<string>) => {
  if (assetIds.length === 0) {
    return;
  }
  await repo.lockSupportingAssetsForReprojection(assetIds);
  const observations = await repo.findAssetObservationsByAssetIds(assetIds);
  const manualValueRows = await repo.findManualValuesByAssetIds(assetIds);
  const lifts = await repo.findCriticalityLiftsByAssetIds(assetIds);
  const manualByAssetId = groupBy(manualValueRows, (r) => r.supportingAssetId);
  const observationsByAssetId = groupBy(observations, (r) => r.supportingAssetId);
  const liftByAssetId = new Map(lifts.map((lift) => [lift.supportingAssetId, lift.criticality]));
  const assetObservationsById = new Map(assetIds.map((id) => [id, (observationsByAssetId.get(id) ?? []).map(toAssetObservation)]));
  const observedIds = assetIds.filter((id) => (observationsByAssetId.get(id) ?? []).some((row) => row.origin !== 'user'));
  await repo.reprojectSupportingAssets(observedIds
    .map((id) => ({
      id,
      ...resolveAssetAttributes(
        assetObservationsById.get(id)!,
        (manualByAssetId.get(id) ?? []).map(toManualValue).filter((v): v is AssetManualValue => v !== null),
        liftByAssetId.get(id) ?? null,
      ),
    })));
  await writeDerivedNames(repo, observedIds, observationsByAssetId);
};

/** The delete cascades the scope mappings away, which no delta reports: the scopes are stamped first, in the same transaction. */
const deleteAssetsAndStampEstate = async (
  repo: SupportingAssetsRepo,
  deps: { organizations: { markEstateChangedByAssets: (ids: Array<string>) => Promise<void> } },
  ids: Array<string>,
) => {
  await deps.organizations.markEstateChangedByAssets(ids);
  return await repo.deleteSupportingAssets(ids);
};

/** Narrows a connector input's properties to the `machine` variant, for the identity set builder. */
const machineProps = (a: ConnectorAssetInput) => (a.properties?.family === 'machine' ? a.properties : undefined);

/** One machine identifier off a connector input, as a 0-or-1-element array ready for `flatMap`. */
const machinePropValue = (a: ConnectorAssetInput, key: 'hardwareUuid' | 'directoryDeviceId' | 'cloudVmId' | 'cloudResourceId' | 'agentExternalReference'): Array<string> => {
  const value = machineProps(a)?.[key];
  return value ? [value] : [];
};

/** Groups a flat rows-per-source list by its owning entity id, for attaching a `sources` array. */
const groupBy = <T, K>(rows: Array<T>, keyOf: (row: T) => K): Map<K, Array<T>> => {
  const map = new Map<K, Array<T>>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = map.get(key) ?? [];
    group.push(row);
    map.set(key, group);
  }
  return map;
};

/** What a generic asset's overview call carries beyond its identity, as a connector's source reports it. */
interface ReportedOverviewFields {
  description: string | null,
  url: string | null,
  linkedPerson: string | null,
}

/** A classification an API caller sent that no asset can hold: the enums alone allow any pair. */
export class InvalidAssetClassificationError extends StructuredError {
  override readonly name: string = 'InvalidAssetClassificationError';

  constructor(messageKey: string) {
    super(messageKey, { data: {} });
  }
}

/** An asset id the caller's tenant cannot see: unknown, or another tenant's. */
export class SupportingAssetNotFoundError extends StructuredError {
  override readonly name: string = 'SupportingAssetNotFoundError';

  constructor() {
    super('Supporting asset not found', { data: {} });
  }
}

/** A CVE id the caller's tenant cannot see: unknown, or another tenant's. */
export class CveNotFoundError extends StructuredError {
  override readonly name: string = 'CveNotFoundError';

  constructor() {
    super('CVE not found', { data: {} });
  }
}

/** A tag id the caller's tenant cannot see: unknown, or another tenant's. */
export class TagNotFoundError extends StructuredError {
  override readonly name: string = 'TagNotFoundError';

  constructor() {
    super('Tag not found', { data: {} });
  }
}

/** A tag name another tag of the tenant already holds, merged or not. */
export class TagNameTakenError extends StructuredError {
  override readonly name: string = 'TagNameTakenError';

  constructor() {
    super('This tag name is already taken', { data: {} });
  }
}

export class TagMergeRefusedError extends StructuredError<{ reason: TagMergeRefusal | 'notMerged' }> {
  override readonly name: string = 'TagMergeRefusedError';

  constructor(reason: TagMergeRefusal | 'notMerged') {
    super('This tag merge is refused', { data: { reason } });
  }
}

const assertSubcategoryWithin = (subcategoryId: AssetSubcategory | null | undefined, categoryId: AssetCategory): void => {
  if (subcategoryId != null && SUBCATEGORY_TO_CATEGORY[subcategoryId] !== categoryId) {
    throw new InvalidAssetClassificationError('This subcategory does not belong to the asset category');
  }
};

/**
 * Writes the family block a person types by hand as one more observation — a
 * `supportingAssetSources` row with `origin: 'user'` and its own `machine`/`ai_target`/`identity`
 * property row — normalised exactly as a connector's own input (`bulkUpsertAssets`), so it
 * enters the identity matcher on equal footing and a matching connector can adopt the asset
 * later. The scalar attributes never go through here: the calling `createSupportingAsset` or
 * `updateSupportingAsset` pins them in `supportingAssetManualValues`, and this observation is
 * never read for them (`resolveAssetAttributes` filters out `origin: 'user'`).
 * The other family's row is kept, unlike a connector's own reclassification in
 * `bulkUpsertAssets`: a person who picked the wrong category gets what they typed back by picking
 * the right one again. Out of the current family, it is neither shown nor matched on.
 */
const writeManualAssetProperties = async (
  repo: SupportingAssetsRepo,
  tenantId: string,
  assetId: string,
  categoryId: AssetCategory,
  properties: ManualAssetProperties,
) => {
  // A block of another family would be indexed with the category's matcher and shown on the wrong card.
  if (identityFamilyOf(categoryId) !== properties.family) {
    throw new InvalidAssetClassificationError('These properties do not belong to the asset category');
  }
  const existing = await repo.findManualSourceByAssetId(assetId);
  const [upserted] = await repo.upsertSupportingAssetSourceBatch([{
    id: existing?.id ?? uuidv7(),
    supportingAssetId: assetId,
    tenantId,
    connectorId: null,
    origin: 'user',
    sourceAssetId: assetId,
    reportedCategoryId: categoryId,
    reportedExposure: 'unknown',
    reportedCriticality: 'unknown',
    // An observation clock, not a person's: a manual entry is never "seen" at an instant.
    firstSeenAt: null,
    lastSeenAt: null,
  }]);
  // The guarded upsert returns nothing for a source whose reported columns did not change.
  const sourceId = upserted?.id ?? existing?.id;
  if (sourceId === undefined) {
    throw newError('The manual source of the asset could not be written');
  }

  if (properties.family === 'machine') {
    await repo.upsertMachinePropertiesBatch([{
      id: sourceId,
      supportingAssetSourceId: sourceId,
      tenantId,
      ...normalizeMachineProperties(properties),
    }]);
  } else if (properties.family === 'ai_target') {
    await repo.upsertAiTargetPropertiesBatch([{
      id: sourceId,
      supportingAssetSourceId: sourceId,
      tenantId,
      ...normalizeAiTargetProperties(properties),
    }]);
  } else {
    await repo.upsertIdentityPropertiesBatch([{
      id: sourceId,
      supportingAssetSourceId: sourceId,
      tenantId,
      ...normalizeIdentityProperties(properties),
    }]);
  }
};

/**
 * The owner write of a create or an update. An `ownerId` given outright is a person's choice
 * (`manual`) and wins over a name; otherwise an `ownerName` is resolved against the tenant's members
 * (`decideOwnerWrite`), so a push sending `ownerId: null` with a name never clears an owner. A null
 * `ownerId` with no name clears it; neither leaves it as it is.
 */
const decideAssetOwner = async (
  repo: SupportingAssetsRepo,
  tenantId: string,
  ownerId: string | null | undefined,
  ownerName: string | null,
  current: { ownerId: string | null, ownerSource: AssetOwnerSource | null } | null,
): Promise<{ write?: { ownerId: string | null, ownerSource: AssetOwnerSource | null }, report: OwnerDecision['report'] | null }> => {
  if (ownerId) {
    return { write: { ownerId, ownerSource: 'manual' }, report: null };
  }
  if (ownerName === null) {
    return ownerId === null ? { write: { ownerId: null, ownerSource: null }, report: null } : { report: null };
  }
  return decideOwnerWrite(ownerName, current, resolveOwner(ownerName, await repo.findOwnerCandidates(tenantId, ownerName)));
};

/**
 * The ids of the groups a push names, each matched by `matchPushedGroup` and created when none is
 * designated. A group matched on its reference is renamed, one matched on its name is given the
 * reference, a connector's group is linked to and never changed.
 */
const resolvePushedGroupIds = async (repo: SupportingAssetsRepo, tenantId: string, groups: ReadonlyArray<PushedAssetGroup>): Promise<Array<string>> => {
  const pushed = normalizePushedGroups(groups);
  if (pushed.length === 0) {
    return [];
  }
  const stored = [...await repo.findAssetGroups()];
  const ids: Array<string> = [];
  for (const group of pushed) {
    const match = matchPushedGroup(group, stored);
    if (match.action === 'create') {
      const id = uuidv7();
      await repo.insertAssetGroup({ id, tenantId, name: match.name, externalReference: match.externalReference });
      stored.push({ id, name: match.name, description: null, externalReference: match.externalReference, connectorId: null, sourceGroupId: null });
      ids.push(id);
    } else {
      if (match.update) {
        await repo.updateAssetGroup(match.groupId, match.update);
      }
      ids.push(match.groupId);
    }
  }
  return [...new Set(ids)];
};

/**
 * Makes one author's memberships of the given assets equal to `wanted`, as a diff: the rows of other
 * authors (a connector's, a person's, XTM One's) on the same assets are never touched.
 */
const replaceAuthorMemberships = async (
  repo: SupportingAssetsRepo,
  tenantId: string,
  author: { source: 'manual' | 'xtm_one', authorUserId: string | null } | { source: 'connector', connectorId: string },
  supportingAssetIds: Array<string>,
  wanted: Array<{ assetGroupId: string, supportingAssetId: string }>,
) => {
  if (supportingAssetIds.length === 0) {
    return;
  }
  const held = await repo.findGroupMembershipsOfAuthor(
    author.source === 'connector' ? { source: 'connector', connectorId: author.connectorId } : { source: author.source },
    supportingAssetIds,
  );
  const { staleIds, missing } = diffMemberships(held, wanted);
  await repo.deleteGroupMembers(staleIds);
  await repo.insertGroupMembers(missing.map((row) => ({
    id: uuidv7(),
    tenantId,
    assetGroupId: row.assetGroupId,
    supportingAssetId: row.supportingAssetId,
    source: author.source,
    connectorId: author.source === 'connector' ? author.connectorId : null,
    authorUserId: author.source === 'connector' ? null : author.authorUserId,
  })));
};

/**
 * The author of a membership written through the asset API: a person's own call is `manual`, a
 * service account's call is an XTM One push. A connector sync writes its groups through
 * `syncConnectorAssetGroups`, never through this path.
 */
const membershipAuthorOf = (eventOrigin: EventOrigin): { source: 'manual' | 'xtm_one', authorUserId: string | null } =>
  eventOrigin.type === 'client'
    ? { source: 'manual', authorUserId: originUserId(eventOrigin) ?? null }
    : { source: 'xtm_one', authorUserId: null };

const writeAssetGroupsOfPush = async (
  repo: SupportingAssetsRepo,
  eventOrigin: EventOrigin,
  tenantId: string,
  assetId: string,
  groups: ReadonlyArray<PushedAssetGroup>,
) => {
  const groupIds = await resolvePushedGroupIds(repo, tenantId, groups);
  await replaceAuthorMemberships(repo, tenantId, membershipAuthorOf(eventOrigin), [assetId], groupIds.map((assetGroupId) => ({ assetGroupId, supportingAssetId: assetId })));
};

/**
 * Resolves the names a person typed to canonical tag ids, then replaces what they assert on the
 * asset through `setAssetTagsBatch` with no connector — the same "replace this author's own links"
 * semantics `setAssetTags` gives a connector. Names go through `normalizeManualTagNames` first
 * (trimmed, emptied ones dropped, duplicates collapsed).
 *
 * A name that belongs to a merged tag links the asset to the root of its merges, which gets the
 * manual origin when it has none. Two typed names reaching the same root link it once.
 *
 * Resolved directly against `findTagsByNames`/`findManualTagSourcesByTagIds`, not through
 * `resolveTagOrigin`: that table exists to re-resolve an origin identified independently of the
 * name it currently reports (a connector's `sourceTagId`), which is what lets a new name mean
 * "rename", "split" or "merge" rather than "a different tag". A manual entry carries no such id —
 * the tag it belongs to can only be found by the very name being resolved — so there is nothing
 * for those three actions to disambiguate here; the only questions left are whether the tag
 * exists and whether it already has a manual origin.
 *
 * Never deletes a tag a removal leaves orphaned (`deleteTagIfOrphan` exists for the connector
 * vocabulary resync, not for this): whether a tenant's vocabulary entry should disappear because
 * the last asset that carried it by hand no longer does is a product decision, not this method's
 * to make.
 *
 * A service account's call is an XTM One push (#3152, section 2): its origins and links carry
 * `pushedByXtmOne`, so XTM One shows as the tag's origin and a push replaces only what XTM One
 * asserted, never a person's own tags, and the other way round.
 */
const writeManualAssetTags = async (repo: SupportingAssetsRepo, eventOrigin: EventOrigin, tenantId: string, assetId: string, names: Array<string>) => {
  const pushedByXtmOne = membershipAuthorOf(eventOrigin).source === 'xtm_one';
  const trimmedNames = normalizeManualTagNames(names);
  const tagIds: Array<string> = [];
  if (trimmedNames.length > 0) {
    const pointers = await repo.findMergedTagPointers();
    const tagIdByName = await repo.findTagsByNames(trimmedNames);
    const rootIdByName = new Map([...tagIdByName].map(([name, tagId]) => [name, resolveTagRoot(pointers, tagId)]));
    const manualOriginTagIds = new Set((await repo.findManualTagSourcesByTagIds([...new Set(rootIdByName.values())], pushedByXtmOne)).keys());
    for (const name of trimmedNames) {
      const existingTagId = rootIdByName.get(name) ?? null;
      let resolvedTagId: string;
      if (existingTagId !== null && manualOriginTagIds.has(existingTagId)) {
        resolvedTagId = existingTagId;
      } else if (existingTagId !== null) {
        resolvedTagId = existingTagId;
        await repo.insertTagSource({ id: uuidv7(), tenantId, tagId: resolvedTagId, connectorId: null, sourceTagId: null, reportedName: name, reportedColor: null, pushedByXtmOne });
        manualOriginTagIds.add(resolvedTagId);
      } else {
        resolvedTagId = uuidv7();
        await repo.insertTag({ id: resolvedTagId, tenantId, name });
        await repo.insertTagSource({ id: uuidv7(), tenantId, tagId: resolvedTagId, connectorId: null, sourceTagId: null, reportedName: name, reportedColor: null, pushedByXtmOne });
      }
      tagIds.push(resolvedTagId);
    }
  }
  await repo.setAssetTagsBatch(tenantId, null, [{ supportingAssetId: assetId, tagIds }], pushedByXtmOne);
};

export const supportingAssetsService = defineService(
  'supportingAssets',
  supportingAssetsRepository,
).dependsOn(() => [organizationsService, techniqueMappingService]).implement({
  /**
   * `mapIntoOrganizationId` is the closed risk scope the asset is created inside, resolved by the
   * caller: an asset created by hand there is mapped into it, or it would not appear in the very
   * list it was created from. The two writes share one transaction.
   */
  createSupportingAsset: async ({ atomic, eventOrigin }, values: {
    id: string,
    name?: string | null,
    description?: string | null,
    ownerId?: string | null,
    /** An owner named as text (an XTM One push): resolved to a member, never trusted as an id. */
    ownerName?: string | null,
    exposure: SupportingAssetExposure,
    categoryId: AssetCategory,
    subcategoryId?: AssetSubcategory | null,
    criticality?: AssetCriticality,
    url?: string | null,
    linkedPerson?: string | null,
    firstSeenAt?: Date | null,
    lastSeenAt?: Date | null,
    mapIntoOrganizationId?: string | null,
    properties?: ManualAssetProperties,
    tagNames?: Array<string>,
    /** The groups this caller puts the asset in, by name and optional external reference; replaces this caller's own memberships. */
    groups?: Array<PushedAssetGroup>,
  }): Promise<{ owner: OwnerDecision['report'] | null }> => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const tenantId = eventOrigin.tenantId;
    assertSubcategoryWithin(values.subcategoryId, values.categoryId);
    const name = values.name?.trim() ? values.name.trim() : null;
    const description = values.description?.trim() ? values.description.trim() : null;
    const url = values.url?.trim() ? values.url.trim() : null;
    const ownerName = values.ownerName?.trim() ? values.ownerName.trim() : null;
    // The owner's text is kept as the linked person whatever the resolution says.
    const linkedPerson = values.linkedPerson?.trim() ? values.linkedPerson.trim() : ownerName;
    const criticality = values.criticality ?? 'unknown';
    return atomic(async ({ repo, deps }) => {
      const owner = await decideAssetOwner(repo, tenantId, values.ownerId, ownerName, null);
      // A hand-created asset has no observation and no connector: it is the canonical row from
      // the start, and never enters the identity matcher.
      await repo.insertSupportingAsset({
        id: values.id,
        tenantId,
        name,
        description,
        ownerId: owner.write?.ownerId ?? null,
        ownerSource: owner.write?.ownerSource ?? null,
        exposure: values.exposure,
        categoryId: values.categoryId,
        subcategoryId: values.subcategoryId ?? null,
        criticality,
        url,
        linkedPerson,
        firstSeenAt: values.firstSeenAt ?? null,
        lastSeenAt: values.lastSeenAt ?? null,
      });
      if (values.mapIntoOrganizationId != null) {
        await deps.organizations.mapAssetsIntoScope(values.mapIntoOrganizationId, [values.id]);
      }
      if (values.properties) {
        await writeManualAssetProperties(repo, tenantId, values.id, values.categoryId, values.properties);
        await refreshDerivedName(repo, values.id);
      }
      if (values.tagNames) {
        await writeManualAssetTags(repo, eventOrigin, tenantId, values.id, values.tagNames);
      }
      if (values.groups) {
        await writeAssetGroupsOfPush(repo, eventOrigin, tenantId, values.id, values.groups);
      }
      // Pin every scalar the creator gave it, on the same basis as `updateSupportingAsset`: once
      // the asset can be adopted by a matching connector, reprojection would otherwise recompute
      // these from the observation and overwrite what was typed here (owner excluded, the
      // platform owns it and no rule ever resolves it). An `unknown` exposure or criticality is
      // the form's default, not a statement, and must not hide what an adopting connector reports.
      if (eventOrigin.type !== 'client') {
        return { owner: owner.report };
      }
      const setAt = new Date();
      const setByUserId = originUserId(eventOrigin) ?? null;
      const manualAttributes: Array<{ attribute: AssetManualAttribute, value: string | null }> = [
        { attribute: 'name', value: name },
        { attribute: 'exposure', value: values.exposure === 'unknown' ? null : values.exposure },
        { attribute: 'category', value: values.categoryId },
        { attribute: 'subcategory', value: values.subcategoryId ?? null },
        { attribute: 'criticality', value: criticality === 'unknown' ? null : criticality },
        { attribute: 'description', value: description },
        { attribute: 'url', value: url },
        { attribute: 'linkedPerson', value: linkedPerson },
      ];
      for (const { attribute, value } of manualAttributes) {
        if (value === null) {
          continue;
        }
        await repo.upsertManualValue({ supportingAssetId: values.id, attribute, value, setByUserId, setAt });
      }
      return { owner: owner.report };
    });
  },
  updateSupportingAsset: async ({ atomic, eventOrigin }, id: string, values: {
    name?: string | null,
    description?: string | null,
    ownerId?: string | null,
    /** An owner named as text (an XTM One push): resolved to a member, never trusted as an id. */
    ownerName?: string | null,
    exposure?: SupportingAssetExposure,
    categoryId?: AssetCategory,
    subcategoryId?: AssetSubcategory | null,
    criticality?: AssetCriticality,
    url?: string | null,
    linkedPerson?: string | null,
    firstSeenAt?: Date | null,
    lastSeenAt?: Date | null,
    properties?: ManualAssetProperties,
    tagNames?: Array<string>,
    /** The groups this caller puts the asset in, by name and optional external reference; replaces this caller's own memberships. */
    groups?: Array<PushedAssetGroup>,
  }): Promise<{ owner: OwnerDecision['report'] | null }> => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const tenantId = eventOrigin.tenantId;
    const name = values.name !== undefined ? (values.name?.trim() || null) : undefined;
    const description = values.description !== undefined ? (values.description?.trim() || null) : undefined;
    const url = values.url !== undefined ? (values.url?.trim() || null) : undefined;
    const ownerName = values.ownerName?.trim() ? values.ownerName.trim() : null;
    // The owner's text is kept as the linked person whatever the resolution says.
    const linkedPerson = values.linkedPerson !== undefined
      ? (values.linkedPerson?.trim() || null)
      : (ownerName ?? undefined);
    return atomic(async ({ repo: atomicRepo }) => {
      // The only guard against a foreign asset: the source and property tables' policies check the
      // row's own tenant, not the asset's, so everything below relies on this read through `views`.
      const current = await atomicRepo.findSupportingAssetById(id);
      if (!current) {
        throw new SupportingAssetNotFoundError();
      }
      const owner = await decideAssetOwner(atomicRepo, tenantId, values.ownerId, ownerName, current);
      const categoryId = values.categoryId ?? current.categoryId;
      assertSubcategoryWithin(values.subcategoryId, categoryId);
      // A category switched on its own must not keep a subcategory of the old one: a hand-created
      // asset is never reprojected, so nothing else would ever drop it.
      const subcategoryId = values.subcategoryId === undefined
        && values.categoryId !== undefined
        && current.subcategoryId !== null
        && SUBCATEGORY_TO_CATEGORY[current.subcategoryId] !== categoryId
        ? null
        : values.subcategoryId;
      await atomicRepo.updateSupportingAsset(id, {
        ownerId: owner.write?.ownerId,
        ownerSource: owner.write?.ownerSource,
        exposure: values.exposure,
        categoryId: values.categoryId,
        subcategoryId,
        criticality: values.criticality,
        url,
        linkedPerson,
        firstSeenAt: values.firstSeenAt,
        lastSeenAt: values.lastSeenAt,
        name,
        description,
        updatedAt: new Date(),
      });
      if (values.properties) {
        await writeManualAssetProperties(atomicRepo, tenantId, id, categoryId, values.properties);
      } else if (values.categoryId !== undefined) {
        // The matcher skips a source reporting a category outside the asset's current family, so the
        // manual one follows the asset: left behind, a block typed for this family would stop being
        // matched on once the asset is moved back to it.
        await atomicRepo.updateManualSourceCategory(id, categoryId);
      }
      // A category switch changes which family block the name is read from, so it recomputes too.
      if (values.properties || values.categoryId !== undefined) {
        await refreshDerivedName(atomicRepo, id);
      }
      if (values.tagNames) {
        await writeManualAssetTags(atomicRepo, eventOrigin, tenantId, id, values.tagNames);
      }
      if (values.groups) {
        await writeAssetGroupsOfPush(atomicRepo, eventOrigin, tenantId, id, values.groups);
      }
      // A value a person sets by hand outranks every resolution rule from here on; owner is
      // excluded, the platform owns it and no rule resolves it.
      // Every attribute present is pinned, whatever it holds: the update sheet submits only the
      // fields the user touched, so an attribute they left alone never reaches here.
      if (eventOrigin.type !== 'client') {
        return { owner: owner.report };
      }
      const setAt = new Date();
      const setByUserId = originUserId(eventOrigin) ?? null;
      const manualAttributes: Array<{ attribute: AssetManualAttribute, value: string | null | undefined }> = [
        { attribute: 'name', value: name },
        { attribute: 'exposure', value: values.exposure },
        { attribute: 'category', value: values.categoryId },
        { attribute: 'subcategory', value: subcategoryId },
        { attribute: 'criticality', value: values.criticality },
        { attribute: 'description', value: description },
        { attribute: 'url', value: url },
        { attribute: 'linkedPerson', value: linkedPerson },
      ];
      for (const { attribute, value } of manualAttributes) {
        if (value === undefined) {
          continue;
        }
        // A `null` value clears the field: it must also clear any earlier pin on it, or the pin
        // outranks the clear at the next reprojection and silently restores the old value.
        if (value === null) {
          await atomicRepo.deleteManualValue(id, attribute);
          continue;
        }
        await atomicRepo.upsertManualValue({ supportingAssetId: id, attribute, value, setByUserId, setAt });
      }
      return { owner: owner.report };
    });
  },
  /**
   * Clears every hand-set value on the asset and re-derives it from its observations. An asset
   * no live connector observes — hand-created, carrying only its own manual observation, or only
   * observations whose connector was deleted — has nothing to resync, and is left untouched, tags
   * included: a resync corrects what automation reports, not what a person enriched by hand, and
   * an orphaned observation is a frozen report nothing will ever refresh.
   */
  resyncSupportingAssetWithConnectors: async ({ atomic }, id: string) => atomic(async ({ repo: atomicRepo }) => {
    await atomicRepo.lockSupportingAssetsForReprojection([id]);
    const rows = await atomicRepo.findAssetObservationsByAssetIds([id]);
    if (!rows.some((row) => row.connectorId !== null)) {
      return;
    }
    const connectorRows = rows.filter((row) => row.origin !== 'user');
    const connectorObservations = connectorRows.map((row) => toAssetObservation(row));
    await atomicRepo.deleteManualValues(id);
    await atomicRepo.deleteManualSourceByAssetId(id);
    const [lift] = await atomicRepo.findCriticalityLiftsByAssetIds([id]);
    const resolved = resolveAssetAttributes(connectorObservations, [], lift?.criticality ?? null);
    await atomicRepo.reprojectSupportingAssets([{ id, ...resolved }]);
    await writeDerivedNames(atomicRepo, [id], new Map([[id, connectorRows]]));
  }),
  deleteSupportingAssets: async ({ atomic }, ids: Array<string>) => await atomic(async ({ repo, deps }) =>
    await deleteAssetsAndStampEstate(repo, deps, ids)),
  getByHostnames: async ({ repo }, hostnames: Array<string>) => repo.findByHostnames(hostnames),
  getSupportingAsset: async ({ repo }, id: string) => {
    const asset = await repo.findSupportingAssetById(id);
    if (!asset) {
      return null;
    }
    const [sources, manualValues, linkedTags, manualTagLinks, pointers, relations, lift] = await Promise.all([
      repo.findSourcesByAssetIds([id]),
      repo.findManualValuesByAssetIds([id]),
      repo.findTagsByAssetIds([id]),
      repo.findManualTagLinksByAssetIds([id]),
      repo.findMergedTagPointers(),
      repo.findRelationsByAssetId(id),
      repo.findCriticalityLiftByAssetId(id),
    ]);
    const manualSource = sources.find((s) => s.origin === 'user');
    const manualTagIds = new Set(manualTagLinks.map((link) => link.tagId));
    const rootsById = new Map<string, DisplayedTag>(linkedTags.filter((tag) => !pointers.has(tag.id)).map((tag) => [tag.id, tag]));
    const missingRootIds = [...new Set(linkedTags.map((tag) => resolveTagRoot(pointers, tag.id)))].filter((rootId) => !rootsById.has(rootId));
    for (const root of await repo.findTagsByIds(missingRootIds)) {
      rootsById.set(root.id, root);
    }
    const family = identityFamilyOf(asset.categoryId);
    return {
      ...asset,
      sources: sources.map(toSourceSummary),
      properties: resolveAssetProperties(sources, family),
      // The manual block alone, never merged with a connector's: this is what lets a reader mark
      // a field "set by user" without recomputing provenance field by field — it already won the
      // merge in `properties` above, by ranking first.
      manualProperties: manualSource ? toObservationProperties(manualSource, family) ?? null : null,
      // Every family's block, the current one included: what the edit drawer prefills a family's
      // fields from once the reader switches the category to it, before anything is saved.
      propertiesByFamily: PROPERTY_FAMILIES.flatMap((f) => {
        const properties = resolveAssetProperties(sources, f);
        return properties === null ? [] : [{
          properties,
          manualProperties: manualSource ? toObservationProperties(manualSource, f) ?? null : null,
        }];
      }),
      manualValues,
      // `isManual` marks the asset's own link to that tag, not the tag's own name origin: a tag a
      // connector also asserts here still reads manual, since the two links are separate rows.
      tags: displayAssetTags(linkedTags, manualTagIds, pointers, rootsById),
      relations,
      criticalityLift: lift === null ? null : {
        criticality: lift.criticality,
        fromAsset: lift.fromAssetId === null || lift.fromAssetCriticality === null
          ? null
          : { id: lift.fromAssetId, name: lift.fromAssetName, derivedName: lift.fromAssetDerivedName, criticality: lift.fromAssetCriticality },
      },
    };
  },
  /**
   * `mappedToOrganizationId` narrows the page to a closed scope's mapping, the caller having
   * resolved the mode; `membershipOrganizationId` narrows nothing and only says, per row, whether
   * it is already mapped into that scope, which is what the scope drawer's picker reads while it
   * offers the whole estate. `estateTotal` sizes the estate itself, so a statement line and a
   * selection denominator do not shrink to the search's own result.
   */
  listSupportingAssets: async ({ repo }, params: {
    page: number,
    limit: number,
    search: string | null,
    source: string | null,
    categoryId?: AssetCategory | null,
    categoryMode?: 'only' | 'except',
    /** The assets of this group only, whoever asserted the membership. */
    groupId?: string | null,
    mappedToOrganizationId: string | null,
    membershipOrganizationId: string | null,
    sortBy: AssetSortKey,
    sortDesc: boolean,
  }) => {
    const offset = (params.page - 1) * params.limit;
    const filters = {
      search: params.search,
      source: params.source,
      categoryId: params.categoryId ?? null,
      categoryMode: params.categoryMode ?? 'only',
      groupId: params.groupId ?? null,
      mappedToOrganizationId: params.mappedToOrganizationId,
    };
    // With nothing narrowing the page, `total` already counts the estate, and asking twice counts it twice.
    const narrowed = params.search !== null || params.source !== null || (params.categoryId ?? null) !== null || (params.groupId ?? null) !== null;
    const [items, total, narrowedEstateTotal] = await Promise.all([
      repo.findSupportingAssetsPage({ ...params, offset }),
      repo.countSupportingAssets(filters),
      narrowed
        ? repo.countSupportingAssets({
          search: null, source: null, categoryId: null, categoryMode: 'only', mappedToOrganizationId: params.mappedToOrganizationId,
        })
        : undefined,
    ]);
    const estateTotal = narrowedEstateTotal ?? total;
    const pageIds = items.map((a) => a.id);
    const [sources, groupRows] = await Promise.all([
      repo.findSourceSummariesByAssetIds(pageIds),
      repo.findGroupsByAssetIds(pageIds),
    ]);
    const sourcesByAssetId = groupBy(sources, (s) => s.supportingAssetId);
    const groupsByAssetId = groupBy(groupRows, (g) => g.supportingAssetId);
    // Every observation behind the matching assets, not just the page's own: the toolbar's own
    // count must not move when the page changes.
    const totalObservations = await repo.countObservationsForFilter(filters);
    return {
      items: items.map((asset) => ({
        ...asset,
        sources: sourcesByAssetId.get(asset.id) ?? [],
        groups: (groupsByAssetId.get(asset.id) ?? []).map(({ id, name }) => ({ id, name })),
      })),
      total,
      estateTotal,
      totalObservations,
      page: params.page,
      limit: params.limit,
    };
  },
  /**
   * The supporting assets a dependency drawer offers for one relation of one asset, the ones already
   * linked first. Unlike `listSupportingAssets` it counts no
   * observations and no unfiltered estate: the drawer shows neither, and pays for each keystroke.
   */
  listDependencyCandidates: async ({ repo }, params: {
    page: number,
    limit: number,
    search: string | null,
    source: string | null,
    categoryId: AssetCategory | null,
    dependency: DependencyCandidateScope,
  }) => {
    const filters = {
      search: params.search,
      source: params.source,
      categoryId: params.categoryId,
      categoryMode: 'only' as const,
      mappedToOrganizationId: null,
      dependency: params.dependency,
    };
    const [items, total] = await Promise.all([
      repo.findDependencyCandidatesPage({
        search: params.search,
        source: params.source,
        categoryId: params.categoryId,
        dependency: params.dependency,
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
      }),
      repo.countSupportingAssets(filters),
    ]);
    const sources = await repo.findSourceSummariesByAssetIds(items.map((a) => a.id));
    const sourcesByAssetId = groupBy(sources, (s) => s.supportingAssetId);
    return {
      items: items.map((asset) => ({ ...asset, sources: sourcesByAssetId.get(asset.id) ?? [] })),
      total,
      page: params.page,
      limit: params.limit,
    };
  },
  getAssetCountsBySource: async ({ repo }, mappedToOrganizationId: string | null = null) => repo.getAssetCountsBySource(mappedToOrganizationId),

  createEvidence: async ({ repo, atomic, eventOrigin }, values: {
    id: string,
    supportingAssetId: string,
    cveId?: string | null,
    mitreTechniqueId?: string | null,
    expectationType?: ExpectationType | null,
    userId?: string | null,
    initialState?: EvidenceState,
    changedByUserId?: string | null,
  }) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    if (!values.userId) {
      throw newError('userId is required to attach a finding by hand');
    }
    const cveId = values.cveId ?? null;
    const mitreTechniqueId = values.mitreTechniqueId ?? null;
    const expectationType = values.expectationType ?? null;
    assertValidEvidenceFinding({ cveId, mitreTechniqueId, expectationType });
    const asset = await repo.findSupportingAssetById(values.supportingAssetId);
    if (!asset) {
      throw new SupportingAssetNotFoundError();
    }
    if (cveId !== null && !await repo.isCveVisible(cveId)) {
      throw new CveNotFoundError();
    }
    const now = new Date();
    await atomic(async ({ repo: atomicRepo, deps }) => {
      try {
        await atomicRepo.insertAssetEvidence({
          id: values.id,
          supportingAssetId: values.supportingAssetId,
          tenantId: eventOrigin.tenantId,
          cveId,
          mitreTechniqueId,
          expectationType,
          userId: values.userId ?? null,
        });
      } catch (error) {
        if (isUniqueViolationOf(error, ASSET_EVIDENCE_UNIQUE)) {
          throw new EvidenceAlreadyExistsError();
        }
        throw error;
      }
      await atomicRepo.insertEvidenceHistory({
        id: uuidv7(),
        tenantId: eventOrigin.tenantId,
        assetEvidenceId: values.id,
        stateChangedAt: now,
        state: values.initialState ?? 'applicable',
        reason: null,
        changedByUserId: values.changedByUserId ?? null,
        origin: 'user',
      });
      if (cveId) {
        await deps.techniqueMapping.resolveTechniquesForCves([cveId]);
      }
    });
  },

  /**
   * Sets a finding aside under a type and a reason code, with the rationale on top of the code.
   *
   * The code serves reporting and the prose serves the analyst, so neither replaces the other and
   * both are required. One dismissed state carries both types: the type is what the chip, the
   * instance field and the history row report.
   */
  dismissEvidence: async ({ repo, eventOrigin }, params: {
    evidenceId: string,
    dismissalType: DismissalType,
    reasonCode: DismissalReasonCode,
    reason: string,
    changedByUserId?: string | null,
  }) => {
    if (!DISMISSAL_REASON_CODES_BY_TYPE[params.dismissalType].includes(params.reasonCode)) {
      throw newError('Reason code does not belong to that dismissal type', {
        dismissalType: params.dismissalType,
        reasonCode: params.reasonCode,
      });
    }
    const reason = params.reason.trim();
    if (reason.length === 0) {
      throw newError('A rationale is required to set a finding aside');
    }
    await refusingForeignEvidence(() => repo.insertEvidenceHistory({
      id: uuidv7(),
      tenantId: requireTenantId(eventOrigin),
      assetEvidenceId: params.evidenceId,
      stateChangedAt: new Date(),
      state: 'dismissed',
      reason,
      dismissalType: params.dismissalType,
      dismissalReasonCode: params.reasonCode,
      changedByUserId: params.changedByUserId ?? null,
      origin: 'user',
    }));
  },

  markEvidenceApplicable: async ({ repo, eventOrigin }, params: {
    evidenceId: string,
    changedByUserId?: string | null,
  }) => {
    await refusingForeignEvidence(() => repo.insertEvidenceHistory({
      id: uuidv7(),
      tenantId: requireTenantId(eventOrigin),
      assetEvidenceId: params.evidenceId,
      stateChangedAt: new Date(),
      state: 'applicable',
      reason: null,
      changedByUserId: params.changedByUserId ?? null,
      origin: 'user',
    }));
  },

  // Hands control back to the connector without altering the current state or rewriting history:
  // appends a row carrying the same state under the `reset` origin, from which `deriveFindingState`
  // hears only verdicts given later. The person who asked stays on the row: stickiness keys off the
  // origin, never off the author.
  resetEvidenceState: async ({ repo, eventOrigin }, params: { evidenceId: string, changedByUserId?: string | null }) => {
    const evidence = await repo.findEvidenceById(params.evidenceId);
    if (!evidence) {
      throw newError('Evidence not found');
    }
    // A finding a person attached carries no observation, so nothing will ever come and supersede
    // the row this would write. Handing it back to automation there is not a weaker guarantee, it
    // is an empty one. A source whose connector was since deleted (`connectorId` nulled) is no
    // better: nothing will ever refresh it either.
    const sources = await repo.findEvidenceSourcesByEvidenceIds([params.evidenceId]);
    if (!sources.some((s) => s.connectorId !== null)) {
      throw newError('Evidence has no connector to hand control back to');
    }
    const [latest] = await repo.findLatestStatesByEvidenceIds([params.evidenceId]);
    if (!latest) {
      throw newError('Evidence has no history');
    }
    if (latest.origin !== 'user') {
      throw newError('Evidence state is not manually set');
    }
    await repo.insertEvidenceHistory({
      id: uuidv7(),
      tenantId: requireTenantId(eventOrigin),
      assetEvidenceId: params.evidenceId,
      stateChangedAt: new Date(),
      state: latest.state,
      // No reason: the row carries none of a person's words, and `origin` is what names it. A string
      // written here reaches the history verbatim, in whatever language the server was written in.
      reason: null,
      changedByUserId: params.changedByUserId ?? null,
      origin: 'reset',
    });
  },

  /**
   * Drops a finding a person attached by hand, with everything hanging off it (history, score and
   * its journal, all cascading).
   *
   * Refused as soon as one observation exists, whatever its connector's fate: a connector still
   * reporting it would recreate it at the next sync, and one since deleted left a row that is a
   * record of what was actually seen. Setting aside is what answers on those.
   */
  deleteEvidence: async ({ atomic }, params: { evidenceId: string }) =>
    atomic(async ({ repo }) => {
      // Locked before its sources are read: a sync committing between the check and the delete
      // would otherwise lose the observation it just recorded, to the cascade.
      const [locked] = await repo.lockAssetEvidence(params.evidenceId);
      if (!locked) {
        throw newError('Evidence not found');
      }
      const sources = await repo.findEvidenceSourcesByEvidenceIds([params.evidenceId]);
      if (sources.length > 0) {
        throw new ConnectorBackedEvidenceError();
      }
      await repo.deleteAssetEvidence(params.evidenceId);
    }),

  getEvidenceDetail: async ({ repo }, evidenceId: string) => {
    const evidence = await repo.findEvidenceById(evidenceId);
    if (!evidence) {
      return null;
    }
    const [history, sources, software] = await Promise.all([
      repo.findEvidenceHistoryByEvidenceId(evidenceId),
      repo.findEvidenceSourcesByEvidenceIds([evidenceId]),
      repo.findEvidenceSoftwareByEvidenceIds([evidenceId]),
    ]);
    const currentState = history.at(-1)?.state ?? null;
    return {
      ...evidence,
      currentState,
      history,
      sources,
      software: software.map(({ vendor, name, version }) => ({ vendor, name, version })),
    };
  },

  getApplicableTechniquesForAsset: ({ repo }, assetId: string) =>
    repo.findApplicableTechniquesForAsset(assetId),

  /**
   * The scope's applicable findings on each day the activity heatmap draws, oldest first, days read
   * in the viewer's `timeZone`. A finding counts on a day when its last state change by the end of
   * that day left it applicable, so one without any history does not count yet.
   */
  getEvidenceActivity: async (
    { repo },
    scope: EvidenceActivityScope,
    timeZone: string,
    mappedToOrganizationId: string | null = null,
  ): Promise<Array<EvidenceActivityDay>> => {
    const days = daysEndingOn(calendarDayIn(timeZone, new Date()), EVIDENCE_ACTIVITY_DAYS);
    const spans = await repo.findApplicableSpans(scope, { timeZone, firstDay: days[0] }, mappedToOrganizationId);
    return countSpansByDay(spans, days);
  },

  listAffectedAssets: async ({ repo }, params: {
    flaw: AffectedAssetsFlaw,
    page: number,
    limit: number,
    sortBy: AffectedAssetSortKey,
    sortDesc: boolean,
  }) => {
    const [items, total] = await Promise.all([
      repo.findAffectedAssetsPage({ ...params, offset: (params.page - 1) * params.limit }),
      repo.countAffectedAssets(params.flaw),
    ]);
    return { items, total, page: params.page, limit: params.limit };
  },
  getAssetCountBySubcategory: async ({ repo }, mappedToOrganizationId: string | null = null) =>
    repo.countBySubcategory(mappedToOrganizationId),
  getAssetCountBySubcategoryAndIdentityState: async ({ repo }, mappedToOrganizationId: string | null) =>
    repo.countBySubcategoryAndIdentityState(mappedToOrganizationId),

  /**
   * Normalises, matches against every existing observation in the tenant and reprojects the
   * derived attributes onto the canonical row. Returns a map keyed by the connector's own
   * `sourceAssetId`, so a caller can build evidence rows off the connector's own device ids.
   */
  bulkUpsertAssets: async ({ atomic, eventOrigin }, assets: Array<ConnectorAssetInput>) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const tenantId = eventOrigin.tenantId;
    if (assets.length === 0) {
      return new Map<string, string>();
    }

    // A Defender-side self-merge is followed rather than treated as a new device: the merged
    // observation lands on the surviving id's key, so it is never a duplicate. `connectorId` is
    // uniform across one call (one connector syncs at a time), which is what makes this safe.
    const withMergeApplied: Array<ConnectorAssetInput & { supersededSourceAssetId?: string }> = assets.map((a) => (
      a.mergedIntoSourceAssetId && a.mergedIntoSourceAssetId !== a.sourceAssetId ? { ...a, sourceAssetId: a.mergedIntoSourceAssetId, supersededSourceAssetId: a.sourceAssetId } : a
    ));

    // A batch can carry the same device twice (e.g. two vulnerable packages produced two rows
    // upstream); keep the last one, mirroring the connector handlers' own per-page dedup. The
    // survivor's own row always wins over a device merged into it, whose details are stale.
    const byKey = new Map<string, ConnectorAssetInput & { supersededSourceAssetId?: string }>();
    for (const a of withMergeApplied) {
      const key = `${a.connectorId}::${a.sourceAssetId}`;
      const held = byKey.get(key);
      if (held === undefined || held.supersededSourceAssetId !== undefined || a.supersededSourceAssetId === undefined) {
        byKey.set(key, a);
      }
    }
    const deduped = [...byKey.values()];

    // Collected from every remapped row, before the dedup above can keep only one entry per key:
    // the survivor's own natural row shares that same key, and whichever of the two wins the
    // dedup must not decide whether the id it superseded is remembered.
    const supersededAliases = new Map<string, string>();
    for (const a of withMergeApplied) {
      if (a.supersededSourceAssetId !== undefined) {
        supersededAliases.set(a.supersededSourceAssetId, a.sourceAssetId);
      }
    }

    return atomic(async ({ repo: atomicRepo }) => {
      // Bounded by what this batch itself carries, never the whole tenant: a row sharing none of
      // these could never be chosen by the matcher below regardless of what else it holds.
      // `sourceAssetIds` is family-independent — it is what lets a resync of an existing row (of
      // any family, with or without properties) find its own key again — while the per-family
      // blocks carry only what that family's matcher tiers read.
      const machineAssets = deduped.filter((a) => identityFamilyOf(a.categoryId) === 'machine');
      const aiTargetAssets = deduped.filter((a) => identityFamilyOf(a.categoryId) === 'ai_target');
      const identityAssets = deduped.filter((a) => identityFamilyOf(a.categoryId) === 'identity');
      const identityProps = (a: ConnectorAssetInput) => (a.properties?.family === 'identity' ? a.properties : undefined);
      const identities = {
        sourceAssetIds: [...new Set(deduped.map((a) => a.sourceAssetId))],
        externalReferences: [...new Set(deduped.flatMap((a) => (a.externalReference ? [a.externalReference] : [])))],
        machine: machineAssets.length === 0 ? undefined : {
          hostnames: [...new Set(machineAssets.flatMap((a) => normalizeHostname(machineProps(a)?.hostname) ?? []))],
          hardwareUuids: [...new Set(machineAssets.flatMap((a) => machinePropValue(a, 'hardwareUuid')))],
          directoryDeviceIds: [...new Set(machineAssets.flatMap((a) => machinePropValue(a, 'directoryDeviceId')))],
          cloudVmIds: [...new Set(machineAssets.flatMap((a) => machinePropValue(a, 'cloudVmId')))],
          cloudResourceIds: [...new Set(machineAssets.flatMap((a) => machinePropValue(a, 'cloudResourceId')))],
          macAddresses: [...new Set(machineAssets.flatMap((a) => normalizeMacs(machineProps(a)?.macAddresses)))],
          agentExternalReferences: [...new Set(machineAssets.flatMap((a) => machinePropValue(a, 'agentExternalReference')))],
        },
        aiTarget: aiTargetAssets.length === 0 ? undefined : {
          normalizedEndpointUrls: [...new Set(aiTargetAssets.flatMap((a) => (
            a.properties?.family === 'ai_target' ? normalizeEndpointUrl(a.properties.endpointUrl) ?? [] : []
          )))],
        },
        identity: identityAssets.length === 0 ? undefined : {
          directoryObjectIds: [...new Set(identityAssets.flatMap((a) => normalizeIdentifier(identityProps(a)?.directoryObjectId) ?? []))],
          // Both columns are searched against this one list: a SID names one principal whichever
          // of the two a source happened to report it under.
          sids: [...new Set(identityAssets.flatMap((a) => [
            normalizeSid(identityProps(a)?.cloudSid) ?? [],
            normalizeSid(identityProps(a)?.onPremSid) ?? [],
          ].flat()))],
        },
      };
      const candidates = await atomicRepo.findCandidateAssetObservationsForIdentities(tenantId, identities);
      const existingAssetIdByKey = new Map(candidates.map((c) => [`${c.connectorId}::${c.sourceAssetId}`, c.supportingAssetId]));
      // Only a source whose category belongs to the asset's current family is matched on. An asset
      // a person moved to another family keeps the old family's properties on file, so moving it
      // back restores them, but those must not pull the old family's observations onto it.
      const index = buildAssetIdentityIndex(candidates
        .filter((c) => identityFamilyOf(c.reportedCategoryId) === identityFamilyOf(c.assetCategoryId))
        .map((c) => ({ assetId: c.supportingAssetId, observation: toAssetObservation(c) })));

      const sourceAssetIdToAssetId = new Map<string, string>();
      const newAssetRows: Array<{ id: string, tenantId: string, name: string | null, exposure: SupportingAssetExposure, categoryId: AssetCategory, criticality: AssetCriticality, firstSeenAt: Date | null, lastSeenAt: Date | null }> = [];
      const observationRows: Array<typeof supportingAssetSources.$inferInsert> = [];
      // Keyed the same way as observationRows, so the property row can be built from the id
      // `.returning()` hands back rather than the (possibly conflicting) generated one above.
      const machinePropertiesByKey = new Map<string, Omit<typeof supportingAssetMachineProperties.$inferInsert, 'id' | 'supportingAssetSourceId'>>();
      const aiTargetPropertiesByKey = new Map<string, Omit<typeof supportingAssetAiTargetProperties.$inferInsert, 'id' | 'supportingAssetSourceId'>>();
      const identityPropertiesByKey = new Map<string, Omit<typeof supportingAssetIdentityProperties.$inferInsert, 'id' | 'supportingAssetSourceId'>>();
      const touchedAssetIds = new Set<string>();
      const knownAssetIds = new Set(candidates.map((c) => c.supportingAssetId));

      for (const a of deduped) {
        const key = `${a.connectorId}::${a.sourceAssetId}`;
        // A merged device only describes its survivor until an observation is on file under the
        // survivor's id: past that, writing it would overwrite the survivor's name, last seen and addresses.
        const survivorAssetId = a.supersededSourceAssetId === undefined ? undefined : existingAssetIdByKey.get(key);
        if (survivorAssetId !== undefined) {
          sourceAssetIdToAssetId.set(a.sourceAssetId, survivorAssetId);
          continue;
        }
        let properties: AssetObservation['properties'];
        if (a.properties?.family === 'machine') {
          properties = { family: 'machine', ...normalizeMachineProperties(a.properties) };
        } else if (a.properties?.family === 'ai_target') {
          properties = { family: 'ai_target', ...normalizeAiTargetProperties(a.properties) };
        } else if (a.properties?.family === 'identity') {
          properties = { family: 'identity', ...normalizeIdentityProperties(a.properties) };
        } else {
          properties = undefined;
        }
        const observation: AssetObservation = {
          id: a.sourceAssetId,
          connectorId: a.connectorId,
          // Every observation built from a connector's own input, never a manual one.
          origin: 'connector',
          source: a.source,
          sourceAssetId: a.sourceAssetId,
          reportedName: a.name?.trim() || null,
          reportedCategoryId: a.categoryId,
          reportedSubcategoryId: a.subcategoryId ?? null,
          reportedDescription: a.description ?? null,
          reportedExposure: a.exposure ?? 'unknown',
          reportedCriticality: a.criticality ?? 'unknown',
          // Normalised like every other identifier the matcher reads: the common tier joins on
          // equality alone, so a source serializing an absent reference as `""` would have every
          // asset sharing that absence collide on it.
          externalReference: normalizeIdentifier(a.externalReference),
          reportedUrl: a.url?.trim() || null,
          reportedLinkedPerson: normalizeIdentifier(a.linkedPerson),
          // Raw, unlike newAssetRows below: a connector's null here (no observation) must reach
          // the per-source upsert as NULL, not as a fabricated "now" overwriting a real value.
          firstSeenAt: a.firstSeenAt ?? null,
          lastSeenAt: a.lastSeenAt ?? null,
          // Unused by the identity matcher this feeds; attribute resolution always re-reads the
          // upserted row for its real value instead.
          sourceLastActivityAt: new Date(),
          properties,
        };

        const existingAssetId = existingAssetIdByKey.get(key);
        const resolvedAssetId = existingAssetId ?? index.resolve(observation) ?? uuidv7();

        if (!existingAssetId) {
          index.register(resolvedAssetId, observation);
        }
        if (!knownAssetIds.has(resolvedAssetId)) {
          knownAssetIds.add(resolvedAssetId);
          newAssetRows.push({
            id: resolvedAssetId,
            tenantId,
            name: observation.reportedName,
            exposure: observation.reportedExposure,
            categoryId: observation.reportedCategoryId,
            criticality: observation.reportedCriticality,
            // Reprojected from the observations further below before this transaction commits, so
            // this row's own value is never read: no fallback here to fabricate an honest null.
            firstSeenAt: observation.firstSeenAt,
            lastSeenAt: observation.lastSeenAt,
          });
        }

        sourceAssetIdToAssetId.set(a.sourceAssetId, resolvedAssetId);
        touchedAssetIds.add(resolvedAssetId);
        observationRows.push({
          id: uuidv7(),
          supportingAssetId: resolvedAssetId,
          tenantId,
          connectorId: a.connectorId,
          sourceAssetId: a.sourceAssetId,
          reportedName: observation.reportedName,
          reportedCategoryId: observation.reportedCategoryId,
          reportedSubcategoryId: observation.reportedSubcategoryId,
          reportedDescription: observation.reportedDescription,
          reportedExposure: observation.reportedExposure,
          reportedCriticality: observation.reportedCriticality,
          reportedCriticalityRule: a.criticalityRule ?? null,
          externalReference: observation.externalReference,
          reportedUrl: observation.reportedUrl,
          reportedLinkedPerson: observation.reportedLinkedPerson,
          firstSeenAt: observation.firstSeenAt,
          lastSeenAt: observation.lastSeenAt,
        });
        if (properties?.family === 'machine') {
          machinePropertiesByKey.set(key, {
            tenantId,
            hostname: properties.hostname,
            ipAddresses: [...properties.ipAddresses],
            macAddresses: [...properties.macAddresses],
            seenIp: properties.seenIp,
            hardwareUuid: properties.hardwareUuid,
            directoryDeviceId: properties.directoryDeviceId,
            cloudVmId: properties.cloudVmId,
            cloudResourceId: properties.cloudResourceId,
            cloudProvider: properties.cloudProvider,
            cloudNativeType: properties.cloudNativeType,
            cloudRegion: properties.cloudRegion,
            platform: properties.platform,
            arch: properties.arch,
            vendor: properties.vendor,
            model: properties.model,
            operatingSystem: properties.operatingSystem,
            osVersion: properties.osVersion,
            isEol: properties.isEol,
            agentExternalReference: properties.agentExternalReference,
            agentExecutorType: properties.agentExecutorType,
          });
        } else if (properties?.family === 'ai_target') {
          aiTargetPropertiesByKey.set(key, {
            tenantId,
            provider: properties.provider,
            endpointUrl: properties.endpointUrl,
            normalizedEndpointUrl: properties.normalizedEndpointUrl,
            model: properties.model,
            modality: properties.modality,
            // ai_target_token and ai_target_configuration are never carried this far: neither field
            // exists on ConnectorAssetProperties, so there is nothing here that could persist them.
            systemPrompt: properties.systemPrompt,
          });
        } else if (properties?.family === 'identity') {
          identityPropertiesByKey.set(key, {
            tenantId,
            directoryObjectId: properties.directoryObjectId,
            cloudSid: properties.cloudSid,
            onPremSid: properties.onPremSid,
            userPrincipalName: properties.userPrincipalName,
            accountDomain: properties.accountDomain,
            accountName: properties.accountName,
            directoryType: properties.directoryType,
            identityProvider: properties.identityProvider,
            department: properties.department,
            jobTitle: properties.jobTitle,
            isEnabled: properties.isEnabled,
            assignedRoles: [...properties.assignedRoles],
            privilegedPimRoles: [...properties.privilegedPimRoles],
          });
        }
      }

      // A device Defender merged away is still the id the caller holds: its findings must resolve
      // to the surviving asset rather than be dropped for want of a key. Applied after the loop,
      // from the survivor's own final resolution, so it never depends on which of the two rows
      // sharing the remapped key the earlier dedup happened to keep. The observation still keyed
      // on the superseded id stays on file: deleting it alone would leave its asset with no source
      // at all, which the detail page reads as hand-created, while the duplicate asset row itself
      // survives — retiring that row means repointing its evidence onto the survivor first.
      for (const [supersededSourceAssetId, survivorSourceAssetId] of supersededAliases) {
        const finalAssetId = sourceAssetIdToAssetId.get(survivorSourceAssetId);
        if (finalAssetId !== undefined) {
          sourceAssetIdToAssetId.set(supersededSourceAssetId, finalAssetId);
        }
      }

      for (let i = 0; i < newAssetRows.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.insertSupportingAssetBatch(newAssetRows.slice(i, i + BATCH_CHUNK_SIZE));
      }

      // The parent source row first: PostgreSQL returns the *existing* row on conflict, so the
      // property row below is keyed off what this hands back, never off the uuidv7() generated
      // above — that one is only ever right for a genuine insert. A row the upsert found unchanged
      // is skipped and comes back with nothing: its id is read separately, since its property
      // block may still have changed.
      const upsertedSourceRows: Array<{ id: string, connectorId: string | null, sourceAssetId: string }> = [];
      for (let i = 0; i < observationRows.length; i += BATCH_CHUNK_SIZE) {
        upsertedSourceRows.push(...await atomicRepo.upsertSupportingAssetSourceBatch(observationRows.slice(i, i + BATCH_CHUNK_SIZE)));
      }
      const sourceRowIdByKey = new Map(upsertedSourceRows.map((r) => [`${r.connectorId}::${r.sourceAssetId}`, r.id]));
      const skippedSourceAssetIdsByConnectorId = new Map<string, Array<string>>();
      for (const row of observationRows) {
        if (row.connectorId != null && !sourceRowIdByKey.has(`${row.connectorId}::${row.sourceAssetId}`)) {
          skippedSourceAssetIdsByConnectorId.set(row.connectorId, [...skippedSourceAssetIdsByConnectorId.get(row.connectorId) ?? [], row.sourceAssetId]);
        }
      }
      for (const [skippedConnectorId, skippedSourceAssetIds] of skippedSourceAssetIdsByConnectorId) {
        for (let i = 0; i < skippedSourceAssetIds.length; i += BATCH_CHUNK_SIZE) {
          const skippedRows = await atomicRepo.findSourcesByConnectorAndSourceAssetIds(skippedConnectorId, skippedSourceAssetIds.slice(i, i + BATCH_CHUNK_SIZE));
          for (const skipped of skippedRows) {
            sourceRowIdByKey.set(`${skippedConnectorId}::${skipped.sourceAssetId}`, skipped.id);
          }
        }
      }

      const machinePropertyRows = [...machinePropertiesByKey.entries()].flatMap(([key, properties]) => {
        const sourceRowId = sourceRowIdByKey.get(key);
        // Reuses the source row's own id: the two are one-to-one and always written together.
        return sourceRowId === undefined ? [] : [{ id: sourceRowId, supportingAssetSourceId: sourceRowId, ...properties }];
      });
      for (let i = 0; i < machinePropertyRows.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.upsertMachinePropertiesBatch(machinePropertyRows.slice(i, i + BATCH_CHUNK_SIZE));
      }

      const aiTargetPropertyRows = [...aiTargetPropertiesByKey.entries()].flatMap(([key, properties]) => {
        const sourceRowId = sourceRowIdByKey.get(key);
        return sourceRowId === undefined ? [] : [{ id: sourceRowId, supportingAssetSourceId: sourceRowId, ...properties }];
      });
      for (let i = 0; i < aiTargetPropertyRows.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.upsertAiTargetPropertiesBatch(aiTargetPropertyRows.slice(i, i + BATCH_CHUNK_SIZE));
      }

      const identityPropertyRows = [...identityPropertiesByKey.entries()].flatMap(([key, properties]) => {
        const sourceRowId = sourceRowIdByKey.get(key);
        return sourceRowId === undefined ? [] : [{ id: sourceRowId, supportingAssetSourceId: sourceRowId, ...properties }];
      });
      for (let i = 0; i < identityPropertyRows.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.upsertIdentityPropertiesBatch(identityPropertyRows.slice(i, i + BATCH_CHUNK_SIZE));
      }

      // A connector's source that changed family would otherwise leave the other families' rows
      // behind, back on the asset's card the day a person moves the asset to one of them: only a
      // person's own blocks outlive a family change (`writeManualAssetProperties`). Every family
      // therefore clears the other two for the sources it just wrote. A source reporting no family
      // at all is left untouched — a detail call that simply did not return its row must not erase
      // an identity the matcher still needs.
      const sourceIdsOf = (rows: ReadonlyArray<{ supportingAssetSourceId: string }>) => rows.map((row) => row.supportingAssetSourceId);
      const machineSourceIds = sourceIdsOf(machinePropertyRows);
      const aiTargetSourceIds = sourceIdsOf(aiTargetPropertyRows);
      const identitySourceIds = sourceIdsOf(identityPropertyRows);

      const staleMachineSourceIds = [...aiTargetSourceIds, ...identitySourceIds];
      for (let i = 0; i < staleMachineSourceIds.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.deleteMachinePropertiesBySourceIds(staleMachineSourceIds.slice(i, i + BATCH_CHUNK_SIZE));
      }
      const staleAiTargetSourceIds = [...machineSourceIds, ...identitySourceIds];
      for (let i = 0; i < staleAiTargetSourceIds.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.deleteAiTargetPropertiesBySourceIds(staleAiTargetSourceIds.slice(i, i + BATCH_CHUNK_SIZE));
      }
      const staleIdentitySourceIds = [...machineSourceIds, ...aiTargetSourceIds];
      for (let i = 0; i < staleIdentitySourceIds.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.deleteIdentityPropertiesBySourceIds(staleIdentitySourceIds.slice(i, i + BATCH_CHUNK_SIZE));
      }

      await reprojectAssets(atomicRepo, [...touchedAssetIds]);

      return sourceAssetIdToAssetId;
    });
  },
  /**
   * The description, url and linked person each of the connector's sources currently reports, keyed
   * by the connector's own `sourceAssetId`: the fields only a generic asset's `GET /assets/{id}`
   * serves. A source the connector has not written is absent from the map; a field it reports none
   * of is `null`.
   */
  getReportedOverviewFields: async (
    { repo }, connectorId: string, sourceAssetIds: Array<string>,
  ): Promise<Map<string, ReportedOverviewFields>> => {
    const fields = new Map<string, ReportedOverviewFields>();
    for (let i = 0; i < sourceAssetIds.length; i += BATCH_CHUNK_SIZE) {
      const rows = await repo.findReportedOverviewFieldsBySourceAssetIds(connectorId, sourceAssetIds.slice(i, i + BATCH_CHUNK_SIZE));
      for (const row of rows) {
        fields.set(row.sourceAssetId, { description: row.reportedDescription, url: row.reportedUrl, linkedPerson: row.reportedLinkedPerson });
      }
    }
    return fields;
  },

  /**
   * Writes the description, url and linked person a connector's sources report, and re-derives the
   * canonical attributes of the assets whose source changed, in one transaction. The url and the
   * linked person are stored as `bulkUpsertAssets` stores them (trimmed, never blank). An entry
   * equal to what the source holds is not written and does not move the source's `updated_at`; a
   * `null` field clears it. A `sourceAssetId` the connector has no source for is ignored, and so is
   * one listed twice (the last entry wins). A hand-set value keeps winning the asset's own.
   */
  updateReportedOverviewFields: async (
    { atomic }, input: { connectorId: string, entries: Array<{ sourceAssetId: string } & ReportedOverviewFields> },
  ): Promise<void> => {
    const entries = [...new Map(input.entries.map((entry) => [entry.sourceAssetId, {
      sourceAssetId: entry.sourceAssetId,
      description: entry.description,
      url: entry.url?.trim() || null,
      linkedPerson: normalizeIdentifier(entry.linkedPerson),
    }])).values()];
    if (entries.length === 0) {
      return;
    }
    await atomic(async ({ repo: atomicRepo }) => {
      const changedAssetIds = await atomicRepo.updateSourceReportedOverviewFields(input.connectorId, entries);
      for (let i = 0; i < changedAssetIds.length; i += BATCH_CHUNK_SIZE) {
        await reprojectAssets(atomicRepo, changedAssetIds.slice(i, i + BATCH_CHUNK_SIZE));
      }
    });
  },

  /**
   * Files a connector's observations on their findings and sources, logs the verdicts that change
   * a source's standing, and appends the history row each touched finding's sources now call for.
   * An observation arriving late updates its source if it is still the newest, and never the past.
   */
  bulkUpsertEvidence: ({ atomic }, evidences: Array<BulkEvidenceRow>) =>
    atomic((ctx) => upsertEvidenceBatch(ctx, evidences)),

  /**
   * Drops the observations a connector keyed under an identifier it has since replaced with a
   * stronger one, and re-derives the assets they were folded into.
   *
   * An account first seen in a logon event is keyed by its SID; once the directory returns it, the
   * connector keys it by its object id instead and the matcher folds the two onto one asset. Both
   * observations then sit on that asset, under one connector, and nothing else in the estate ever
   * retires a source row — a connector that stops reporting a key leaves it on file.
   *
   * Called after the replacement has been upserted, never before: the superseded row is what the
   * matcher reads to find the asset in the first place.
   */
  retireSupersededSources: async ({ atomic }, params: { connectorId: string, sourceAssetIds: Array<string> }) =>
    atomic(async ({ repo: atomicRepo }) => {
      const rows = await atomicRepo.findSourcesByConnectorAndSourceAssetIds(params.connectorId, params.sourceAssetIds);
      if (rows.length === 0) {
        return 0;
      }
      await atomicRepo.deleteSupportingAssetSourcesByIds(rows.map((row) => row.id));
      await reprojectAssets(atomicRepo, [...new Set(rows.map((row) => row.supportingAssetId))]);
      return rows.length;
    }),

  /**
   * Drops every observation a connector holds under these source ids, for records the connector
   * has decided to stop importing, and removes the assets that leaves with nothing: no source of
   * any kind and nothing a person put into them (see `findInvestedAssetIds`). An asset still
   * observed is re-derived from what is left; an asset kept only by a person's work keeps its last
   * projection, since a reprojection from no observation has nothing to say.
   */
  retireConnectorSources: async ({ atomic }, params: { connectorId: string, sourceAssetIds: Array<string> }) =>
    atomic(async ({ repo: atomicRepo, deps }) => {
      const rows = await atomicRepo.findSourcesByConnectorAndSourceAssetIds(params.connectorId, params.sourceAssetIds);
      if (rows.length === 0) {
        return { sources: 0, assets: 0 };
      }
      const affectedIds = [...new Set(rows.map((row) => row.supportingAssetId))];
      await atomicRepo.lockSupportingAssetsForDeletion(affectedIds);
      await atomicRepo.deleteSupportingAssetSourcesByIds(rows.map((row) => row.id));
      const stillObserved = new Set(await atomicRepo.findAssetIdsWithConnectorSource(affectedIds));
      const orphanIds = affectedIds.filter((id) => !stillObserved.has(id));
      const investedIds = new Set(await atomicRepo.findInvestedAssetIds({ assetIds: orphanIds, retiringConnectorId: params.connectorId }));
      const removableIds = orphanIds.filter((id) => !investedIds.has(id));
      if (removableIds.length > 0) {
        await deleteAssetsAndStampEstate(atomicRepo, deps, removableIds);
      }
      await reprojectAssets(atomicRepo, affectedIds.filter((id) => stillObserved.has(id)));
      return { sources: rows.length, assets: removableIds.length };
    }),

  /**
   * Brings every device's lift to the band its assigned identities give it, then reprojects the
   * devices whose lift changed and those alone: a reprojection is a write on the asset, so a run
   * with nothing to change has to write nothing.
   */
  recomputeCriticalityLifts: async ({ atomic, eventOrigin }) => {
    if (eventOrigin.type !== 'job') {
      throw newError('Criticality lifts are recomputed by their job alone', { origin: eventOrigin.type });
    }
    const { tenantId } = eventOrigin;
    return await atomic(async ({ repo: atomicRepo }) => {
      const assignments = await atomicRepo.findCriticalityLiftAssignments();
      const stored = await atomicRepo.findAllCriticalityLifts();
      const computed = computeCriticalityLifts(assignments);
      const { upserts, deletedAssetIds, changedAssetIds } = diffCriticalityLifts(stored, computed);
      for (let i = 0; i < upserts.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.upsertCriticalityLifts(upserts.slice(i, i + BATCH_CHUNK_SIZE).map((lift) => ({ ...lift, tenantId })));
      }
      for (let i = 0; i < deletedAssetIds.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.deleteCriticalityLiftsByAssetIds(deletedAssetIds.slice(i, i + BATCH_CHUNK_SIZE));
      }
      // A first run after a large sync can change more devices than a statement takes parameters.
      for (const batch of toReprojectionBatches(changedAssetIds, BATCH_CHUNK_SIZE)) {
        await reprojectAssets(atomicRepo, batch);
      }
      return { lifted: computed.length, changed: changedAssetIds.length };
    });
  },

  /** Both ends a connector's relations join on, read once per pass: its devices' identifiers and its identities' keys. */
  getConnectorRelationEndpoints: async ({ repo }, connectorId: string) => {
    const [devices, identities] = await Promise.all([
      repo.findConnectorDeviceIdentifiers(connectorId),
      repo.findConnectorIdentityKeys(connectorId),
    ]);
    return {
      devices: devices.map((device) => ({ ...device, macAddresses: device.macAddresses ?? [] })),
      identities,
    };
  },

  listConnectorRelations: async ({ repo }, params: { connectorId: string, kind: AssetRelationKind }) =>
    repo.findConnectorRelations(params),

  /**
   * Writes the relations one pass of a connector observed and deletes the ones it retires, in one
   * transaction. Which relations a pass retires is the connector's to decide, from what it holds
   * and which of its sources answered; only the connector's own relations of that kind are deleted.
   */
  reconcileConnectorRelations: async ({ atomic, eventOrigin }, params: {
    connectorId: string,
    kind: AssetRelationKind,
    observedAt: Date,
    relations: ReadonlyArray<{ fromAssetId: string, toAssetId: string, source: AssetRelationSource, evidenceRef?: string | null }>,
    retiredIds: ReadonlyArray<string>,
  }) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const tenantId = eventOrigin.tenantId;
    // One statement cannot upsert the same key twice, so a pair reported twice is written once.
    const unique = [...new Map(params.relations.map((relation) => [`${relation.fromAssetId}:${relation.toAssetId}`, relation])).values()];
    return await atomic(async ({ repo: atomicRepo }) => {
      const rows = unique.map((relation) => ({
        id: uuidv7(),
        tenantId,
        connectorId: params.connectorId,
        fromAssetId: relation.fromAssetId,
        toAssetId: relation.toAssetId,
        kind: params.kind,
        source: relation.source,
        evidenceRef: relation.evidenceRef ?? null,
        firstSeenAt: params.observedAt,
        lastReportedAt: params.observedAt,
      }));
      for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
        await atomicRepo.upsertRelationsBatch(rows.slice(i, i + BATCH_CHUNK_SIZE));
      }
      let removed = 0;
      for (let i = 0; i < params.retiredIds.length; i += BATCH_CHUNK_SIZE) {
        removed += await atomicRepo.deleteRelationsByIds({
          connectorId: params.connectorId,
          kind: params.kind,
          ids: params.retiredIds.slice(i, i + BATCH_CHUNK_SIZE),
        });
      }
      return { written: rows.length, removed };
    });
  },

  /**
   * Records that a run walked these assets whole under this scope, which is what later lets the
   * absence of a finding be read as the connector saying it is gone. `enumeratedAt` must be taken
   * before the run's findings are ingested, so that everything it did report compares as fresher.
   */
  markAssetsEnumerated: async ({ repo, eventOrigin }, params: {
    connectorId: string,
    supportingAssetIds: Array<string>,
    scope: string,
    enumeratedAt: Date,
  }) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const { tenantId } = eventOrigin;
    const rows = [...new Set(params.supportingAssetIds)].map((supportingAssetId) => ({
      tenantId,
      connectorId: params.connectorId,
      supportingAssetId,
      scope: params.scope,
      lastReportedAt: params.enumeratedAt,
    }));
    // A run-wide enumeration marks every asset the connector walked, so the row count is the
    // tenant's estate, not a page of it.
    for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
      await repo.upsertAssetEnumerationBatch(rows.slice(i, i + BATCH_CHUNK_SIZE));
    }
  },
  /**
   * The variant of `markAssetsEnumerated` for a set of (asset, scope) pairs, each walked whole
   * under its own scope: a full re-read marks as many pairs as it holds assets, so the pairs go in
   * batches rather than one call per scope. A pair listed twice is marked once.
   */
  markScopesEnumerated: async ({ repo, eventOrigin }, params: {
    connectorId: string,
    pairs: Array<{ supportingAssetId: string, scope: string }>,
    enumeratedAt: Date,
  }) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const { tenantId } = eventOrigin;
    const rows = [...new Map(params.pairs.map((pair) => [`${pair.supportingAssetId}\u0000${pair.scope}`, {
      tenantId,
      connectorId: params.connectorId,
      supportingAssetId: pair.supportingAssetId,
      scope: pair.scope,
      lastReportedAt: params.enumeratedAt,
    }])).values()];
    for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
      await repo.upsertAssetEnumerationBatch(rows.slice(i, i + BATCH_CHUNK_SIZE));
    }
  },

  /**
   * The (asset, scope) pairs a connector reported CVE evidence under since the given instant, read
   * back from what was already persisted rather than tracked by the caller, so a run that ingests
   * CVEs page by page needs no growing set in memory. A CVE source is scoped by the id its
   * connector gives the asset, so the scope tells which of the connector's assets reported it.
   * With `scopes`, only the pairs under one of them.
   */
  findCveScopePairsSince: ({ repo }, connectorId: string, since: Date, scopes?: ReadonlyArray<string>) =>
    repo.findCveScopePairsSince(connectorId, since, scopes),

  /**
   * Keeps alive the sources of findings the connector knows are still current but did not
   * re-read in this run, by moving their sync clock to `reportedAt`. A key matches the sources of
   * this connector under that scope whose finding is the key's (asset, technique, expectation
   * type) and whose security platform type is one of the key's `securityPlatformTypes`, so a type
   * the finding no longer carries is left to lapse; a source under another scope or another
   * connector is left alone. Only `lastReportedAt` moves, and never backwards: neither the
   * finding, its history, `evaluatedAt` nor the source's verdict is touched. Returns the number of
   * sources refreshed.
   */
  refreshEvidenceSources: async ({ repo }, params: {
    connectorId: string,
    keys: Array<{
      supportingAssetId: string,
      scope: string,
      mitreTechniqueId: string,
      expectationType: ExpectationType,
      securityPlatformTypes: Array<string>,
    }>,
    reportedAt: Date,
  }): Promise<number> => {
    let refreshed = 0;
    for (let i = 0; i < params.keys.length; i += BATCH_CHUNK_SIZE) {
      const sourceIds = await repo.findEvidenceSourceIdsMatchingKeys(params.connectorId, params.keys.slice(i, i + BATCH_CHUNK_SIZE));
      refreshed += await repo.setEvidenceSourcesReportedAt(sourceIds, params.reportedAt);
    }
    return refreshed;
  },

  /**
   * Every distinct (asset, scope) the connector holds a technique source under: the pairs a full
   * re-read of the attack observations must mark as enumerated to retire what no longer comes
   * back. CVE sources are left out, since a re-read of the attack stream says nothing about them.
   */
  findEvidenceScopePairsForConnector: ({ repo }, connectorId: string) =>
    repo.findDistinctEvidenceSourceScopePairs(connectorId),

  /**
   * Re-derives, on the given assets, the state of every finding a connector reports
   * (`deriveFindingState`), after a run walked them whole: what no source reports any more is
   * retired under `reason`. A hand-attached finding, having no source, is left alone. Returns the
   * number of findings that changed to dismissed.
   *
   * One transaction per batch of assets, holding the batch's findings until it commits, so a
   * person's dismissal or another connector's sync writing one of them waits for that batch, not
   * for the whole pass. Inside a caller's transaction the batches share it, and `claimFindingLocks`
   * refuses every batch after the first: such a caller passes one batch of assets at most.
   */
  recomputeEvidenceStateForAssets: async ({ atomic, eventOrigin }, params: {
    supportingAssetIds: Array<string>,
    reason: string,
  }) => {
    const tenantId = requireTenantId(eventOrigin);
    let dismissed = 0;
    for (let i = 0; i < params.supportingAssetIds.length; i += BATCH_CHUNK_SIZE) {
      const assetIds = params.supportingAssetIds.slice(i, i + BATCH_CHUNK_SIZE);
      dismissed += await atomic(async ({ repo }) => {
        await claimFindingLocks(repo);
        const lockedIds = new Set((await repo.lockFindingsOnAssets(assetIds)).map(({ id }) => id));
        const written = await rederiveFindings(repo, tenantId, { assetIds, lockedIds }, params.reason);
        return written.filter(({ row, previousState }) => row.state === 'dismissed' && previousState !== 'dismissed').length;
      });
    }
    return dismissed;
  },

  /**
   * Resolves one connector's tag vocabulary against the tenant's canonical tags and
   * returns `sourceTagId → our tag id`, so the inventory pass can resolve the tags an asset row
   * reports before it links them. Each source tag is matched by its own id first — a
   * rename then follows the tag it already points at (in place, or split off, per
   * `resolveTagOrigin`) instead of creating a duplicate — and only an id this connector has never
   * reported before falls back to matching by name.
   *
   * Processed one tag at a time rather than batched at the SQL level: a split or a merge changes
   * which canonical tag the *next* source tag of the same name should resolve to, so each
   * resolution has to see the previous one's effect — which is also why the whole vocabulary is
   * resolved in one transaction, an interrupted one leaving the tags it had already moved without
   * the ones that answer for them.
   */
  upsertTagVocabulary: async ({ atomic, eventOrigin }, connectorId: string, sourceTags: Array<{ sourceTagId: string, name: string, color: string | null }>) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const tenantId = eventOrigin.tenantId;
    const tagIdBySourceTagId = new Map<string, string>();
    if (sourceTags.length === 0) {
      return tagIdBySourceTagId;
    }

    return atomic(async ({ repo }) => {
      const originBySourceTagId = await repo.findTagSourcesForConnector(connectorId, sourceTags.map((t) => t.sourceTagId));
      const originTagIds = [...new Set([...originBySourceTagId.values()].map((o) => o.tagId))];
      const originCountByTagId = await repo.countTagSourcesByTagIds(originTagIds);
      const originTagById = new Map((await repo.findTagsByIds(originTagIds)).map((tag) => [tag.id, tag]));
      const tagIdByName = await repo.findTagsByNames([...new Set(sourceTags.map((t) => t.name))]);

      // Both indexes decide the *next* source tag's resolution, and every action below changes
      // what they should say. Read once and left as snapshots, two origins of one tag renamed in
      // the same payload each split off it and strand the tag they left with no origin at all,
      // and a name a rename freed still resolves to the tag that no longer carries it.
      const moveOrigin = (fromTagId: string | null, toTagId: string | null) => {
        if (fromTagId !== null) {
          originCountByTagId.set(fromTagId, Math.max((originCountByTagId.get(fromTagId) ?? 1) - 1, 0));
        }
        if (toTagId !== null) {
          originCountByTagId.set(toTagId, (originCountByTagId.get(toTagId) ?? 0) + 1);
        }
      };
      const forgetName = (tagId: string) => {
        for (const [name, id] of tagIdByName) {
          if (id === tagId) {
            tagIdByName.delete(name);
          }
        }
      };

      for (const sourceTag of sourceTags) {
        const origin = originBySourceTagId.get(sourceTag.sourceTagId) ?? null;
        const originTag = origin ? originTagById.get(origin.tagId) : undefined;
        const resolution = resolveTagOrigin({
          reportedName: sourceTag.name,
          existingOrigin: origin
            ? {
              tagId: origin.tagId,
              reportedName: origin.reportedName,
              tagName: originTag?.name ?? origin.reportedName,
              tagIsMerged: (originTag?.mergedIntoTagId ?? null) !== null,
            }
            : null,
          isSoleOriginOfCurrentTag: origin !== null && (originCountByTagId.get(origin.tagId) ?? 1) <= 1,
          existingTagIdForReportedName: tagIdByName.get(sourceTag.name) ?? null,
        });

        let resolvedTagId: string;
        switch (resolution.action) {
          case 'noop':
            resolvedTagId = origin!.tagId;
            // A noop can still carry a new name, when the canonical tag already has it.
            if (origin!.reportedName !== sourceTag.name || origin!.reportedColor !== sourceTag.color) {
              await repo.updateTagSource(origin!.id, { reportedName: sourceTag.name, reportedColor: sourceTag.color });
            }
            break;
          case 'renameInPlace':
            resolvedTagId = origin!.tagId;
            await repo.updateTagName(resolvedTagId, sourceTag.name);
            await repo.updateTagSource(origin!.id, { reportedName: sourceTag.name, reportedColor: sourceTag.color });
            forgetName(resolvedTagId);
            break;
          case 'split':
            resolvedTagId = uuidv7();
            await repo.insertTag({ id: resolvedTagId, tenantId, name: sourceTag.name });
            await repo.updateTagSource(origin!.id, { tagId: resolvedTagId, reportedName: sourceTag.name, reportedColor: sourceTag.color });
            moveOrigin(origin!.tagId, resolvedTagId);
            break;
          case 'merge':
            resolvedTagId = resolution.targetTagId;
            await repo.updateTagSource(origin!.id, { tagId: resolvedTagId, reportedName: sourceTag.name, reportedColor: sourceTag.color });
            moveOrigin(origin!.tagId, resolvedTagId);
            if (resolution.deleteOldTag && await repo.deleteTagIfOrphan(origin!.tagId)) {
              forgetName(origin!.tagId);
            }
            break;
          case 'attachExisting':
            resolvedTagId = resolution.targetTagId;
            await repo.insertTagSource({ id: uuidv7(), tenantId, tagId: resolvedTagId, connectorId, sourceTagId: sourceTag.sourceTagId, reportedName: sourceTag.name, reportedColor: sourceTag.color });
            moveOrigin(null, resolvedTagId);
            break;
          case 'createNew':
            resolvedTagId = uuidv7();
            await repo.insertTag({ id: resolvedTagId, tenantId, name: sourceTag.name });
            await repo.insertTagSource({ id: uuidv7(), tenantId, tagId: resolvedTagId, connectorId, sourceTagId: sourceTag.sourceTagId, reportedName: sourceTag.name, reportedColor: sourceTag.color });
            moveOrigin(null, resolvedTagId);
            break;
        }
        // A noop's tag may not carry the reported name, when a user renamed it.
        if (resolution.action !== 'noop') {
          tagIdByName.set(sourceTag.name, resolvedTagId);
        }
        tagIdBySourceTagId.set(sourceTag.sourceTagId, resolvedTagId);
      }
      return tagIdBySourceTagId;
    });
  },

  /**
   * Replaces the tags **this connector** (`null` for a manual caller) asserted on each asset:
   * an entry with an empty `tagIds` clears its own contribution, and another source's
   * links on the same asset are untouched. Several entries can name the same `supportingAssetId` —
   * the matcher can fuse more than one connector observation onto one asset within a single batch —
   * so their tag sets are unioned here before the write.
   */
  setAssetTags: async ({ repo, eventOrigin }, connectorId: string | null, entries: Array<{ supportingAssetId: string, tagIds: Array<string> }>) => {
    const tenantId = requireTenantId(eventOrigin);
    const tagIdsByAssetId = new Map<string, Set<string>>();
    for (const entry of entries) {
      const tagIds = tagIdsByAssetId.get(entry.supportingAssetId) ?? new Set<string>();
      for (const tagId of entry.tagIds) {
        tagIds.add(tagId);
      }
      tagIdsByAssetId.set(entry.supportingAssetId, tagIds);
    }
    const deduped = [...tagIdsByAssetId.entries()].map(([supportingAssetId, tagIds]) => ({ supportingAssetId, tagIds: [...tagIds] }));
    for (let i = 0; i < deduped.length; i += BATCH_CHUNK_SIZE) {
      await repo.setAssetTagsBatch(tenantId, connectorId, deduped.slice(i, i + BATCH_CHUNK_SIZE));
    }
  },

  /**
   * Mirrors one connector's asset groups (#3152, section 2): each reported group is created or
   * updated on its `(connector, sourceGroupId)`, and this connector's memberships are made equal to
   * the members reported (a dynamic group's members as its filter resolved them at sync time). Rows
   * a person or XTM One wrote are never touched. With `complete`, a group of this connector the
   * listing no longer reports is deleted with its memberships; an incomplete listing deletes nothing.
   * Called once per run with every group of the connector, as its memberships are replaced whole.
   */
  syncConnectorAssetGroups: async ({ atomic, eventOrigin }, connectorId: string, groups: Array<{ sourceGroupId: string, name: string, description: string | null, supportingAssetIds: Array<string> }>, complete: boolean) => {
    const tenantId = requireTenantId(eventOrigin);
    return atomic(async ({ repo }) => {
      const stored = (await repo.findAssetGroups()).flatMap((group) =>
        group.connectorId === connectorId && group.sourceGroupId !== null ? [{ ...group, sourceGroupId: group.sourceGroupId }] : []);
      const storedBySourceId = new Map(stored.map((group) => [group.sourceGroupId, group]));
      const wanted: Array<{ assetGroupId: string, supportingAssetId: string }> = [];
      const reported = new Set<string>();
      for (const group of groups) {
        const name = group.name.trim();
        if (name.length === 0 || reported.has(group.sourceGroupId)) {
          continue;
        }
        reported.add(group.sourceGroupId);
        const description = group.description?.trim() || null;
        const existing = storedBySourceId.get(group.sourceGroupId);
        let groupId: string;
        if (existing) {
          groupId = existing.id;
          await repo.updateAssetGroup(groupId, {
            name: existing.name === name ? undefined : name,
            description: existing.description === description ? undefined : description,
          });
        } else {
          groupId = uuidv7();
          await repo.insertAssetGroup({ id: groupId, tenantId, name, description, connectorId, sourceGroupId: group.sourceGroupId });
        }
        for (const supportingAssetId of new Set(group.supportingAssetIds)) {
          wanted.push({ assetGroupId: groupId, supportingAssetId });
        }
      }
      const held = await repo.findGroupMembershipsOfAuthor({ source: 'connector', connectorId });
      const { staleIds, missing } = diffMemberships(held, wanted);
      await repo.deleteGroupMembers(staleIds);
      await repo.insertGroupMembers(missing.map((row) => ({ id: uuidv7(), tenantId, ...row, source: 'connector' as const, connectorId, authorUserId: null })));
      const gone = complete ? stored.filter((group) => !reported.has(group.sourceGroupId)).map((group) => group.id) : [];
      await repo.deleteAssetGroups(gone);
      return { groups: reported.size, membersAdded: missing.length, membersRemoved: staleIds.length, groupsDeleted: gone.length };
    });
  },

  /** The tenant's asset groups with their distinct asset count, for the group filter and column. */
  listAssetGroups: async ({ repo }) => {
    const [groups, counts] = await Promise.all([repo.findAssetGroups(), repo.countAssetsByGroup()]);
    return groups.map(({ id, name, description, externalReference, connectorId }) => ({
      id, name, description, externalReference, fromConnector: connectorId !== null, assetCount: counts.get(id) ?? 0,
    }));
  },

  /** The tenant's root tags (a merged one is not offered), for a tag picker — not just what one asset already carries. */
  listTags: async ({ repo }) => {
    const vocabulary = await repo.findAllTags();
    return vocabulary
      .filter((tag) => tag.mergedIntoTagId === null)
      .map(({ id, name, color }) => ({ id, name, color }));
  },

  /** Every tag of the tenant, merged ones included, with its origins and the assets reaching it through the tags merged into it. */
  listManagedTags: async ({ repo }) => {
    const [vocabulary, origins, directCounts, pointers] = await Promise.all([
      repo.findAllTags(),
      repo.findTagOriginsWithConnector(),
      repo.countAssetsByTagIds(),
      repo.findMergedTagPointers(),
    ]);
    const familyTagIds = [...new Set([...pointers.keys(), ...pointers.values()])];
    const familyLinks = await repo.findTagAssetLinks(familyTagIds);
    const assetCounts = subtreeAssetCounts({
      tagIds: vocabulary.map((tag) => tag.id),
      pointers,
      directCounts,
      familyLinks,
    });
    return assembleManagedTags({ vocabulary, origins, assetCounts });
  },

  renameTag: async ({ atomic }, tagId: string, rawName: string) => {
    const name = rawName.trim();
    try {
      await atomic(async ({ repo }) => {
        const [tag] = await repo.findTagsByIds([tagId]);
        if (!tag) {
          throw new TagNotFoundError();
        }
        if (tag.name === name) {
          return;
        }
        await repo.updateTagName(tagId, name);
      });
    } catch (error) {
      if (isUniqueViolationOf(error, TAG_NAME_UNIQUE)) {
        throw new TagNameTakenError();
      }
      throw error;
    }
  },

  mergeTag: async ({ atomic }, tagId: string, targetTagId: string) => {
    await atomic(async ({ repo }) => {
      await repo.lockTags([tagId, targetTagId]);
      const found = await repo.findTagsByIds([tagId, targetTagId]);
      if (!found.some((tag) => tag.id === tagId) || !found.some((tag) => tag.id === targetTagId)) {
        throw new TagNotFoundError();
      }
      const refusal = checkTagMerge(await repo.findMergedTagPointers(), tagId, targetTagId);
      if (refusal !== null) {
        throw new TagMergeRefusedError(refusal);
      }
      await repo.setTagMergedInto(tagId, targetTagId, new Date());
    });
  },

  unmergeTag: async ({ atomic }, tagId: string) => {
    await atomic(async ({ repo }) => {
      const [tag] = await repo.findTagsByIds([tagId]);
      if (!tag) {
        throw new TagNotFoundError();
      }
      if (tag.mergedIntoTagId === null) {
        throw new TagMergeRefusedError('notMerged');
      }
      await repo.setTagMergedInto(tagId, null, null);
    });
  },

  /** Deletes the tag, and with it every tag merged into it. */
  deleteTag: async ({ atomic }, tagId: string) => {
    await atomic(async ({ repo }) => {
      const [tag] = await repo.findTagsByIds([tagId]);
      if (!tag) {
        throw new TagNotFoundError();
      }
      await repo.deleteTag(tagId);
    });
  },

  /**
   * Rebuilds one connector's `sourceAssetId → supportingAssetId` map from what is already on file,
   * for a resumed sync to pick up where it left off without carrying the map through job state.
   */
  getInventoryAssetIdMap: async ({ repo }, connectorId: string) => {
    const rows = await repo.findSourceAssetIdMapForConnector(connectorId);
    return new Map(rows.map((r) => [r.sourceAssetId, r.supportingAssetId]));
  },
});
