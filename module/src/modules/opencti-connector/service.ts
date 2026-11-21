import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { ParsedThreatInput } from '../threat-analyses';
import type { PendingMark } from './pending-batch';
import { defineService } from '../../registry';
import { serviceAccountsService } from '../service-accounts/service';
import { threatAnalysesService } from '../threat-analyses';
import { isThreatEntityType } from '../threat-analyses/entity-types';
import { buildThreatEntriesFromObjects, threatRefsOf } from '../threat-analyses/stix-bundle-parser';
import { distinct, planPendingBatch } from './pending-batch';
import { openctiConnectorRepository } from './repository';
import { sanitizeStixNullBytes } from './stix-sanitize';

/** Ids one marking statement binds: far under Postgres's 65,535 parameters. */
const MARK_SLICE_SIZE = 5_000;

/** What one actor's rebuild raised, for the caller to log: the batch itself carries on without it. */
export interface MirrorRebuildFailure {
  stixId: string,
  error: unknown,
}

/** What the mirror rebuild reports about one batch, so its caller can tell progress from a stall. */
export interface MirrorRebuildBatchResult {
  /** False when another runner holds the tenant: the scan ran, nothing else did. */
  locked: boolean,
  scanned: number,
  rebuilt: number,
  retracted: number,
  settled: number,
  /** Whether the scan saw more marked rows than this batch took, so the caller can book a follow-up. */
  remaining: boolean,
  /**
   * The last row the scan read, to be handed back as `after` so the next scan of the same run
   * starts past it. Null when the scan read nothing.
   */
  bound: PendingMark | null,
  failures: Array<MirrorRebuildFailure>,
}

/**
 * How mirrored STIX bodies become ingestible entries. Overridable only so a test can make one
 * actor's rebuild throw: the parser reads every field leniently, so no mirrored body provokes it.
 */
export type BuildEntriesFromMirror = (
  threatObjects: Array<Record<string, unknown>>,
  relatedObjects: Array<Record<string, unknown>>,
) => Array<ParsedThreatInput>;

export const openctiConnectorService = defineService(
  'openctiConnector',
  openctiConnectorRepository,
).dependsOn(() => [threatAnalysesService, serviceAccountsService]).implement({
  getSettings: async ({ repo }, tenantId: string) => repo.findByTenant(tenantId),

  // Cross-tenant — used by the worker's connector manager at boot/reconcile to know which
  // tenants currently have a Live Stream enabled. Callers must use a `system` origin.
  findAllEnabled: async ({ repo, eventOrigin }) => {
    if (eventOrigin.type !== 'system') {
      throw newError('System origin required');
    }
    return repo.findAllEnabled();
  },

  // Always resets `cursor`/`lastEventAt` and enables the connector — see `repository.ts#upsertConfig`.
  configure: async ({ repo }, tenantId: string, serviceAccountId: string, streamId: string) => {
    await repo.upsertConfig(tenantId, uuidv7(), serviceAccountId, streamId);
  },

  /** `configure` with the service account created in the same transaction. Returns its id. */
  configureWithNewServiceAccount: async ({ atomic }, tenantId: string, serviceAccountName: string, streamId: string): Promise<string> =>
    atomic(async ({ repo, deps }) => {
      const serviceAccountId = await deps.serviceAccounts.createConnectorServiceAccount(serviceAccountName);
      await repo.upsertConfig(tenantId, uuidv7(), serviceAccountId, streamId);
      return serviceAccountId;
    }),

  setEnabled: async ({ repo }, tenantId: string, enabled: boolean) => {
    await repo.setEnabled(tenantId, uuidv7(), enabled);
  },

  reconnectAtLiveTail: async ({ repo }, tenantId: string) => {
    await repo.reconnectAtLiveTail(tenantId);
  },

  resetStreamState: async ({ repo }, tenantId: string) => {
    await repo.resetStreamState(tenantId);
  },

  markAuthFailed: async ({ repo }, tenantId: string) => {
    await repo.markAuthFailed(tenantId, uuidv7());
  },

  /** The live-tail latch and the read total as persisted, or `null` when the generation guard refused the write. */
  updateCursor: async (
    { repo }, tenantId: string, cursor: string, lastEventAt: Date, reachedLiveTailCandidate: Date | null, objectsRead: number, generation: number,
  ): Promise<{ reachedLiveTailAt: Date | null, objectsRead: number } | null> => {
    const [persisted] = await repo.updateCursor(tenantId, cursor, lastEventAt, reachedLiveTailCandidate, objectsRead, generation);
    return persisted ? { reachedLiveTailAt: persisted.reachedLiveTailAt, objectsRead: persisted.objectsRead } : null;
  },

  // Last guard before the write, for callers that have not sanitised; what it had to do goes back
  // to them, `module` having no logger of its own.
  //
  // A report also keeps the threats it cites in step with its row, in the one transaction. A threat it
  // stopped citing is marked here, since the rebuild reaches threats through the citations the report
  // holds once it is rebuilt; the threats it newly cites are reached that way.
  upsertStreamObject: async (
    { atomic, repo }, tenantId: string, stixId: string, stixType: string, data: Record<string, unknown>,
  ): Promise<{ changedStrings: number, droppedKeys: number }> => {
    const { data: sanitized, changedStrings, droppedKeys } = sanitizeStixNullBytes(data);
    if (stixType !== 'report') {
      await repo.upsertStreamObject(uuidv7(), tenantId, stixId, stixType, sanitized);
      return { changedStrings, droppedKeys };
    }
    await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.upsertStreamObject(uuidv7(), tenantId, stixId, stixType, sanitized);
      const { dropped } = await atomicRepo.replaceReportRefs(tenantId, stixId, threatRefsOf(sanitized));
      await atomicRepo.markThreatsPending(tenantId, dropped);
    });
    return { changedStrings, droppedKeys };
  },

  // The threats a deleted report cited are marked in the transaction that forgets the citations: the
  // rebuild could no longer find them through a report that holds none.
  deleteStreamObject: async ({ atomic }, tenantId: string, stixId: string) => {
    await atomic(async ({ repo }) => {
      await repo.markThreatsPending(tenantId, await repo.deleteReportRefs(tenantId, stixId));
      await repo.deleteStreamObject(tenantId, stixId);
    });
  },

  // The survivor is marked in the same transaction: it now carries the absorbed threat's citations,
  // which no row of its own announces.
  repointStreamObjectRefs: async ({ atomic }, tenantId: string, fromStixId: string, toStixId: string) => {
    await atomic(async ({ repo }) => {
      await repo.repointStreamObjectRefs(tenantId, fromStixId, toStixId);
      await repo.markThreatsPending(tenantId, [toStixId]);
    });
  },

  /** Which of these threats the mirror holds alive, and whether each is already marked, in slices that keep one statement under the parameter limit. */
  getLiveThreatMarks: async ({ repo }, tenantId: string, stixIds: Array<string>) => {
    const marks: Array<{ stixId: string, pending: boolean }> = [];
    for (let from = 0; from < stixIds.length; from += MARK_SLICE_SIZE) {
      marks.push(...await repo.findLiveThreatMarks(tenantId, stixIds.slice(from, from + MARK_SLICE_SIZE)));
    }
    return marks;
  },

  /** Marks live threats for a rebuild, in slices that keep one statement under the parameter limit. */
  markThreatsPending: async ({ atomic }, tenantId: string, stixIds: Array<string>): Promise<number> => {
    let marked = 0;
    await atomic(async ({ repo }) => {
      for (let from = 0; from < stixIds.length; from += MARK_SLICE_SIZE) {
        marked += await repo.markThreatsPending(tenantId, stixIds.slice(from, from + MARK_SLICE_SIZE));
      }
    });
    return marked;
  },

  /**
   * Marks the live threats attributed to each of these threats for a rebuild, for a writer other
   * than the rebuild itself: threat analyses are one row per STIX id whether the mirror or an upload
   * wrote it, so a child the mirror holds reads percentages that were moved from outside.
   */
  markAttributedChildren: async ({ atomic }, tenantId: string, parentStixIds: Array<string>): Promise<number> => {
    let marked = 0;
    await atomic(async ({ repo }) => {
      for (const parentStixId of parentStixIds) {
        marked += await repo.markAttributedChildren(tenantId, parentStixId);
      }
    });
    return marked;
  },

  countStreamObjects: async ({ repo }, tenantId: string) => repo.countStreamObjects(tenantId),
  isBoundServiceAccountActive: async ({ repo }, tenantId: string) => repo.isBoundServiceAccountActive(tenantId),

  /**
   * Folds one batch of marked mirror rows into the tenant's threats: the actors the batch names
   * directly are rebuilt from the mirror, the ones it says are gone are deleted, a catalog row marks
   * the threats it reaches for a later batch, and only then are the marks cleared, each against the
   * `updatedAt` it was read with.
   *
   * A threat whose percentages moved marks the threats attributed to it the same way, since they read
   * those percentages: a child rebuilt before its parent in this batch is rebuilt again in a later one.
   *
   * Each actor is rebuilt, and each tombstone retracted, in a scope of its own, so one the mirror
   * describes badly costs only its own rows their clear: they stay marked and come back, where a
   * batch-wide failure would leave the tenant stuck on the same poisoned rows forever.
   *
   * The scan runs before the lock is tried, and not only because it is needed either way: a run that
   * gives the tenant up having read nothing at all would have an empty observation, which is
   * persisted as a subscription to every table.
   *
   * `after` bounds the scan below, so a caller draining the backlog batch by batch walks past the
   * rows a failing actor left marked instead of taking the same ones again. It is never persisted:
   * once the run ends, every row still marked comes back from the top.
   *
   * The reads run at READ COMMITTED, so a tombstone committed between two of them can hand the
   * build a relation whose target has just gone. That heals itself rather than needing a stricter
   * isolation level: the tombstone is itself a marked row, so the next batch rebuilds the same actor
   * against a mirror that now agrees with itself.
   */
  rebuildPendingBatch: async (
    { atomic }, tenantId: string, limit: number, after?: PendingMark,
    buildEntries: BuildEntriesFromMirror = buildThreatEntriesFromObjects,
  ): Promise<MirrorRebuildBatchResult> => atomic(async ({ repo: tx, deps: txDeps }) => {
    // One row past the batch answers whether anything is left without a second scan.
    const scan = await tx.findPendingStreamObjects(tenantId, limit + 1, after);
    const pendingRows = scan.slice(0, limit);
    const remaining = scan.length > limit;
    const lastRow = pendingRows[pendingRows.length - 1];
    const bound = lastRow ? { stixId: lastRow.stixId, watermark: lastRow.watermark } : null;
    if (!await tx.tryLockMirrorRebuild(tenantId)) {
      return { locked: false, scanned: 0, rebuilt: 0, retracted: 0, settled: 0, remaining, bound: null, failures: [] };
    }
    const plan = planPendingBatch(pendingRows);

    // A catalog row is settled by handing its threats marks of their own, which later batches take in
    // turn: rebuilding them here would put the whole fan-out of a producer in one transaction.
    const handedOn = await tx.markThreatsReaching(tenantId, plan.targetedStixIds, plan.producerStixIds);
    // Which actor each marked row put in play, so a row is only cleared once its actor has been rebuilt.
    const actorByRow = new Map<string, string>();
    for (const row of pendingRows) {
      if (isThreatEntityType(row.stixType)) {
        actorByRow.set(row.stixId, row.stixId);
      } else if (row.stixType === 'relationship' && row.sourceRef !== null && row.sourceRef !== '') {
        actorByRow.set(row.stixId, row.sourceRef);
      }
    }

    const groups = (await tx.findStreamObjectsByIds(tenantId, plan.directGroupStixIds)).filter((row) => isThreatEntityType(row.stixType));
    const relations = await tx.findRelationshipsBySourceRefs(tenantId, groups.map((row) => row.stixId), ['targets', 'uses', 'attributed-to']);
    // An attribution is read from its `target_ref` alone, so the threat it names is not fetched.
    const claimTargetIds = relations.filter((row) => row.relationshipType !== 'attributed-to').map((row) => row.targetRef);
    // Producers are named through `created_by_ref`, which is not a relationship row and so is never
    // reached by the lookups above: without this fetch every claim resolves an empty producer.
    const producerIds = [...groups, ...relations].map((row) => row.createdByRef);
    const relatedObjects = (await tx.findStreamObjectsByIds(tenantId, distinct([...claimTargetIds, ...producerIds])))
      .map((row) => row.data);
    const reports = (await tx.findReportsCitingThreats(tenantId, groups.map((row) => row.stixId))).map((row) => row.data);
    const sharedGraph = [...relations.map((row) => row.data), ...relatedObjects, ...reports];

    const groupsByStixId = new Map(groups.map((group) => [group.stixId, group]));
    // Every actor of the batch in one pass, in the order the analyses module agrees on: each
    // ingestion is a savepoint whose row locks are held to this transaction's commit, so a batch
    // taking two actors the other way round from a concurrent recompute deadlocks with it. Splitting
    // the ingestions from the retractions would take one group's rows after the other's whatever
    // their keys.
    const actorStixIds = await txDeps.threatAnalyses.orderStixIdsByAnalysis(
      tenantId,
      'connector',
      [...groupsByStixId.keys(), ...plan.tombstonedGroupStixIds],
    );

    const failures: Array<MirrorRebuildFailure> = [];
    const unrebuilt = new Set<string>();
    let rebuilt = 0;
    let retracted = 0;
    let cascaded = 0;
    for (const stixId of actorStixIds) {
      const group = groupsByStixId.get(stixId);
      try {
        if (group === undefined) {
          const retraction = await txDeps.threatAnalyses.retractActors(tenantId, 'connector', [stixId]);
          retracted += retraction.retracted;
        } else {
          const moved: Array<string> = [];
          await txDeps.threatAnalyses.ingestBundle(buildEntries([group.data], sharedGraph), tenantId, 'connector', {
            onProbabilitiesChanged: (movedStixId) => moved.push(movedStixId),
          });
          rebuilt += 1;
          // The threats attributed to this one read its percentages, so they are rebuilt against the new ones.
          for (const movedStixId of moved) {
            cascaded += await tx.markAttributedChildren(tenantId, movedStixId);
          }
        }
      } catch (error) {
        failures.push({ stixId, error });
        unrebuilt.add(stixId);
      }
    }

    const settleable = plan.marks.filter((mark) => {
      const actorStixId = actorByRow.get(mark.stixId);
      return actorStixId === undefined || !unrebuilt.has(actorStixId);
    });
    const settled = await tx.settlePendingStreamObjects(tenantId, settleable);
    // The scan predates the marks, and a run's own writes never wake it: without them in `remaining`,
    // a run ending on this batch would book no continuation and leave them to the next outside change.
    return { locked: true, scanned: pendingRows.length, rebuilt, retracted, settled, remaining: remaining || handedOn > 0 || cascaded > 0, bound, failures };
  }),
});
