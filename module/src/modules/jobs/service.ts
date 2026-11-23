import { newError } from '@app/utils';
import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import type { EventOrigin } from '../../security';
import type {
  ClaimedJob,
  DeferOutcome,
  EnqueueJobOptions,
  EnqueueJobResult,
  FailureOutcome,
  JobErrorRecord,
  JobStatus,
  ListJobsFilters,
  ProgressUpdate,
  PurgeLimits,
  PurgeResult,
  QueueQuery,
  QueueSections,
  RecordSuccessResult,
  ReleaseOutcome,
  RetentionBounds,
  RunCounts,
  RunDetail,
  RunListItem,
  RunListOrder,
  RunListPage,
  RunQuery,
  RunSortKey,
  ScenarioComputation,
  ScheduledBooking,
  SerializedSlot,
  StepCounts,
  TriggeredBy,
} from './types';
import type { InferRepository } from '../../registry';
import type { JobHealth } from './health';
import type { DeferralPolicy } from './retry-policy';
import { isUniqueViolationOf } from '../../db/pg-errors';
import { defineService } from '../../registry';
import { isOtherAsker } from './askers';
import { deriveJobHealth, platformJobHealths } from './health';
import { payloadFoldOf } from './payload-folds';
import { jobsRepository } from './repository';
import { deferralDelayMs } from './retry-policy';
import { ACTIVE_JOB_STATUSES, JOB_STEPS, TERMINAL_JOB_STATUSES } from './schema';
import { LeaseLostError } from './types';

const DEFAULT_MAX_RUNTIME_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_PRIORITY = 50;
const ORPHAN_REQUEUE_DELAY_MS = 0;

/** `jobs` carries a per-row `notify_data_changed` trigger: a single unbounded `DELETE` would ring
 * it once per row. Each batch is its own statement, which spreads the notifications out. */
const PURGE_BATCH_SIZE = 500;
// Bounds one run's own duration: a backlog deeper than this waits for tomorrow's run.
const MAX_PURGE_BATCHES = 50;

// Fence worker-only methods (claim/lease/record*/abort poll/reap) against a
// client origin: they bypass tenant scoping and would otherwise let a tenant
// mutate any job's lifecycle columns.
const requireSystemOrigin = (eventOrigin: EventOrigin, method: string): void => {
  if (eventOrigin.type !== 'system') {
    throw newError(`jobs.${method} requires a system event origin`, { actualType: eventOrigin.type });
  }
};

const canonicalize = (val: unknown): unknown => {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalize);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- val is narrowed to non-null non-array object by the checks above
  const obj = val as Record<string, unknown>;
  return Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = canonicalize(obj[key]);
    return acc;
  }, {});
};

const computePayloadHash = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');

type AbsorbRepo = Pick<InferRepository<typeof jobsRepository>, 'raiseInteractive' | 'markAbsorbedAsk' | 'markAskedByOthers' | 'replaceActivePayload' | 'lockActiveByDedupeKey'>;
type FollowUpRepo = AbsorbRepo & Pick<InferRepository<typeof jobsRepository>, 'findJobById' | 'insertFollowUpJob' | 'lockActiveByIdempotencyKey'>;

type Asker = { triggeredBy?: TriggeredBy, triggeredById?: string | null };

type SuccessorKind =
  /** A fresh pass answering what the run absorbed: it starts clean, an ask wanting the data as it stands. */
  | { answers: true }
  /** The rest of the run's own pass, which inherits the asks because it will not start clean. */
  | { answers: false, state: Record<string, unknown> | undefined };

const markIfOtherAsker = async (
  repo: AbsorbRepo,
  existing: { id: string, triggeredBy: TriggeredBy, triggeredById: string | null, askedByOthers: boolean },
  asker: Asker,
): Promise<void> => {
  if (!existing.askedByOthers && isOtherAsker(existing, asker)) {
    await repo.markAskedByOthers(existing.id);
  }
};

/**
 * Folds an ask into the run already holding its key, which answers it by running only if it is
 * still queued to start clean. Both writes are fenced on the status this was told, so `existing`
 * must come from a locking read: without one a status is a guess that a claim can falsify before
 * either write lands, and the fold then writes nothing while the enqueue still reports the ask as
 * taken. An ask from anyone but the row's own asker marks it first, whatever the fold then does.
 */
const absorbInto = async (
  repo: AbsorbRepo,
  existing: {
    id: string,
    status: JobStatus,
    resumes: boolean,
    absorbedAsk: boolean,
    absorbedAskInteractive: boolean,
    triggeredBy: TriggeredBy,
    triggeredById: string | null,
    askedByOthers: boolean,
  },
  interactive: boolean,
  asker: Asker,
): Promise<void> => {
  await markIfOtherAsker(repo, existing, asker);
  if (existing.status === 'queued' && !existing.resumes) {
    if (interactive) {
      await repo.raiseInteractive(existing.id);
    }
    return;
  }
  // The debt already standing answers this ask too, and rewriting the same flags would ring the
  // jobs doorbell for nothing.
  if (existing.absorbedAsk && (existing.absorbedAskInteractive || !interactive)) {
    return;
  }
  await repo.markAbsorbedAsk(existing.id, interactive);
};

type FoldTarget = Parameters<typeof absorbInto>[1] & { tenantId: string, kind: string, payload: unknown };

/**
 * `absorbInto` for an ask carrying `askedPayload`, answering the row that took it. A kind with a
 * payload fold first widens the held payload to cover the ask; a widened payload another active row
 * already carries is that row's run, so the ask folds into it rather than giving the held row a hash
 * the dedupe index already holds. `existing` must come from a locking read, as for `absorbInto`.
 */
const foldAsk = async (repo: AbsorbRepo, existing: FoldTarget, askedPayload: unknown, interactive: boolean, asker: Asker): Promise<string> => {
  let target: Parameters<typeof absorbInto>[1] = existing;
  const fold = payloadFoldOf(existing.kind);
  if (fold) {
    const merged = fold(existing.payload, askedPayload);
    const mergedHash = computePayloadHash(merged);
    if (mergedHash !== computePayloadHash(existing.payload)) {
      const holder = await repo.lockActiveByDedupeKey(existing.kind, existing.tenantId, mergedHash);
      if (holder) {
        target = holder;
      } else {
        await repo.replaceActivePayload(existing.id, merged, mergedHash);
      }
    }
  }
  await absorbInto(repo, target, interactive, asker);
  return target.id;
};

/**
 * The row that carries a key on from the run just settled, which is the only moment it can be
 * written: the dedupe folds any enqueue into an active row, so while the run held the key its own
 * successor would have been folded into it.
 *
 * A continuation is the next page of the same run, so it keeps who asked, and whether others did. An
 * answering run has no asker to keep, the fold not having recorded one, so it is booked as the
 * platform's and points back at the run that owed it, which is also what makes a chain readable in
 * one query. A successor that finds the key already taken is dropped, the row holding it answering in
 * its place and marked when the successor's asker is not its own.
 * A cancel or an abort frees the key before the runtime books the answer, so an ask can take it in
 * between, and a kind whose payload says what to compute folds the successor's payload into that
 * row, or the row would answer a narrower ask than the one carried.
 */
const bookSuccessor = async (repo: FollowUpRepo, jobId: string, successor: SuccessorKind): Promise<string | undefined> => {
  const source = await repo.findJobById(jobId);
  if (!source || (successor.answers && !source.absorbedAsk)) {
    return undefined;
  }
  const successorId = uuidv7();
  const rows = await repo.insertFollowUpJob({
    id: successorId,
    tenantId: source.tenantId,
    kind: source.kind,
    payload: source.payload,
    payloadHash: source.payloadHash,
    idempotencyKey: source.idempotencyKey,
    priority: source.priority,
    maxRuntimeMs: source.maxRuntimeMs,
    maxAttempts: source.maxAttempts,
    bounded: source.bounded,
    triggeredBy: successor.answers ? 'system' : source.triggeredBy,
    triggeredById: successor.answers ? source.id : source.triggeredById,
    interactive: successor.answers ? source.absorbedAskInteractive : source.interactive,
    stateSnapshot: successor.answers ? null : (successor.state ?? null),
    absorbedAsk: !successor.answers && source.absorbedAsk,
    absorbedAskInteractive: !successor.answers && source.absorbedAskInteractive,
    askedByOthers: !successor.answers && source.askedByOthers,
  });
  if (rows.length > 0) {
    return successorId;
  }
  const holder = (source.idempotencyKey === null ? undefined : await repo.lockActiveByIdempotencyKey(source.tenantId, source.idempotencyKey))
    ?? await repo.lockActiveByDedupeKey(source.kind, source.tenantId, source.payloadHash);
  if (holder) {
    const asker: Asker = successor.answers
      ? { triggeredBy: 'system', triggeredById: source.id }
      : { triggeredBy: source.triggeredBy, triggeredById: source.triggeredById };
    if (payloadFoldOf(source.kind) === undefined) {
      await markIfOtherAsker(repo, holder, asker);
    } else {
      await foldAsk(repo, holder, source.payload, successor.answers ? source.absorbedAskInteractive : source.interactive, asker);
    }
  }
  return undefined;
};

const answerAbsorbed = (repo: FollowUpRepo, jobId: string): Promise<string | undefined> =>
  bookSuccessor(repo, jobId, { answers: true });

type CancelRepo = FollowUpRepo & Pick<InferRepository<typeof jobsRepository>, 'isAbortRequested' | 'markCancelledByWorker'>;

/**
 * Settles the cancel a worker's requeue found pending, which `notAskedToStop` refused to requeue.
 * False when nothing was pending, or when the worker no longer holds the run.
 */
const cancelIfAskedToStop = async (repo: CancelRepo, jobId: string, workerId: string, deferAnswer: boolean): Promise<boolean> => {
  if (!await repo.isAbortRequested(jobId)) {
    return false;
  }
  const [settled] = await repo.markCancelledByWorker(jobId, workerId);
  if (!settled) {
    return false;
  }
  if (!deferAnswer) {
    await answerAbsorbed(repo, jobId);
  }
  return true;
};

export interface FailureInfo {
  message: string,
  stack?: string,
}

export type ComputeRetryDelayMs = (attempt: number) => number;

type ErrorCountRepo = Pick<InferRepository<typeof jobsRepository>, 'countErrorsByJobIds' | 'findStepCountsByJobIds'>;

/** Joins each run to its own error count and step counts, the fields no run-list projection carries by itself. */
const withErrorCounts = async <T extends { id: string }>(
  repo: ErrorCountRepo,
  runs: ReadonlyArray<T>,
): Promise<Array<T & { errorCount: number, stepCounts: Array<StepCounts> }>> => {
  const ids = runs.map((run) => run.id);
  const [counts, steps] = await Promise.all([repo.countErrorsByJobIds(ids), repo.findStepCountsByJobIds(ids)]);
  const countByJobId = new Map(counts.map((row) => [row.jobId, row.count]));
  const stepsByJobId = new Map<string, Array<StepCounts>>();
  for (const { jobId, recordedAt: _recordedAt, ...step } of steps) {
    stepsByJobId.set(jobId, [...(stepsByJobId.get(jobId) ?? []), step]);
  }
  return runs.map((run) => ({
    ...run,
    errorCount: countByJobId.get(run.id) ?? 0,
    stepCounts: (stepsByJobId.get(run.id) ?? []).sort((a, b) => JOB_STEPS.indexOf(a.step) - JOB_STEPS.indexOf(b.step)),
  }));
};

/** A `RunQuery` scoped to one status, for a queue section that has no filter or sort of its own. */
const queueSectionQuery = (tenantId: string, status: JobStatus, sortBy: RunSortKey, sortDesc: boolean, page: { limit: number, offset: number }): RunQuery => ({
  tenantId,
  kinds: null,
  statuses: [status],
  triggeredBy: null,
  enqueuedFrom: null,
  enqueuedTo: null,
  startedFrom: null,
  startedTo: null,
  finishedFrom: null,
  finishedTo: null,
  search: null,
  sortBy,
  sortDesc,
  limit: page.limit,
  offset: page.offset,
});

export const jobsService = defineService(
  'jobs',
  jobsRepository,
).implement({
  enqueueJob: async ({ eventOrigin, atomic }, opts: EnqueueJobOptions): Promise<EnqueueJobResult> => {
    if (eventOrigin.type === 'client' && eventOrigin.tenantId !== opts.tenantId) {
      throw newError('Cannot enqueue job for another tenant');
    }

    const payloadHash = computePayloadHash(opts.payload);
    const jobId = uuidv7();

    // An ask absorbed by one already queued must not be served on that one's window: the
    // dispatcher folds a save into a sweep's pending ask in memory, and the same fold is owed here
    // once the ask has reached the table. Raising only, so a sweep never slows a save.
    const interactive = opts.interactive ?? false;
    const asker: Asker = { triggeredBy: opts.triggeredBy, triggeredById: opts.triggeredById };
    const fold = async (repo: AbsorbRepo, existing: FoldTarget): Promise<string> => {
      if (!opts.skipIfActive) {
        return await foldAsk(repo, existing, opts.payload, interactive, asker);
      }
      await markIfOtherAsker(repo, existing, asker);
      return existing.id;
    };

    try {
      return await atomic(async ({ repo: atomicRepo }) => {
        if (opts.idempotencyKey) {
          const existing = await atomicRepo.lockActiveByIdempotencyKey(opts.tenantId, opts.idempotencyKey);
          if (existing) {
            return { jobId: await fold(atomicRepo, existing), alreadyExisted: true };
          }
        }
        const dup = await atomicRepo.lockActiveByDedupeKey(opts.kind, opts.tenantId, payloadHash);
        if (dup) {
          return { jobId: await fold(atomicRepo, dup), alreadyExisted: true };
        }

        await atomicRepo.insertJob({
          id: jobId,
          tenantId: opts.tenantId,
          kind: opts.kind,
          payload: opts.payload,
          payloadHash,
          idempotencyKey: opts.idempotencyKey ?? null,
          priority: opts.priority ?? DEFAULT_PRIORITY,
          // Left to the column's now() default: the claim compares it with the database clock.
          runAfter: opts.runAfter,
          maxRuntimeMs: opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS,
          maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          bounded: opts.bounded ?? true,
          triggeredBy: opts.triggeredBy ?? 'system',
          triggeredById: opts.triggeredById ?? null,
          interactive,
          stateSnapshot: opts.stateSnapshot ?? null,
        });

        return { jobId, alreadyExisted: false };
      });
    } catch (err) {
      if (!isUniqueViolationOf(err)) {
        throw err;
      }
      // Losing the insert race is the same absorption as finding the row inside the transaction,
      // so the winner owes the same fold, and the fold owes it the same transaction to hold its
      // lock through.
      return await atomic(async ({ repo: atomicRepo }) => {
        if (opts.idempotencyKey) {
          const winner = await atomicRepo.lockActiveByIdempotencyKey(opts.tenantId, opts.idempotencyKey);
          if (winner) {
            return { jobId: await fold(atomicRepo, winner), alreadyExisted: true };
          }
        }
        const dup = await atomicRepo.lockActiveByDedupeKey(opts.kind, opts.tenantId, payloadHash);
        if (dup) {
          return { jobId: await fold(atomicRepo, dup), alreadyExisted: true };
        }
        throw err;
      });
    }
  },

  /**
   * `cancelJob` over whatever a kind's payload names, and the same two halves: the queued rows are
   * cancelled, the running ones are asked to stop. Answers how many were cancelled outright.
   */
  cancelByPayloadId: async ({ repo }, kind: string, payloadKey: string, ids: ReadonlyArray<string>): Promise<number> => {
    const cancelled = await repo.cancelQueuedByPayloadId(kind, payloadKey, ids);
    await repo.requestAbortIfRunningByPayloadId(kind, payloadKey, ids);
    return cancelled;
  },

  /**
   * With `refuseIfShared`, a run another asker folded into is left untouched and answers `'shared'`.
   * The mark is read under the row lock the fold takes, so a fold racing this either lands first and
   * is seen, or finds the row cancelled and books its own run. An unshared run absorbed only its
   * starter's own asks, which the cancel drops: answering them would restart the work under a
   * `system` run the starter may not cancel.
   */
  cancelJob: async ({ atomic }, jobId: string, opts?: { refuseIfShared?: boolean }): Promise<'cancelled' | 'shared'> =>
    await atomic(async ({ repo: atomicRepo }) => {
      if (opts?.refuseIfShared) {
        const locked = await atomicRepo.lockJobById(jobId);
        if (locked?.askedByOthers) {
          return 'shared' as const;
        }
        await atomicRepo.dropAbsorbedAsk(jobId);
      }
      // Cancelling a run does not cancel what it absorbed. A row stopped before it started never
      // held the key, so its ask can be answered here; a running one is only asked to stop, and the
      // runtime answers for it once its handler has.
      const [stopped] = await atomicRepo.cancelQueued(jobId);
      if (stopped) {
        await answerAbsorbed(atomicRepo, jobId);
      }
      await atomicRepo.requestAbortIfRunning(jobId);
      return 'cancelled' as const;
    }),

  retryFromDlq: async ({ atomic }, jobId: string): Promise<void> => {
    await atomic(async ({ repo: atomicRepo }) => {
      const job = await atomicRepo.findJobById(jobId);
      if (!job || job.status !== 'dlq') {
        throw newError('Job not in DLQ', { jobId, status: job?.status });
      }
      // Pre-check the two partial-unique indexes (idempotency, dedup) so we can
      // surface a typed conflict instead of a raw 23505 on the DLQ→queued flip.
      if (job.idempotencyKey) {
        const activeIdem = await atomicRepo.findActiveByIdempotencyKey(job.tenantId, job.idempotencyKey);
        if (activeIdem) {
          throw newError('Cannot retry: an active job with the same idempotency key already exists', {
            jobId,
            activeJobId: activeIdem.id,
            idempotencyKey: job.idempotencyKey,
          });
        }
      }
      const activeDup = await atomicRepo.findActiveByDedupeKey(job.kind, job.tenantId, job.payloadHash);
      if (activeDup) {
        throw newError('Cannot retry: an active job with the same payload already exists', {
          jobId,
          activeJobId: activeDup.id,
        });
      }
      try {
        await atomicRepo.markRetryFromDlq(jobId);
      } catch (err) {
        if (isUniqueViolationOf(err)) {
          throw newError('Cannot retry: an active job was created concurrently', { jobId });
        }
        throw err;
      }
    });
  },

  /** Newest first: what the daily scheduler reads to tell an occurrence already served from one
   * still owed, and to see the booking it left standing. */
  listRecentScheduledBookings: async (
    { repo },
    tenantId: string,
    kind: string,
    limit: number,
  ): Promise<Array<ScheduledBooking>> => repo.findRecentScheduledBookings(tenantId, kind, limit),

  getJob: async ({ repo }, jobId: string) => repo.findJobById(jobId),

  /**
   * The queued or running job holding an idempotency key. Same lookup `enqueueJob` dedupes on, so
   * a caller asking "is one already in flight" and the enqueue that would fold into it cannot
   * disagree about which run exists.
   */
  getActiveJobByIdempotencyKey: async ({ repo }, tenantId: string, idempotencyKey: string) =>
    repo.findActiveByIdempotencyKey(tenantId, idempotencyKey),

  /** The same lookup as `getActiveJobByIdempotencyKey`, so the two cannot disagree about a key. */
  getActiveIdempotencyKeys: async ({ repo }, tenantId: string, idempotencyKeys: ReadonlyArray<string>) =>
    new Set((await repo.findActiveIdempotencyKeys(tenantId, idempotencyKeys))
      .map((row) => row.idempotencyKey)
      .filter((key): key is string => key !== null)),

  /** The same active statuses as `getActiveJobByIdempotencyKey`, so the two cannot disagree about what is in flight. */
  hasActiveComputationForScenario: async ({ repo }, tenantId: string, computation: ScenarioComputation) =>
    repo.hasActiveComputationForScenario(tenantId, computation),

  /**
   * The keys among `idempotencyKeys` a run of the tenant held at any time, finished ones included,
   * for a caller that books each key once and must not book it again after the run is over. A run
   * the retention purge has deleted no longer counts.
   */
  getBookedIdempotencyKeys: async ({ repo }, tenantId: string, idempotencyKeys: ReadonlyArray<string>) =>
    new Set((await repo.findBookedIdempotencyKeys(tenantId, idempotencyKeys))
      .map((row) => row.idempotencyKey)
      .filter((key): key is string => key !== null)),

  listJobs: async ({ repo }, filters: ListJobsFilters) => repo.listJobs(filters),

  getRunSummariesByKind: async ({ repo }, tenantId: string, kinds: ReadonlyArray<string>) =>
    repo.findRunSummariesByKind(tenantId, kinds),

  /**
   * One health per job kind for the whole platform, the worst any tenant reads (`platformJobHealths`):
   * what the XTM One registration reports. System origin only, since it reads every tenant.
   */
  getPlatformJobHealths: async ({ eventOrigin, repo }): Promise<Array<{ kind: string, health: JobHealth }>> => {
    requireSystemOrigin(eventOrigin, 'getPlatformJobHealths');
    const rows = await repo.findPlatformRunStatuses(eventOrigin);
    return platformJobHealths(rows.map((row) => ({
      kind: row.kind,
      health: deriveJobHealth({
        activeRunStatus: ACTIVE_JOB_STATUSES.find((status) => status === row.activeStatus) ?? null,
        lastTerminalRunStatus: TERMINAL_JOB_STATUSES.find((status) => status === row.lastTerminalStatus) ?? null,
      }),
    })));
  },

  getActiveRunCounts: async ({ repo }, tenantId: string, kinds: ReadonlyArray<string>) =>
    repo.findActiveRunCounts(tenantId, kinds),

  /**
   * An ask any active run of the kind answers, like a `skipIfActive` enqueue but whatever the run's
   * payload. Marks the active runs another asker started, and answers whether there was one.
   */
  askActiveRuns: async ({ eventOrigin, atomic }, tenantId: string, kind: string, asker: Asker): Promise<boolean> => {
    requireSystemOrigin(eventOrigin, 'askActiveRuns');
    return atomic(async ({ repo: atomicRepo }) => {
      const active = await atomicRepo.lockActiveByKind(tenantId, kind);
      for (const run of active) {
        await markIfOtherAsker(atomicRepo, run, asker);
      }
      return active.length > 0;
    });
  },

  listRunsForKind: async (
    { repo },
    tenantId: string,
    kind: string,
    statuses: ReadonlyArray<JobStatus>,
    order: RunListOrder,
    limit: number,
  ): Promise<Array<RunListItem>> => {
    const runs = await repo.findRunsByKind(tenantId, kind, statuses, order, limit);
    return withErrorCounts(repo, runs);
  },

  countRunsForKind: async ({ repo }, tenantId: string, kind: string): Promise<RunCounts> =>
    repo.countRunsByKind(tenantId, kind),

  queryRuns: async ({ repo }, query: RunQuery): Promise<RunListPage> => {
    const [runs, total] = await Promise.all([
      repo.findRuns(query),
      repo.countRuns(query),
    ]);
    return { items: await withErrorCounts(repo, runs), total };
  },

  /**
   * The Queue view's four sections in one round trip. `running`, `failed` and `succeeded` are
   * plain `RunQuery` reads — claimed-ascending, finished-descending, finished-descending — so they
   * reuse `findRuns`/`countRuns` like the Runs view does. `pending` alone needs the queue's own
   * order and its per-row `claimability`, which only `findPendingQueue` computes.
   */
  listQueue: async ({ repo }, query: QueueQuery): Promise<QueueSections> => {
    const [pendingRuns, pendingTotal, runningPage, failedPage, succeededPage] = await Promise.all([
      repo.findPendingQueue(query.tenantId, query.serializedKinds, query.sharedSlots, query.pending.limit, query.pending.offset),
      repo.countRuns(queueSectionQuery(query.tenantId, 'queued', 'enqueuedAt', true, query.pending)),
      (async () => {
        const q = queueSectionQuery(query.tenantId, 'running', 'claimedAt', false, query.running);
        const [runs, total] = await Promise.all([repo.findRuns(q), repo.countRuns(q)]);
        return { items: await withErrorCounts(repo, runs), total };
      })(),
      (async () => {
        const q = queueSectionQuery(query.tenantId, 'dlq', 'finishedAt', true, query.failed);
        const [runs, total] = await Promise.all([repo.findRuns(q), repo.countRuns(q)]);
        return { items: await withErrorCounts(repo, runs), total };
      })(),
      (async () => {
        const q = queueSectionQuery(query.tenantId, 'succeeded', 'finishedAt', true, query.succeeded);
        const [runs, total] = await Promise.all([repo.findRuns(q), repo.countRuns(q)]);
        return { items: await withErrorCounts(repo, runs), total };
      })(),
    ]);
    return {
      pending: { items: await withErrorCounts(repo, pendingRuns), total: pendingTotal },
      running: runningPage,
      failed: failedPage,
      succeeded: succeededPage,
    };
  },

  /** Tenant-scoped by the view, like `getJob`: a run of another tenant reads as not found. */
  getRun: async ({ repo }, jobId: string): Promise<RunDetail | undefined> => {
    const run = await repo.findRunDetail(jobId);
    if (!run) {
      return undefined;
    }
    const [[withCount], answeredById] = await Promise.all([
      withErrorCounts(repo, [run]),
      repo.findAnsweringRunId(run.id),
    ]);
    return { ...withCount, answeredById: answeredById ?? null };
  },

  getJobErrors: async ({ repo }, jobId: string): Promise<Array<JobErrorRecord>> =>
    repo.findJobErrors(jobId),

  claimNext: async (
    { eventOrigin, atomic },
    workerId: string,
    kinds: ReadonlyArray<string>,
    leaseMs: number,
    serializedKinds: ReadonlyArray<string> = [],
    /** The serialized slots this worker still holds, which the queue cannot see. */
    heldSlots: ReadonlyArray<SerializedSlot> = [],
    /** Groups of kinds sharing one per-tenant slot. */
    sharedSlots: ReadonlyArray<ReadonlyArray<string>> = [],
  ): Promise<ClaimedJob | undefined> => {
    requireSystemOrigin(eventOrigin, 'claimNext');
    return atomic(async ({ repo: atomicRepo }) => {
      const candidate = await atomicRepo.findNextClaimable(eventOrigin, kinds, serializedKinds, heldSlots, sharedSlots);
      if (!candidate) {
        return undefined;
      }
      return atomicRepo.claimJob(candidate.id, workerId, leaseMs);
    });
  },

  // Throws LeaseLostError on 0 rows so the execution loop aborts the handler;
  // a Drizzle UPDATE matching nothing does not throw on its own.
  renewLease: async ({ eventOrigin, repo }, jobId: string, workerId: string, leaseMs: number): Promise<void> => {
    requireSystemOrigin(eventOrigin, 'renewLease');
    const rows = await repo.renewLease(jobId, workerId, leaseMs);
    if (rows.length === 0) {
      throw new LeaseLostError('Lease lost during renewal', { jobId, workerId });
    }
  },

  recordSuccess: async (
    { eventOrigin, atomic },
    jobId: string,
    workerId: string,
    /** The handler left work behind its own bound, which only the runtime that ran it knows. */
    continuation?: { state: Record<string, unknown> | undefined },
  ): Promise<RecordSuccessResult> => {
    requireSystemOrigin(eventOrigin, 'recordSuccess');
    return atomic(async ({ repo: atomicRepo }) => {
      const [settled] = await atomicRepo.markSuccess(jobId, workerId);
      if (!settled) {
        return { recorded: false };
      }
      // Only one of the two, or the fold would drop whichever came second and the pass would lose
      // the resume state carrying it forward. The execution is carried on, asks and all, and the
      // link that ends it answers them.
      const bookedJobId = continuation
        ? await bookSuccessor(atomicRepo, jobId, { answers: false, state: continuation.state })
        : await answerAbsorbed(atomicRepo, jobId);
      return { recorded: true, bookedJobId };
    });
  },

  /**
   * The run of the same key that answers what `jobId` absorbed, for the caller that had to hold it
   * back: a run interrupted mid-handler has its row made terminal before the handler stops, so the
   * key is not free at the transition and only the runtime knows when it becomes so. A no-op when
   * that run absorbed nothing, which is what lets the runtime call it without asking first.
   */
  answerAbsorbedAsk: async ({ eventOrigin, atomic }, jobId: string): Promise<string | undefined> => {
    requireSystemOrigin(eventOrigin, 'answerAbsorbedAsk');
    return atomic(async ({ repo: atomicRepo }) => answerAbsorbed(atomicRepo, jobId));
  },

  recordFailure: async (
    { eventOrigin, atomic },
    jobId: string,
    workerId: string,
    failure: FailureInfo,
    retryable: boolean,
    computeRetryDelayMs: ComputeRetryDelayMs,
    /** See `answerAbsorbedAsk`: set when a handler of the caller's may still be writing. */
    deferAnswer: boolean = false,
  ): Promise<FailureOutcome> => {
    requireSystemOrigin(eventOrigin, 'recordFailure');
    return atomic(async ({ repo: atomicRepo }) => {
      const job = await atomicRepo.findJobById(jobId);
      if (!job) {
        return { outcome: 'lost-race' as const };
      }

      if (job.status !== 'running' || job.claimedBy !== workerId) {
        // Lease lost. Skip the audit insert too: job.attempt now belongs to
        // the new owner and recording our error there would mis-attribute it.
        return { outcome: 'lost-race' as const };
      }

      await atomicRepo.insertJobError({
        id: uuidv7(),
        jobId,
        attempt: job.attempt,
        retryable,
        message: failure.message,
        stack: failure.stack ?? null,
      });

      if (!retryable || job.attempt >= job.maxAttempts) {
        const [settled] = await atomicRepo.markFailedDlq(jobId, workerId, failure.message);
        if (!settled) {
          return { outcome: 'lost-race' as const };
        }
        if (!deferAnswer) {
          await answerAbsorbed(atomicRepo, jobId);
        }
        return { outcome: 'dlq' as const };
      }

      const retryDelayMs = computeRetryDelayMs(job.attempt);
      const [row] = await atomicRepo.markFailedRetry(jobId, workerId, retryDelayMs, failure.message);
      if (!row) {
        return { outcome: await cancelIfAskedToStop(atomicRepo, jobId, workerId, deferAnswer) ? 'cancelled' as const : 'lost-race' as const };
      }
      return { outcome: 'retry' as const, runAfter: row.runAfter };
    });
  },

  /**
   * Puts a running run back in the queue, leaving no error and no spent attempt. `expired` leaves it
   * `running`, for the caller to finish; a run asked to stop is cancelled instead.
   */
  deferRun: async (
    { eventOrigin, atomic },
    jobId: string,
    workerId: string,
    policy: DeferralPolicy,
  ): Promise<DeferOutcome> => {
    requireSystemOrigin(eventOrigin, 'deferRun');
    return atomic(async ({ repo: atomicRepo }) => {
      const job = await atomicRepo.findJobById(jobId);
      if (!job || job.status !== 'running' || job.claimedBy !== workerId) {
        return { outcome: 'lost-race' as const };
      }
      // Read and written in one transaction, so `run_after` is exactly `delayMs` past its `now()`.
      const delayMs = deferralDelayMs(await atomicRepo.findRunAgeMs(jobId) ?? 0, policy);
      const [row] = await atomicRepo.markDeferred(jobId, workerId, delayMs, policy.maxWaitMs);
      if (!row) {
        if (!await atomicRepo.isAbortRequested(jobId)) {
          return { outcome: 'expired' as const };
        }
        // The handler has returned, so the answer is booked here rather than deferred to the runtime.
        const [settled] = await atomicRepo.markCancelledByWorker(jobId, workerId);
        if (!settled) {
          return { outcome: 'lost-race' as const };
        }
        return { outcome: 'cancelled' as const, answeringJobId: await answerAbsorbed(atomicRepo, jobId) };
      }
      return { outcome: 'deferred' as const, runAfter: row.runAfter, delayMs };
    });
  },

  recordCancelled: async (
    { eventOrigin, atomic },
    jobId: string,
    workerId: string,
    /** See `answerAbsorbedAsk`: set when a handler of the caller's may still be writing. */
    deferAnswer: boolean = false,
  ): Promise<{ recorded: boolean }> => {
    requireSystemOrigin(eventOrigin, 'recordCancelled');
    return atomic(async ({ repo: atomicRepo }) => {
      const [settled] = await atomicRepo.markCancelledByWorker(jobId, workerId);
      if (!settled) {
        return { recorded: false };
      }
      if (!deferAnswer) {
        await answerAbsorbed(atomicRepo, jobId);
      }
      return { recorded: true };
    });
  },

  /**
   * Engine-shutdown release: requeue without recording a failure and without consuming an attempt.
   * The handler is being aborted and may still write, so a cancelled run's answer is the caller's
   * to book, as with `recordCancelled(deferAnswer)`.
   */
  releaseClaim: async ({ eventOrigin, atomic }, jobId: string, workerId: string): Promise<ReleaseOutcome> => {
    requireSystemOrigin(eventOrigin, 'releaseClaim');
    return atomic(async ({ repo: atomicRepo }) => {
      const rows = await atomicRepo.releaseClaim(jobId, workerId);
      if (rows.length > 0) {
        return { outcome: 'released' as const };
      }
      return { outcome: await cancelIfAskedToStop(atomicRepo, jobId, workerId, true) ? 'cancelled' as const : 'lost-race' as const };
    });
  },

  updateProgress: async ({ eventOrigin, repo }, jobId: string, workerId: string, progress: ProgressUpdate): Promise<void> => {
    requireSystemOrigin(eventOrigin, 'updateProgress');
    const { stepCounts, ...fields } = progress;
    const onlyCounts = stepCounts !== undefined && Object.values(fields).every((value) => value === undefined);
    if (!onlyCounts) {
      const rows = await repo.updateProgress(jobId, workerId, fields);
      if (rows.length === 0) {
        throw new LeaseLostError('Lease lost during updateProgress', { jobId, workerId });
      }
    }
    if (stepCounts !== undefined) {
      const rows = await repo.upsertStepCounts(jobId, workerId, stepCounts);
      if (rows.length === 0) {
        throw new LeaseLostError('Lease lost during updateProgress', { jobId, workerId });
      }
    }
  },

  saveStateSnapshot: async ({ eventOrigin, repo }, jobId: string, workerId: string, state: Record<string, unknown>): Promise<void> => {
    requireSystemOrigin(eventOrigin, 'saveStateSnapshot');
    const rows = await repo.saveStateSnapshot(jobId, workerId, state);
    if (rows.length === 0) {
      throw new LeaseLostError('Lease lost during saveStateSnapshot', { jobId, workerId });
    }
  },

  isAbortRequested: async ({ eventOrigin, repo }, jobId: string): Promise<boolean> => {
    requireSystemOrigin(eventOrigin, 'isAbortRequested');
    return repo.isAbortRequested(jobId);
  },

  reapOrphans: async ({ eventOrigin, atomic }): Promise<{ requeued: number, dlqed: number, cancelled: number }> => {
    requireSystemOrigin(eventOrigin, 'reapOrphans');
    return atomic(async ({ repo: atomicRepo }) => {
      const orphans = await atomicRepo.findOrphanedJobs(eventOrigin);
      // No worker is left to read a pending cancel, so it is settled here rather than requeued. It
      // wins on a last attempt too, unlike a worker's failure: the only error here is the lapsed
      // lease, which says nothing about the run, where a worker's own error is what its DLQ entry keeps.
      const cancelIds = orphans.filter((o) => o.abortRequested).map((o) => o.id);
      const live = orphans.filter((o) => !o.abortRequested);
      const retryIds = live.filter((o) => o.attempt < o.maxAttempts).map((o) => o.id);
      const dlqIds = live.filter((o) => o.attempt >= o.maxAttempts).map((o) => o.id);
      await atomicRepo.reapToRetryBatch(retryIds, ORPHAN_REQUEUE_DELAY_MS, 'Lease expired (worker crash or hang)');
      // No wait owed here: the expired lease is how the platform says the holder is gone, so the
      // key these rows held is already free.
      const dlqed = await atomicRepo.reapToDlqBatch(dlqIds, 'Lease expired after max attempts');
      const cancelled = await atomicRepo.reapToCancelledBatch(cancelIds);
      for (const settled of [...dlqed, ...cancelled]) {
        await answerAbsorbed(atomicRepo, settled.id);
      }
      return { requeued: retryIds.length, dlqed: dlqed.length, cancelled: cancelled.length };
    });
  },

  /**
   * Purges finished runs past their retention bound, `job_errors` and `job_logs` going with them
   * by cascade.
   */
  purgeExpiredRuns: async (
    { repo },
    tenantId: string,
    bounds: RetentionBounds,
    { batchSize, maxBatches }: PurgeLimits = { batchSize: PURGE_BATCH_SIZE, maxBatches: MAX_PURGE_BATCHES },
  ): Promise<PurgeResult> => {
    let runsDeleted = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const count = await repo.deleteFinishedJobsBefore(
        tenantId,
        TERMINAL_JOB_STATUSES,
        bounds.runOlderThan,
        batchSize,
      );
      runsDeleted += count;
      if (count < batchSize) {
        break;
      }
    }
    return { runsDeleted };
  },
});
