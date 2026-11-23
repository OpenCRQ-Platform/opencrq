import type { ConnectorAssetInput, JobHandler } from '@app/module';
import { allServiceDefinitions, createServices, isInventoryDue, NonRetryableError } from '@app/module';
import type { OpenaevAgent, OpenaevSyncPayload, OpenaevSyncState } from './openaev-types';
import type { CveFindingsTransaction } from './cve-findings-transaction';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { mapWithConcurrency } from '../../utils';
import { createLogger } from '../../utils/logger';
import { createOpenaevClient, paginateAll } from './openaev-api-client';
import { createOpenaevLegacyClient } from './legacy/openaev-legacy-client';
import { runLegacySync } from './legacy/openaev-legacy-sync';
import {
  assetToConnectorInput,
  enrichmentRouteOf,
  linkedPersonNameOf,
  mergeAiTargetDetail,
  mergeMachineDetail,
} from './openaev-mapping-utils';
import { DESCRIPTION_FETCH_BUDGET, descriptionBudgetShare, syncDescriptions } from './openaev-description-phase';
import { syncAssetGroups } from './openaev-group-phase';
import { syncAttackPaths } from './openaev-attack-path-phase';
import { syncOpenaevMarkings } from './openaev-marking-phase';
import { syncObservationStreams } from './openaev-observation-phase';
import { onCompleteMirrors } from './openaev-reconciliation-scope';
import { retireAttackEvidence, retireCveEvidence } from './openaev-retirement';

const { logTrace, logWarn, logFromError } = createLogger({ feature: 'openaev-sync' });

/** Bounds the OpenAEV calls in flight: the description phase's `GET /assets/{id}`, and the batches of ids the inventory looks up. */
const FETCH_CONCURRENCY = 8;
/** Ids per `/endpoints/find` call or `asset_id` lookup — kept in line with the search endpoints' own page size. */
const ID_BATCH_SIZE = 100;

const idBatchesOf = (ids: ReadonlyArray<string>): Array<Array<string>> =>
  Array.from({ length: Math.ceil(ids.length / ID_BATCH_SIZE) }, (_, i) =>
    ids.slice(i * ID_BATCH_SIZE, (i + 1) * ID_BATCH_SIZE));

/**
 * Assets per `bulkUpsertAssets` call. One call is one transaction, and its candidate lookup binds
 * one parameter per identifier the batch carries — hostnames, MACs, agent references, source ids —
 * against PostgreSQL's 65 535 limit. A whole inventory in one call reaches it on a real estate; a
 * batch resolves against what the previous ones committed, so splitting costs no match.
 */
const UPSERT_BATCH_SIZE = 500;

export const openaevSyncHandler: JobHandler<OpenaevSyncPayload, OpenaevSyncState> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }

  const openaevConfig = config().connectors?.openaev?.[ctx.tenantId];
  if (!openaevConfig) {
    throw new NonRetryableError('openaev connector config is missing for this tenant (connectors.openaev)');
  }

  const services = createServices([...allServiceDefinitions], dbEngine.db);

  const origin = { type: 'connector' as const, serviceAccountId: ctx.payload.serviceAccountId, tenantId: ctx.tenantId, job: { jobKind: ctx.kind, interactive: ctx.interactive } };
  const svc = services.withOrigin(origin);
  const inCveFindingsTransaction: CveFindingsTransaction = (work) =>
    dbEngine.db.transaction((tx) => work(createServices([...allServiceDefinitions], tx).withOrigin(origin)));
  // Marking definitions are written by the security manager's policy, which no connector holds: the
  // mirror of the source's vocabulary runs as the platform, as the OpenCTI consumer's does.
  const systemServices = services.withOrigin({ type: 'system' } as const);

  const connectorId = await svc.integrationSettings.getConnectorId('openaev');
  if (!connectorId) {
    throw new NonRetryableError('integration_settings row for openaev not found — configure the integration first');
  }
  logTrace('Connector resolved', { connectorId });

  const client = createOpenaevClient(openaevConfig.url, openaevConfig.token, ctx.signal);
  const legacyClient = createOpenaevLegacyClient(openaevConfig.url, openaevConfig.token, ctx.signal);

  // Tag links are keyed on the connector, and one connector spans every OpenAEV tenant of an
  // instance, so `setAssetTags` replacing this author's links would let the second sub-tenant's
  // pass drop the first's tags off an asset the matcher fused across the two (a shared hardware
  // uuid is well within tier 0). Accumulated for the whole run and unioned before every write.
  const tagIdsByAssetIdForRun = new Map<string, Set<string>>();

  // What the run did, recorded on the run as its step counts: the assets the inventory listed,
  // upserted and unregistered, and the findings the observations read, wrote, skipped and retired.
  // An inventory the observations ask for (an asset they do not know) counts as the inventory step.
  const inventoryCounts = { ran: false, read: 0, written: 0, removed: 0 };
  const findingCounts = { read: 0, written: 0, removed: 0, skipped: 0 };
  let observationMode: 'full' | 'incremental' = 'incremental';
  const recordInventoryCounts = () => ctx.updateProgress({
    stepCounts: {
      step: 'inventory',
      entity: 'assets',
      mode: 'full',
      read: inventoryCounts.read,
      written: inventoryCounts.written,
      created: null,
      removed: inventoryCounts.removed,
      skipped: Math.max(0, inventoryCounts.read - inventoryCounts.written),
    },
  });
  const recordFindingCounts = () => ctx.updateProgress({
    stepCounts: { step: 'observations', entity: 'findings', mode: observationMode, created: null, ...findingCounts },
  });

  // Read once per run, on the first inventory that needs it: an OpenAEV with its MARKING preview
  // feature off enforces no marking and shows every asset to everyone, so neither does OpenCRQ.
  let markingFeature: Promise<boolean> | null = null;
  const markingsActive = (): Promise<boolean> => {
    markingFeature ??= client.readMarkingFeature().then((feature) => {
      if (feature.active) {
        return true;
      }
      logTrace('OpenAEV markings are off on this instance: assets are synced unmarked', { reason: feature.reason });
      return false;
    });
    return markingFeature;
  };

  /**
   * The whole-inventory pass for one OpenAEV tenant: its tag vocabulary, then every asset's generic
   * attributes, then its machine or AI target properties (with the description each detail call
   * alone carries — see `mergeMachineDetail`/`mergeAiTargetDetail`), then a single upsert of the
   * assembled inputs with their tag links. Returns the map the observation phase resolves its
   * assets against. An inventory that ran to the end, listed something, truncated no list and
   * listed as many assets as every page reported also retires the CVEs of the tenant's registered
   * assets it did not report and a lookup by id no longer finds, then unregisters them.
   */
  const buildTenantInventory = async (openaevTenantId: string): Promise<Map<string, string>> => {
    const sourceAssetIdToSupportingAssetId = new Map<string, string>();
    // The input each asset is finally upserted with: the inventory row's generic attributes,
    // overlaid with whatever detail call carries its identity. Nothing is written before that
    // overlay is complete — `bulkUpsertAssets` keeps the canonical id it already holds for a
    // `(connectorId, sourceAssetId)` pair and never runs the matcher on it again, so a first
    // upsert without the hostname and the agent reference would fix an OpenAEV endpoint on an
    // asset of its own, permanently out of reach of the Defender device behind it.
    const finalInputBySourceAssetId = new Map<string, ConnectorAssetInput>();
    // Kept alongside the mapped input because the inventory row is the only payload embedding an
    // agent's executor, which the detail row reduces to its id (see `agentIdentityOf`).
    const agentsBySourceAssetId = new Map<string, ReadonlyArray<OpenaevAgent>>();
    const tagIdsBySourceAssetId = new Map<string, Array<string>>();
    const machineAssetIds: Array<string> = [];
    const overviewAssetIds: Array<string> = [];

    await ctx.updateProgress({ message: `Syncing OpenAEV tags for tenant ${openaevTenantId}` });
    const sourceTags = await client.listTags(openaevTenantId);
    const tagIdBySourceTagId = sourceTags.length > 0
      ? await svc.supportingAssets.upsertTagVocabulary(
        connectorId,
        sourceTags.map((t) => ({ sourceTagId: t.tag_id, name: t.tag_name, color: t.tag_color ?? null })),
      )
      : new Map<string, string>();
    logTrace('OpenAEV tag vocabulary upserted', { openaevTenantId, tags: sourceTags.length });

    // Before the inventory, so every asset's `asset_markings` reads as the STIX ids the tenant's
    // clearance names (CTEM marking parity, G4). With OpenAEV's markings off, no marking is read
    // and `null` maps every asset unmarked, which also clears the refs an earlier run wrote.
    let markingStixIdByOpenaevId: Map<string, string> | null = null;
    if (await markingsActive()) {
      await ctx.updateProgress({ message: `Syncing OpenAEV marking definitions for tenant ${openaevTenantId}` });
      markingStixIdByOpenaevId = await syncOpenaevMarkings({
        listAssignableMarkingDefinitions: client.listAssignableMarkingDefinitions,
        syncMarkingDefinitions: (markings) => systemServices.markingDefinitions.syncMarkingDefinitions(ctx.tenantId, markings),
        warn: logWarn,
        signal: ctx.signal,
      }, openaevTenantId);
      logTrace('OpenAEV marking definitions mirrored', { openaevTenantId, markings: markingStixIdByOpenaevId.size });
    }

    if (ctx.signal.aborted) {
      return sourceAssetIdToSupportingAssetId;
    }

    let truncated = false;
    await ctx.updateProgress({ message: `Syncing OpenAEV asset inventory for tenant ${openaevTenantId}` });
    // Drained into the maps above rather than kept as a list: every row is parsed with
    // `looseObject`, so it holds each of the ~40 fields OpenAEV serves where later phases read ten
    // of them, and a list of them would stay reachable for the whole tenant pass.
    const collectInventory = async () => {
      const { items: inventoryRows, totalElements } = await paginateAll(
        (page) => client.searchAssets(openaevTenantId, page),
        ctx.signal,
        (pages) => {
          truncated = true;
          logWarn('OpenAEV asset inventory truncated: pagination reached max pages', { openaevTenantId, pages });
        },
      );
      for (const row of inventoryRows) {
        const { input, tagIds } = assetToConnectorInput(row, connectorId, tagIdBySourceTagId, markingStixIdByOpenaevId);
        finalInputBySourceAssetId.set(input.sourceAssetId, input);
        tagIdsBySourceAssetId.set(input.sourceAssetId, tagIds);
        if (row.asset_agents) {
          agentsBySourceAssetId.set(input.sourceAssetId, row.asset_agents);
        }
        const route = enrichmentRouteOf(row);
        if (route === 'endpoint') {
          machineAssetIds.push(row.asset_id);
        } else if (route === 'overview') {
          overviewAssetIds.push(row.asset_id);
        }
      }
      return totalElements;
    };
    const listedTotal = await collectInventory();
    if (ctx.signal.aborted) {
      return sourceAssetIdToSupportingAssetId;
    }
    // A shifted offset skips an asset without a trace, and pruning would take it for deleted.
    const listingComplete = listedTotal === finalInputBySourceAssetId.size;
    if (!listingComplete) {
      logWarn('OpenAEV asset inventory changed while it was read: no asset is unregistered in this run', {
        openaevTenantId, listed: finalInputBySourceAssetId.size, reported: listedTotal,
      });
    }
    logTrace('OpenAEV asset inventory listed', { openaevTenantId, assets: finalInputBySourceAssetId.size });

    if (machineAssetIds.length > 0) {
      await ctx.updateProgress({ message: `Enriching machine identities for OpenAEV tenant ${openaevTenantId}` });
      let enrichedMachines = 0;
      await mapWithConcurrency(idBatchesOf(machineAssetIds), FETCH_CONCURRENCY, async (batchIds) => {
        const endpoints = await client.findEndpoints(openaevTenantId, batchIds);
        for (const endpoint of endpoints) {
          const base = finalInputBySourceAssetId.get(endpoint.asset_id);
          // Not in this run's inventory page (deleted/renamed between the two calls): picked up
          // fully on the next run rather than upserted with a guessed category here.
          if (base) {
            finalInputBySourceAssetId.set(endpoint.asset_id, mergeMachineDetail(base, endpoint, agentsBySourceAssetId.get(endpoint.asset_id)));
            enrichedMachines += 1;
          }
        }
      }, ctx.signal);
      logTrace('OpenAEV machine identities enriched', { openaevTenantId, enriched: enrichedMachines });
    }

    if (ctx.signal.aborted) {
      return sourceAssetIdToSupportingAssetId;
    }

    await ctx.updateProgress({ message: `Syncing OpenAEV AI targets for tenant ${openaevTenantId}` });
    const { items: aiTargets } = await paginateAll(
      (page) => client.searchAiTargets(openaevTenantId, page),
      ctx.signal,
      (pages) => {
        truncated = true;
        logWarn('OpenAEV AI target list truncated: pagination reached max pages', { openaevTenantId, pages });
      },
    );
    let enrichedAiTargets = 0;
    for (const asset of aiTargets) {
      const base = finalInputBySourceAssetId.get(asset.asset_id);
      if (base) {
        finalInputBySourceAssetId.set(asset.asset_id, mergeAiTargetDetail(base, asset));
        enrichedAiTargets += 1;
      }
    }
    logTrace('OpenAEV AI targets enriched', { openaevTenantId, enriched: enrichedAiTargets });

    if (ctx.signal.aborted) {
      return sourceAssetIdToSupportingAssetId;
    }

    // The detail calls serve `asset_linked_person` as an OpenAEV user id, which says nothing to a
    // reader here. Resolved in one batch for the whole tenant, and stored as the name rather than
    // the id: OpenAEV's directory is reachable from the connector and from nowhere else.
    const linkedPersonIds = [...new Set([...finalInputBySourceAssetId.values()].flatMap((input) => (input.linkedPerson ? [input.linkedPerson] : [])))];
    if (linkedPersonIds.length > 0) {
      const usersById = new Map((await client.findUsers(openaevTenantId, linkedPersonIds)).map((user) => [user.user_id, user]));
      for (const [sourceAssetId, input] of finalInputBySourceAssetId) {
        if (input.linkedPerson) {
          finalInputBySourceAssetId.set(sourceAssetId, { ...input, linkedPerson: linkedPersonNameOf(usersById.get(input.linkedPerson)) });
        }
      }
      logTrace('OpenAEV linked persons resolved', { openaevTenantId, requested: linkedPersonIds.length, resolved: usersById.size });
    }

    // Everything the two batch routes do not answer for — a web application, an identity, a SaaS
    // application, or a machine-family category stored as a generic asset — has its description,
    // url and linked person served by `GET /assets/{id}` alone, one call each. The description phase
    // spends a bounded budget of those calls per run; the inventory only carries back what it
    // stored, so an upsert never erases it. Done after the linked persons are resolved: what is
    // stored is already a name, which the user lookup would not know.
    if (overviewAssetIds.length > 0) {
      const stored = await svc.supportingAssets.getReportedOverviewFields(connectorId, overviewAssetIds);
      for (const assetId of overviewAssetIds) {
        const base = finalInputBySourceAssetId.get(assetId);
        if (base) {
          const { description = null, url = null, linkedPerson = null } = stored.get(assetId) ?? {};
          finalInputBySourceAssetId.set(assetId, { ...base, description, url, linkedPerson });
        }
      }
      logTrace('OpenAEV generic assets carried with their stored overview fields', { openaevTenantId, assets: overviewAssetIds.length, stored: stored.size });
    }

    if (ctx.signal.aborted) {
      return sourceAssetIdToSupportingAssetId;
    }

    const finalInputs = [...finalInputBySourceAssetId.values()];
    for (let i = 0; i < finalInputs.length; i += UPSERT_BATCH_SIZE) {
      if (ctx.signal.aborted) {
        return sourceAssetIdToSupportingAssetId;
      }
      const upserted = await svc.supportingAssets.bulkUpsertAssets(finalInputs.slice(i, i + UPSERT_BATCH_SIZE));
      for (const [sourceAssetId, supportingAssetId] of upserted) {
        sourceAssetIdToSupportingAssetId.set(sourceAssetId, supportingAssetId);
      }
      // Every asset upserted this run gets its own tag links from this connector replaced,
      // including one now carrying none at all: a tag OpenAEV removed must disappear here too,
      // but another source's own links on the same asset must not.
      const tagLinkEntries = [...upserted.entries()].map(([sourceAssetId, supportingAssetId]) => {
        const tagIds = tagIdsByAssetIdForRun.get(supportingAssetId) ?? new Set<string>();
        for (const tagId of tagIdsBySourceAssetId.get(sourceAssetId) ?? []) {
          tagIds.add(tagId);
        }
        tagIdsByAssetIdForRun.set(supportingAssetId, tagIds);
        return { supportingAssetId, tagIds: [...tagIds] };
      });
      await svc.supportingAssets.setAssetTags(connectorId, tagLinkEntries);
      inventoryCounts.written += upserted.size;
    }
    inventoryCounts.ran = true;
    inventoryCounts.read += finalInputs.length;
    logTrace('OpenAEV asset inventory upserted', { openaevTenantId, assets: finalInputs.length });

    if (finalInputs.length > 0) {
      const overviewAssetIdSet = new Set(overviewAssetIds);
      await svc.openaevConnector.upsertAssets({
        connectorId,
        assets: finalInputs.map(({ sourceAssetId }) => ({
          sourceAssetId,
          openaevTenantId,
          needsDescriptionFetch: overviewAssetIdSet.has(sourceAssetId),
        })),
      });
    }

    // OpenAEV deletes an asset's vulnerability documents with the asset, so no stream will ever report
    // them again: the CVEs go first and the rows after, which a crash between the two redoes at the
    // next inventory. An inventory that listed nothing is no proof of anything.
    if (!ctx.signal.aborted && !truncated && listingComplete && finalInputs.length > 0) {
      const unreported = await svc.openaevConnector.listUnreportedAssets({
        connectorId,
        openaevTenantId,
        reportedSourceAssetIds: [...finalInputBySourceAssetId.keys()],
      });
      // A delete and an insert between two pages keep both counts equal while hiding a skipped asset,
      // so each unlisted one is asked for by id before it is taken for deleted.
      const gone: Array<string> = [];
      await mapWithConcurrency(idBatchesOf(unreported), FETCH_CONCURRENCY, async (batchIds) => {
        const stillListed = await client.findListedAssetIds(openaevTenantId, batchIds);
        gone.push(...batchIds.filter((id) => !stillListed.has(id)));
      }, ctx.signal);
      if (!ctx.signal.aborted && gone.length > 0) {
        const pairs = await svc.supportingAssets.findCveScopePairsSince(connectorId, new Date(0), gone);
        findingCounts.removed += await retireCveEvidence({ svc, connectorId, pairs, enumeratedAt: new Date() });
        await svc.openaevConnector.pruneAssets({ connectorId, openaevTenantId, sourceAssetIds: gone });
        inventoryCounts.removed += gone.length;
        logTrace('OpenAEV assets no longer listed retired and unregistered', { openaevTenantId, assets: gone.length });
      }
    }

    return sourceAssetIdToSupportingAssetId;
  };

  const syncTenantDescriptions = (openaevTenantId: string, budget: number) => syncDescriptions({
    client,
    svc,
    connectorId,
    openaevTenantId,
    budget,
    concurrency: FETCH_CONCURRENCY,
    signal: ctx.signal,
    now: () => new Date(),
    onProgress: ({ processed, total }) => ctx.updateProgress({
      message: `Fetching OpenAEV asset descriptions of tenant ${openaevTenantId}, ${processed} of ${total}`,
    }),
  });

  try {
    const openaevTenants = await client.listTenants();
    logTrace(`OpenAEV tenants: ${openaevTenants.length}`);

    // Fallback for an OpenAEV whose `BULK_SNAPSHOT_EXPORT` preview flag is off, to delete with
    // `legacy/` once none is. The flag is instance-wide, so one tenant's answer stands for
    // them all.
    if (openaevTenants.length > 0) {
      const probedTenantId = openaevTenants[0].tenant_id;
      if (await legacyClient.probeSnapshotExport(probedTenantId) === 'unavailable') {
        logWarn('OpenAEV answers 404 on the snapshot routes, its BULK_SNAPSHOT_EXPORT preview feature is off: reading exercises and findings instead', { openaevTenantId: probedTenantId });
        await runLegacySync({ ctx, svc, inCveFindingsTransaction, connectorId, client: legacyClient, openaevTenants, buildTenantInventory, syncTenantDescriptions });
        return;
      }
    }

    // 1. Inventory, when due. `last_reported_at` is the end of the last inventory, so a connector
    // that never completed one, whose last is older than a day, or whose administrator asked for one
    // (`inventory_requested_at`), rebuilds it for every OpenAEV tenant; otherwise the asset map is
    // rebuilt from what is on file. A resumed job whose inventory was checkpointed does neither:
    // `sourceAssetId` is a connector-wide key (`supporting_asset_sources`' own uniqueness), so the
    // one rebuilt map serves every tenant.
    const resumedAfterInventory = ctx.state?.inventoryComplete === true;
    const settings = await svc.integrationSettings.getIntegrationSettings('openaev');
    const inventoryStartedAt = new Date();
    const inventoryDue = !resumedAfterInventory
      && isInventoryDue(settings?.lastReportedAt ?? null, settings?.inventoryRequestedAt ?? null, inventoryStartedAt);

    const assetIdMapByTenant = new Map<string, Map<string, string>>();
    let inventoryRanInThisRun = resumedAfterInventory;
    if (inventoryDue) {
      for (const tenant of openaevTenants) {
        if (ctx.signal.aborted) {
          return;
        }
        assetIdMapByTenant.set(tenant.tenant_id, await buildTenantInventory(tenant.tenant_id));
      }
      if (ctx.signal.aborted) {
        return;
      }
      await ctx.updateProgress({ message: 'Reading OpenAEV asset groups' });
      await syncAssetGroups({ client, svc, connectorId, openaevTenantIds: openaevTenants.map((tenant) => tenant.tenant_id), assetIdMapByTenant });
      if (ctx.signal.aborted) {
        return;
      }
      await ctx.updateProgress({ message: 'Reading OpenAEV attack paths' });
      await syncAttackPaths({ client, svc, connectorId, openaevTenantIds: openaevTenants.map((tenant) => tenant.tenant_id), assetIdMapByTenant, observedAt: new Date() });
      if (ctx.signal.aborted) {
        return;
      }
      await ctx.updateProgress({ message: 'Recording the completed OpenAEV inventory' });
      await svc.integrationSettings.markSynced('openaev', new Date());
      // An ask booked once this inventory had started is newer than what it read, and stays.
      await svc.integrationSettings.clearInventoryRequest('openaev', inventoryStartedAt);
      // Checkpointed before the observation phase starts, so a crash during its network calls does
      // not repeat the inventory on retry.
      await ctx.saveStateSnapshot({ inventoryComplete: true });
      await recordInventoryCounts();
      inventoryRanInThisRun = true;
    } else {
      const rebuiltMap = await svc.supportingAssets.getInventoryAssetIdMap(connectorId);
      for (const tenant of openaevTenants) {
        assetIdMapByTenant.set(tenant.tenant_id, rebuiltMap);
      }
      logTrace('Reusing the OpenAEV inventory on file', { assets: rebuiltMap.size, resumed: resumedAfterInventory });
    }

    // 2. Observation streams, once per OpenAEV tenant. `runStartedAt` is taken before anything is
    // read: a stream whose reads were not reconciled is noted unreconciled from it.
    const runStartedAt = new Date();
    let observationsBeforeTenant = 0;
    let descriptionBudgetLeft = DESCRIPTION_FETCH_BUDGET;
    for (const [index, { tenant_id: openaevTenantId }] of openaevTenants.entries()) {
      if (ctx.signal.aborted) {
        return;
      }
      const received = { attack: 0, vulnerability: 0 };
      const result = await syncObservationStreams({
        client,
        svc,
        inCveFindingsTransaction,
        connectorId,
        openaevTenantId,
        runStartedAt,
        assetIdMap: assetIdMapByTenant.get(openaevTenantId) ?? new Map<string, string>(),
        ensureInventory: inventoryRanInThisRun ? () => Promise.resolve(null) : () => buildTenantInventory(openaevTenantId),
        signal: ctx.signal,
        now: () => new Date(),
        onProgress: async ({ stream, pages, observations }) => {
          received[stream] = observations;
          await ctx.updateProgress({
            processedTotal: observationsBeforeTenant + received.attack + received.vulnerability,
            message: `Reading OpenAEV ${stream} observations of tenant ${openaevTenantId}, page ${pages}`,
          });
        },
      });
      observationsBeforeTenant += received.attack + received.vulnerability;
      findingCounts.read += result.counts.read;
      findingCounts.written += result.counts.written;
      findingCounts.skipped += result.counts.skipped;
      if (result.attack.walked || result.vulnerability.walked) {
        observationMode = 'full';
      }
      // A cut-short phase may have run against a partial map, which retirement must not judge.
      if (ctx.signal.aborted) {
        return;
      }

      // 3. What the phase read is reconciled into evidence here, and only then is a walk it finished
      // ended and the stream marked reconciled: a failure before that leaves both for the next run,
      // which reads the end of the stream again and reconciles from the same instant. Retirement
      // resolves against every asset on file, since OpenAEV assets of any tenant can be folded onto
      // one OpenCRQ asset.
      const attackKey = { connectorId, openaevTenantId, stream: 'attack' as const };
      const attackWalk = result.attack.fullWalk;
      // A completed full walk is the only read that proves a document gone: its mirror rows are
      // cleaned first, so a removed document is no longer current when the sources are kept alive,
      // and it judges the whole estate, evidence with no mirror document included.
      if (attackWalk?.ready) {
        await svc.openaevConnector.deleteObservationsNotReportedSince({ connectorId, openaevTenantId, since: attackWalk.startedAt });
      }
      const mirrorPairs = attackWalk?.ready
        ? await svc.openaevConnector.listObservationPairs(connectorId)
        : await svc.openaevConnector.listObservationPairsReportedSince({ connectorId, openaevTenantId, since: result.attack.reconcileFrom });
      const evidenceScopePairs = attackWalk?.ready ? await svc.supportingAssets.findEvidenceScopePairsForConnector(connectorId) : [];
      if (mirrorPairs.length > 0 || evidenceScopePairs.length > 0) {
        const registry = await svc.supportingAssets.getInventoryAssetIdMap(connectorId);
        // Another tenant's mirror may be empty after a reset or a fallback run, or half read.
        const judgeable = onCompleteMirrors({
          registry,
          tenantOfAsset: await svc.openaevConnector.getAssetTenantMap(connectorId),
          runTenantIds: openaevTenants.map((tenant) => tenant.tenant_id),
          completeTenants: new Set([
            openaevTenantId,
            ...(await svc.openaevConnector.getStreamStates(connectorId))
              .filter((state) => state.stream === 'attack' && state.lastFullWalkCompletedAt !== null)
              .map((state) => state.openaevTenantId),
          ]),
        });
        findingCounts.removed += await retireAttackEvidence({
          svc,
          connectorId,
          assetIdMap: registry,
          mirrorPairs: mirrorPairs.filter((pair) => {
            const supportingAssetId = registry.get(pair.sourceAssetId);
            return supportingAssetId !== undefined && judgeable(supportingAssetId);
          }),
          extraScopePairs: evidenceScopePairs.filter((pair) => judgeable(pair.supportingAssetId)),
          now: () => new Date(),
        });
      }
      if (attackWalk !== null) {
        await svc.openaevConnector.completeFullWalk({ ...attackKey, completedAt: new Date(), ready: attackWalk.ready });
      }
      await svc.openaevConnector.markStreamReconciled(attackKey);

      // A walk spreads an asset's CVEs over pages and possibly runs, so enumerating at the start of a
      // run that read part of it would dismiss the CVEs not yet re-delivered, to bring them back later.
      // Only the sources scoped by this OpenAEV tenant's own assets are judged: another tenant's, folded
      // onto the same OpenCRQ asset, are reported by its own reads.
      const vulnerabilityKey = { connectorId, openaevTenantId, stream: 'vulnerability' as const };
      const vulnerabilityWalk = result.vulnerability.fullWalk;
      const retireTenantCves = async (reportedSince: Date, enumeratedAt: Date) => {
        const tenantScopes = await svc.openaevConnector.listSourceAssetIds({ connectorId, openaevTenantId });
        const pairs = await svc.supportingAssets.findCveScopePairsSince(connectorId, reportedSince, tenantScopes);
        findingCounts.removed += await retireCveEvidence({ svc, connectorId, pairs, enumeratedAt });
      };
      if (vulnerabilityWalk?.ready) {
        await retireTenantCves(new Date(0), vulnerabilityWalk.startedAt);
      } else if (!result.vulnerability.walked) {
        await retireTenantCves(result.vulnerability.reconcileFrom, result.vulnerability.reconcileFrom);
      }
      if (vulnerabilityWalk !== null) {
        await svc.openaevConnector.completeFullWalk({ ...vulnerabilityKey, completedAt: new Date(), ready: vulnerabilityWalk.ready });
      }
      if (vulnerabilityWalk !== null || !result.vulnerability.walked) {
        await svc.openaevConnector.markStreamReconciled(vulnerabilityKey);
      }

      if (ctx.signal.aborted) {
        return;
      }

      // 4. Descriptions come last: they are the least urgent of the run's work, and the budget is
      // the run's, not the tenant's.
      const descriptions = await syncTenantDescriptions(openaevTenantId, descriptionBudgetShare(descriptionBudgetLeft, openaevTenants.length - index));
      descriptionBudgetLeft -= descriptions.calls;
    }
    // An inventory the observations had to run is recorded here; a due one was at its own end.
    if (inventoryCounts.ran && !inventoryDue) {
      await recordInventoryCounts();
    }
    await recordFindingCounts();
    logTrace('OpenAEV sync complete', { observations: observationsBeforeTenant, findings: findingCounts, assets: inventoryCounts });
  } catch (err) {
    logFromError(err, 'OpenAEV sync failed', { tenantId: ctx.tenantId, attempt: ctx.attempt });
    throw err;
  }
};
