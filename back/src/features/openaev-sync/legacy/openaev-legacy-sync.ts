import type { JobContext } from '@app/module';
import type { CveEvidenceRow, ExpectationEvidenceRow, OpenaevSyncPayload, OpenaevSyncState, TenantOutput } from '../openaev-types';
import type { OpenaevLegacyClient } from './openaev-legacy-client';
import type { InjectResponse, LegacyExerciseEntry, OpenaevCveRawRow } from './openaev-legacy-types';
import type { CveFindingsTransaction } from '../cve-findings-transaction';
import { mapWithConcurrency, sleep } from '../../../utils';
import { createLogger } from '../../../utils/logger';
import { OpenaevNotFoundError } from '../openaev-api-client';
import { DESCRIPTION_FETCH_BUDGET, descriptionBudgetShare } from '../openaev-description-phase';
import { mapExpectationType } from '../openaev-mapping-utils';
import { paginateUntilWatermark, streamUntilWatermark } from './openaev-legacy-client';
import { buildCveEvidenceRows, buildExpectationEvidenceRows, chunkCveRowsByAsset, collectCveRawRows } from './openaev-legacy-mapping';

const { logTrace, logWarn, logFromError } = createLogger({ feature: 'openaev-sync' });

const DELAY_BETWEEN_EXERCISES_MS = 100;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Bounds the `GET /injects/{id}` calls in flight: OpenAEV serves one inject per call. */
const FETCH_CONCURRENCY = 8;
/**
 * Assets per CVE write. One chunk is one `bulkUpsertEvidence` transaction, and a tenant's whole
 * sync window would otherwise be one: a dense estate reports tens of thousands of (CVE, asset)
 * pairs, minutes of work holding the same transaction open.
 */
const CVE_ASSET_BATCH_SIZE = 200;

/** The service methods the legacy run calls, as plain functions so a test can hand them over as `vi.fn()`. */
export interface LegacySyncServices {
  openaevConnector: {
    forgetSnapshotState: (connectorId: string) => Promise<void>,
  },
  integrationSettings: {
    getIntegrationSettings: (source: 'openaev') => Promise<{ lastReportedAt: Date | null } | null | undefined>,
    markSynced: (source: 'openaev', syncedAt: Date) => Promise<unknown>,
  },
  supportingAssets: {
    getInventoryAssetIdMap: (connectorId: string) => Promise<Map<string, string>>,
    bulkUpsertEvidence: (evidences: Array<ExpectationEvidenceRow | CveEvidenceRow>) => Promise<unknown>,
    markAssetsEnumerated: (params: { connectorId: string, supportingAssetIds: Array<string>, scope: string, enumeratedAt: Date }) => Promise<unknown>,
    recomputeEvidenceStateForAssets: (params: { supportingAssetIds: Array<string>, reason: string }) => Promise<unknown>,
    findCveScopePairsSince: (connectorId: string, since: Date) => Promise<Array<{ supportingAssetId: string, scope: string }>>,
    markScopesEnumerated: (params: { connectorId: string, pairs: Array<{ supportingAssetId: string, scope: string }>, enumeratedAt: Date }) => Promise<unknown>,
  },
  mitreAttack: {
    getTechniqueIdsByExternalIds: (externalIds: Array<string>) => Promise<Map<string, string>>,
  },
}

export interface LegacySyncDeps {
  ctx: JobContext<OpenaevSyncPayload, OpenaevSyncState>,
  svc: LegacySyncServices,
  inCveFindingsTransaction: CveFindingsTransaction,
  connectorId: string,
  client: OpenaevLegacyClient,
  openaevTenants: ReadonlyArray<TenantOutput>,
  /** The whole-inventory pass of one OpenAEV tenant, which resolves to its OpenAEV asset id to supporting asset id map. */
  buildTenantInventory: (openaevTenantId: string) => Promise<Map<string, string>>,
  /** The description phase of one OpenAEV tenant, spending at most `budget` calls. */
  syncTenantDescriptions: (openaevTenantId: string, budget: number) => Promise<{ calls: number }>,
}

/**
 * Reads an OpenAEV that serves no snapshot route the way the connector did before the snapshot
 * streams: the inventory on every run, the CVE findings of each OpenAEV tenant, then the finished
 * exercises changed since the last completed run (never more than seven days back), oldest first,
 * each one's expectations written as evidence and judged against the scenario it replays.
 *
 * It first forgets the stream cursors and the attack observation mirror, so the next run on an
 * OpenAEV that serves the snapshot routes starts from a full walk. Evidence it wrote lands on the
 * same keys as the snapshot path's, so a switch in either direction creates no duplicate.
 *
 * A findings call that fails for one OpenAEV tenant (a token without `ACCESS_FINDINGS`) does not
 * stop the exercises: the run completes, but leaves `last_reported_at` where it was so the next one
 * reads the same window again. A resumed job skips the inventory, the CVE findings phase and the
 * exercises already done, by the state it checkpointed.
 */
export const runLegacySync = async (deps: LegacySyncDeps): Promise<void> => {
  const { ctx, svc, connectorId, client, openaevTenants, buildTenantInventory, syncTenantDescriptions, inCveFindingsTransaction } = deps;

  await svc.openaevConnector.forgetSnapshotState(connectorId);

  const syncStartedAt = ctx.state?.syncStartedAt ? new Date(ctx.state.syncStartedAt) : new Date();
  const sevenDaysAgo = new Date(Date.now() - WINDOW_MS);
  const rawWatermark = (await svc.integrationSettings.getIntegrationSettings('openaev'))?.lastReportedAt ?? null;
  const watermark = new Date(Math.max((rawWatermark ?? sevenDaysAgo).getTime(), sevenDaysAgo.getTime()));
  logTrace('Starting OpenAEV legacy sync', { tenantId: ctx.tenantId, watermark, attempt: ctx.attempt });
  await ctx.updateProgress({ message: 'OpenAEV snapshot export is off, reading exercises and findings' });

  const injectCache = new Map<string, InjectResponse>();
  const getInjectData = async (openaevTenantId: string, injectId: string): Promise<InjectResponse> => {
    const key = `${openaevTenantId}:${injectId}`;
    const cached = injectCache.get(key);
    if (cached) {
      return cached;
    }
    const inject = await client.getInject(openaevTenantId, injectId);
    injectCache.set(key, inject);
    return inject;
  };

  // Drops an id the inventory pass never saw (created in OpenAEV between the two passes, so it
  // arrives fully on the next run) rather than upserting a bare-bones asset for it on the spot.
  const resolveAgainstInventory = (
    tenantAssetMap: Map<string, string>,
    assetIds: ReadonlyArray<string>,
  ): Map<string, string> => {
    const resolved = new Map<string, string>();
    for (const assetId of assetIds) {
      const supportingAssetId = tenantAssetMap.get(assetId);
      if (supportingAssetId !== undefined) {
        resolved.set(assetId, supportingAssetId);
      }
    }
    return resolved;
  };

  // Returns the resolved supportingAssetId map so the caller can mark it enumerated under the
  // scenario's scope once the expectation evidence above is written.
  const processExpectationsPhase = async (
    exerciseId: string,
    openaevTenantId: string,
    scenarioId: string,
    scenarioName: string | null,
    exerciseUpdatedAt: string | null,
    exerciseName: string | null,
    tenantAssetMap: Map<string, string>,
  ): Promise<Map<string, string>> => {
    const expectations = await client.getExerciseExpectations(openaevTenantId, exerciseId);
    const relevant = expectations.filter(
      (e) =>
        mapExpectationType(e.inject_expectation_type) !== null &&
        e.inject_expectation_asset != null &&
        e.inject_expectation_inject != null,
    );
    logTrace('Expectations', { exerciseId, total: expectations.length, relevant: relevant.length });

    if (relevant.length === 0) {
      return new Map();
    }

    const injectIds = [...new Set(relevant.map((e) => e.inject_expectation_inject!))];
    logTrace('Injects', { exerciseId, total: injectIds.length });
    const exerciseInjectPatterns = new Map<string, Array<string>>();
    const injectTitleMap = new Map<string, string | null>();
    await mapWithConcurrency(injectIds, FETCH_CONCURRENCY, async (injectId) => {
      const inject = await getInjectData(openaevTenantId, injectId);
      exerciseInjectPatterns.set(injectId, inject.inject_attack_patterns.map((ap) => ap.attack_pattern_external_id));
      injectTitleMap.set(injectId, inject.inject_title ?? null);
    }, ctx.signal);
    if (ctx.signal.aborted) {
      return new Map();
    }

    const allExternalIds = [...new Set([...exerciseInjectPatterns.values()].flat())];
    const techniqueIdMap: Map<string, string> = allExternalIds.length > 0
      ? await svc.mitreAttack.getTechniqueIdsByExternalIds(allExternalIds)
      : new Map();
    logTrace('Techniques resolved', { exerciseId, requested: allExternalIds.length, resolved: techniqueIdMap.size });

    const expectationAssetIds = [...new Set(relevant.map((e) => e.inject_expectation_asset!))];
    const assetIdMap = resolveAgainstInventory(tenantAssetMap, expectationAssetIds);
    logTrace('Expectation assets resolved', { exerciseId, resolved: assetIdMap.size, total: expectationAssetIds.length });

    const skippedTechniques = new Set<string>();
    const evidenceRows = buildExpectationEvidenceRows({
      relevant,
      assetIdMap,
      exerciseInjectPatterns,
      injectTitleMap,
      techniqueIdMap,
      scenarioId,
      scenarioName,
      exerciseId,
      exerciseUpdatedAt,
      exerciseName,
      connectorId,
      onSkippedTechnique: (externalId) => skippedTechniques.add(externalId),
    });
    if (evidenceRows.length > 0) {
      await svc.supportingAssets.bulkUpsertEvidence(evidenceRows);
    }
    logTrace('Expectation evidence', {
      exerciseId,
      rows: evidenceRows.length,
      skippedUnknownTechniques: skippedTechniques.size,
    });

    return assetIdMap;
  };

  const processCveFindingsPhase = async (
    openaevTenantId: string,
    tenantAssetMap: Map<string, string>,
  ): Promise<void> => {
    // Each page is flattened on arrival and dropped: a finding is parsed with `looseObject`, and a
    // whole sync window of them would stay reachable for the entire phase where seven fields per
    // (CVE, asset) pair are what it goes on to read.
    const rawCveRows: Array<OpenaevCveRawRow> = [];
    await streamUntilWatermark(
      (page) => client.searchFindings(openaevTenantId, page),
      (finding) => finding.finding_updated_at,
      watermark,
      ctx.signal,
      (findings) => rawCveRows.push(...collectCveRawRows(findings)),
      (pages) => logWarn('OpenAEV CVE findings truncated: pagination reached max pages', {
        openaevTenantId,
        pages,
      }),
    );
    logTrace('CVE findings collected', { openaevTenantId, rawRows: rawCveRows.length });

    if (rawCveRows.length === 0) {
      return;
    }

    let writtenRows = 0;
    for (const chunk of chunkCveRowsByAsset(rawCveRows, CVE_ASSET_BATCH_SIZE)) {
      if (ctx.signal.aborted) {
        return;
      }
      const cveAssetIdMap = resolveAgainstInventory(tenantAssetMap, [...new Set(chunk.map((r) => r.supportingAssetId))]);

      // This findings route serves neither CVSS nor the CISA exploit data OpenAEV's Vulnerability
      // entity carries, so those fields stay null.
      const uniqueCveIds = [...new Set(chunk.map((r) => r.cveIdentifier))];
      const cveEvidenceRows = await inCveFindingsTransaction(async (tx) => {
        await tx.cve.upsertCves(uniqueCveIds.map((cveId) => ({ cveId })));
        const cveIdMap = await tx.cve.getCveIdMap(uniqueCveIds);
        const rows = buildCveEvidenceRows({ rawCveRows: chunk, cveIdMap, cveAssetIdMap, connectorId });
        if (rows.length > 0) {
          await tx.supportingAssets.bulkUpsertEvidence(rows);
        }
        return rows;
      });
      writtenRows += cveEvidenceRows.length;
    }
    logTrace('CVE evidence', { openaevTenantId, rows: writtenRows });
  };

  // 1. Whole-inventory pass, every run: a resumed job rebuilds the map from what is already on
  // file instead of re-paginating every OpenAEV tenant. `sourceAssetId` is a connector-wide key
  // (`supporting_asset_sources`' own uniqueness), so the one rebuilt map serves every tenant.
  let assetIdMapByTenant: Map<string, Map<string, string>>;
  if (ctx.state?.inventoryComplete) {
    const rebuiltMap = await svc.supportingAssets.getInventoryAssetIdMap(connectorId);
    assetIdMapByTenant = new Map(openaevTenants.map((tenant) => [tenant.tenant_id, rebuiltMap]));
    logTrace('Reusing OpenAEV inventory from a resumed job', { assets: rebuiltMap.size });
  } else {
    assetIdMapByTenant = new Map();
    for (const tenant of openaevTenants) {
      if (ctx.signal.aborted) {
        return;
      }
      assetIdMapByTenant.set(tenant.tenant_id, await buildTenantInventory(tenant.tenant_id));
    }
  }
  if (ctx.signal.aborted) {
    return;
  }

  // 2. CVE findings phase, once per OpenAEV tenant, before the checkpoint so that the checkpoint
  // records it complete. A tenant whose findings call fails takes nothing else down with it: OpenAEV
  // guards this route with `ACCESS_FINDINGS`, which the exercise route never required, so a token
  // that worked yesterday answers 403 today. The phase stays unmarked instead, which holds
  // `last_reported_at` back so the next run reads the same window again.
  let cveFindingsComplete = ctx.state?.cveFindingsComplete ?? false;
  if (!cveFindingsComplete) {
    await ctx.updateProgress({ message: 'Syncing OpenAEV CVE findings' });
    cveFindingsComplete = true;
    for (const [openaevTenantId, tenantAssetMap] of assetIdMapByTenant) {
      if (ctx.signal.aborted) {
        return;
      }
      try {
        await processCveFindingsPhase(openaevTenantId, tenantAssetMap);
      } catch (err) {
        logFromError(err, 'OpenAEV CVE findings phase failed, leaving this tenant\'s findings untouched', { openaevTenantId });
        cveFindingsComplete = false;
      }
    }
  }
  if (ctx.signal.aborted) {
    return;
  }

  if (!ctx.state?.inventoryComplete || !ctx.state.cveFindingsComplete) {
    // Gated on either flag, not just the inventory: a checkpoint with a complete inventory and no
    // CVE flag would otherwise reach the exercise loop without the phase it just ran ever being
    // recorded, and never recorded at all when the run has no exercise to checkpoint on.
    await ctx.saveStateSnapshot({
      exerciseEntries: ctx.state?.exerciseEntries ?? [],
      currentExerciseIndex: ctx.state?.currentExerciseIndex ?? 0,
      syncStartedAt: syncStartedAt.toISOString(),
      inventoryComplete: true,
      cveFindingsComplete,
    });
  }

  // 3. Finished exercises of every OpenAEV tenant since the watermark.
  const exerciseEntries: Array<LegacyExerciseEntry> = ctx.state?.exerciseEntries ? [...ctx.state.exerciseEntries] : [];

  if (exerciseEntries.length === 0) {
    await ctx.updateProgress({ message: `Listing exercises changed since ${watermark.toISOString()}` });
    for (const tenant of openaevTenants) {
      if (ctx.signal.aborted) {
        return;
      }
      const exercises = await paginateUntilWatermark(
        (page) => client.searchExercises(tenant.tenant_id, page),
        (ex) => ex.exercise_updated_at,
        watermark,
        ctx.signal,
        (pages) => logWarn('OpenAEV exercise list truncated: pagination reached max pages', {
          openaevTenantId: tenant.tenant_id,
          pages,
        }),
      );
      for (const ex of exercises) {
        exerciseEntries.push({ exerciseId: ex.exercise_id, openaevTenantId: tenant.tenant_id, exerciseUpdatedAt: ex.exercise_updated_at ?? null, exerciseName: ex.exercise_name ?? null });
      }
    }
    // Oldest first: the exercises arrive newest first, and a source drops an observation older than
    // the verdict it holds, so a verdict that changed between two exercises would never be logged.
    exerciseEntries.sort((a, b) => (a.exerciseUpdatedAt ? new Date(a.exerciseUpdatedAt).getTime() : 0) - (b.exerciseUpdatedAt ? new Date(b.exerciseUpdatedAt).getTime() : 0));
    logTrace(`Exercises to process: ${exerciseEntries.length}`);
  }

  // 4. Each exercise.
  const startIndex = ctx.state?.currentExerciseIndex ?? 0;
  await ctx.updateProgress({ processedTotal: startIndex, expectedTotal: exerciseEntries.length });

  for (let i = startIndex; i < exerciseEntries.length; i++) {
    if (ctx.signal.aborted) {
      return;
    }
    const { exerciseId, openaevTenantId, exerciseUpdatedAt, exerciseName } = exerciseEntries[i];
    const tenantAssetMap = assetIdMapByTenant.get(openaevTenantId) ?? new Map<string, string>();

    logTrace(`Processing exercise ${i + 1} of ${exerciseEntries.length}: ${exerciseName ?? exerciseId}`);
    await ctx.updateProgress({
      message: `Processing exercise ${i + 1} of ${exerciseEntries.length}${exerciseName ? `: ${exerciseName}` : ''}`,
    });

    try {
      const exercise = await client.getExercise(openaevTenantId, exerciseId);
      const scenarioId = exercise.exercise_scenario ?? exerciseId;
      let scenarioName: string | null = null;
      if (exercise.exercise_scenario) {
        try {
          const scenario = await client.getScenario(openaevTenantId, exercise.exercise_scenario);
          scenarioName = scenario.scenario_name ?? null;
        } catch (err) {
          if (err instanceof OpenaevNotFoundError) {
            logFromError(err, 'OpenAEV scenario not found, continuing without scenario name', { exerciseId, scenarioId: exercise.exercise_scenario });
          } else {
            throw err;
          }
        }
      }

      // Taken before the exercise's expectation evidence is written, so that evidence compares as
      // fresher than the mark this call leaves behind.
      const enumeratedAt = new Date();
      const assetIdMap = await processExpectationsPhase(
        exerciseId,
        openaevTenantId,
        scenarioId,
        scenarioName,
        exerciseUpdatedAt,
        exerciseName,
        tenantAssetMap,
      );
      if (ctx.signal.aborted) {
        return;
      }

      // Replaying a scenario re-runs the same injects on the same targets, so what this run did not
      // report on an asset the expectations phase visited is a technique the scenario no longer
      // produces. A CVE is machine-scoped, not scenario-scoped: it is enumerated once for the
      // whole run below, since two exercises touching the same asset would otherwise let whichever
      // runs last make the other's CVEs look stale.
      if (assetIdMap.size > 0) {
        await svc.supportingAssets.markAssetsEnumerated({
          connectorId,
          supportingAssetIds: [...assetIdMap.values()],
          scope: scenarioId,
          enumeratedAt,
        });
        await svc.supportingAssets.recomputeEvidenceStateForAssets({
          supportingAssetIds: [...assetIdMap.values()],
          reason: 'No longer reported by OpenAEV',
        });
      }
    } catch (err) {
      if (err instanceof OpenaevNotFoundError) {
        logFromError(err, 'OpenAEV resource not found, skipping exercise', { exerciseId });
      } else {
        throw err;
      }
    }

    await ctx.saveStateSnapshot({
      exerciseEntries,
      currentExerciseIndex: i + 1,
      syncStartedAt: syncStartedAt.toISOString(),
      inventoryComplete: true,
      cveFindingsComplete,
    });
    await ctx.updateProgress({ processedTotal: i + 1, expectedTotal: exerciseEntries.length });
    await sleep(DELAY_BETWEEN_EXERCISES_MS, ctx.signal);
  }

  // 5. CVE coverage of the whole run, read back from what was written rather than accumulated
  // across exercises. Narrowed to the OpenAEV assets that did report a CVE: OpenAEV never says which
  // injects were capable of finding one, so an asset a run merely visited is no evidence its CVEs
  // were looked for. The cost is an asset whose vulnerabilities were all remediated at once, which
  // reports nothing and keeps its findings applicable until any CVE reappears on it.
  if (!ctx.signal.aborted) {
    const cveTouchedPairs = await svc.supportingAssets.findCveScopePairsSince(connectorId, syncStartedAt);
    if (cveTouchedPairs.length > 0) {
      await svc.supportingAssets.markScopesEnumerated({ connectorId, pairs: cveTouchedPairs, enumeratedAt: syncStartedAt });
      await svc.supportingAssets.recomputeEvidenceStateForAssets({
        supportingAssetIds: [...new Set(cveTouchedPairs.map((pair) => pair.supportingAssetId))],
        reason: 'No longer reported by OpenAEV',
      });
    }
  }

  // 6. The findings phase is watermarked: advancing past a window it failed to read would lose that
  // window for good, so the next run re-reads the window's exercises instead, which is idempotent.
  if (ctx.signal.aborted) {
    return;
  }
  if (cveFindingsComplete) {
    await ctx.updateProgress({ message: 'Recording the sync watermark' });
    await svc.integrationSettings.markSynced('openaev', syncStartedAt);
  } else {
    logWarn('OpenAEV CVE findings phase failed, holding the sync watermark back so the next run reads this window again', { watermark });
  }

  // 7. Descriptions come last, with the budget of the run shared by every OpenAEV tenant: the
  // inventory leaves them to this phase.
  let descriptionBudgetLeft = DESCRIPTION_FETCH_BUDGET;
  for (const [index, { tenant_id: openaevTenantId }] of openaevTenants.entries()) {
    if (ctx.signal.aborted) {
      return;
    }
    const { calls } = await syncTenantDescriptions(openaevTenantId, descriptionBudgetShare(descriptionBudgetLeft, openaevTenants.length - index));
    descriptionBudgetLeft -= calls;
  }
  logTrace(`OpenAEV legacy sync complete: ${exerciseEntries.length} exercises`);
};
