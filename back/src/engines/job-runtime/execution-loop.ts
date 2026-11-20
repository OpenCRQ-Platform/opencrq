import type { ClaimedJob, DeferOutcome, DeferralPolicy, DrizzleDB, EnqueueJobOptions, EnqueueJobResult, FailureOutcome, JobRunResult, ProgressUpdate, RecordSuccessResult, ReleaseOutcome, StatementRecorder } from '@app/module';
import { computeRetryDelayMs, InputsNotReadyError, isErrorRetryable, JOB_LEASE_MS, LeaseLostError, TimeoutError } from '@app/module';
import type { HandlerRegistry } from './handler-registry';
import { runInExecutionScope } from '../../utils/execution-scope';
import { endLogScope } from '../../utils/log-capture';
import { createJobContext } from './job-context-factory';

export const LEASE_MS = JOB_LEASE_MS;
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 10_000;
const DEFAULT_ABORT_POLL_INTERVAL_MS = 2_000;

const ABORT_CANCEL = 'cancellation-requested';
const ABORT_TIMEOUT = 'timeout';
const ABORT_ENGINE = 'engine-shutdown';
const ABORT_LEASE_LOST = 'lease-lost';

export interface ExecutionJobsService {
  enqueueJob: (opts: EnqueueJobOptions) => Promise<EnqueueJobResult>,
  renewLease: (jobId: string, workerId: string, leaseMs: number) => Promise<void>,
  recordSuccess: (
    jobId: string,
    workerId: string,
    continuation?: { state: Record<string, unknown> | undefined },
  ) => Promise<RecordSuccessResult>,
  recordFailure: (
    jobId: string,
    workerId: string,
    failure: { message: string, stack?: string },
    retryable: boolean,
    computeRetryDelayMs: (attempt: number) => number,
    deferAnswer?: boolean,
  ) => Promise<FailureOutcome>,
  recordCancelled: (jobId: string, workerId: string, deferAnswer?: boolean) => Promise<{ recorded: boolean }>,
  releaseClaim: (jobId: string, workerId: string) => Promise<ReleaseOutcome>,
  deferRun: (jobId: string, workerId: string, policy: DeferralPolicy) => Promise<DeferOutcome>,
  isAbortRequested: (jobId: string) => Promise<boolean>,
  updateProgress: (jobId: string, workerId: string, progress: ProgressUpdate) => Promise<void>,
  saveStateSnapshot: (jobId: string, workerId: string, state: Record<string, unknown>) => Promise<void>,
}

export interface ExecuteJobOptions {
  job: ClaimedJob,
  workerId: string,
  jobsService: ExecutionJobsService,
  handlerRegistry: HandlerRegistry,
  engineSignal: AbortSignal,
  deferralPolicy: DeferralPolicy,
  runDb?: DrizzleDB,
  observation?: StatementRecorder,
  leaseRenewIntervalMs?: number,
  abortPollIntervalMs?: number,
  onLostRace?: (jobId: string, reason: string) => void,
  onRenewError?: (err: unknown, jobId: string) => void,
  onStarted?: (job: ClaimedJob) => void,
  onJobSuccess?: (jobId: string, kind: string) => void,
  onJobFailure?: (jobId: string, kind: string, err: unknown, outcome: 'retry' | 'dlq', nextAttemptAt: Date | null) => void,
  /**
   * Fired once, when the handler promise settles or when it never ran at all. An abort ends the
   * race but not the handler, which keeps its database access until it settles.
   */
  onHandlerSettled?: () => void,
  onTerminal?: (job: ClaimedJob) => Promise<void>,
  /**
   * The run went terminal while its handler may still have been writing, so the queue held back the
   * run answering what it absorbed. The caller owes `jobs.answerAbsorbedAsk` once the handler has
   * stopped, which is the moment it already waits for before releasing the run's slot.
   */
  onAnswerOwed?: (jobId: string) => void,
  /** `continuationJobId` is absent when the key was already taken, the row holding it serving instead. */
  onContinuation?: (jobId: string, kind: string, continuationJobId?: string) => void,
  /** The run booked to answer what this one absorbed and could not answer itself. */
  onAnswered?: (jobId: string, kind: string, answeringJobId: string) => void,
  /** The handler's inputs were not ready: the run is queued again `delayMs` from now, no error recorded. */
  onDeferred?: (jobId: string, kind: string, err: InputsNotReadyError, deferral: { runAfter: Date, delayMs: number }) => void,
}

type RaceOutcome =
  | { kind: 'handler-success', result: JobRunResult | void }
  | { kind: 'handler-error', error: unknown }
  | { kind: 'aborted', reason: string };

interface HandlerSettlement {
  markStarted: () => void,
  notify: () => void,
  notifyIfNeverStarted: () => void,
}

const createHandlerSettlement = (onHandlerSettled?: () => void): HandlerSettlement => {
  let started = false;
  let notified = false;
  const notify = (): void => {
    if (!notified) {
      notified = true;
      onHandlerSettled?.();
    }
  };
  return {
    markStarted: () => {
      started = true;
    },
    notify,
    notifyIfNeverStarted: () => {
      if (!started) {
        notify();
      }
    },
  };
};

/**
 * The scope spans the whole execution rather than the handler alone: the lines naming a retry and a
 * move to the dead-letter queue are written after the handler has returned.
 */
export const executeJob = async (opts: ExecuteJobOptions): Promise<void> => {
  const { job } = opts;
  const settlement = createHandlerSettlement(opts.onHandlerSettled);
  return runInExecutionScope(
    { scopeId: job.id, scopeKind: job.kind, tenantId: job.tenantId, jobId: job.id, retention: 'on-scope-end' },
    async () => {
      try {
        await runJob(opts, settlement);
      } finally {
        settlement.notifyIfNeverStarted();
        await endLogScope(job.id);
      }
    },
  );
};

const runJob = async (opts: ExecuteJobOptions, settlement: HandlerSettlement): Promise<void> => {
  const { job, workerId, jobsService, engineSignal } = opts;
  const renewIntervalMs = opts.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS;
  const abortPollIntervalMs = opts.abortPollIntervalMs ?? DEFAULT_ABORT_POLL_INTERVAL_MS;

  opts.onStarted?.(job);

  const handler = opts.handlerRegistry.get(job.kind);
  if (!handler) {
    const err = new Error(`No handler registered for job kind '${job.kind}'`);
    const { outcome } = await jobsService.recordFailure(
      job.id,
      workerId,
      { message: err.message },
      false,
      computeRetryDelayMs,
    );
    if (outcome === 'dlq') {
      opts.onJobFailure?.(job.id, job.kind, err, outcome, null);
      await opts.onTerminal?.(job);
    }
    return;
  }

  const abortController = new AbortController();
  // Mirror an already-aborted engine signal synchronously: addEventListener
  // does not fire retroactively for events that already happened.
  if (engineSignal.aborted) {
    abortController.abort(ABORT_ENGINE);
  }
  const onEngineAbort = () => abortController.abort(ABORT_ENGINE);
  engineSignal.addEventListener('abort', onEngineAbort, { once: true });

  const timeoutHandle = setTimeout(() => abortController.abort(ABORT_TIMEOUT), job.maxRuntimeMs);

  const renewerHandle = setInterval(() => {
    void jobsService.renewLease(job.id, workerId, LEASE_MS).catch((err: unknown) => {
      if (err instanceof LeaseLostError) {
        abortController.abort(ABORT_LEASE_LOST);
        return;
      }
      // Transient DB error — lease in DB is still valid, next tick retries.
      // Only a real lease loss should abort and burn an attempt.
      opts.onRenewError?.(err, job.id);
    });
  }, renewIntervalMs);

  const abortPollerHandle = setInterval(() => {
    void jobsService.isAbortRequested(job.id)
      .then((requested) => {
        if (requested) {
          abortController.abort(ABORT_CANCEL);
        }
      })
      .catch(() => { /* non-fatal; next tick retries */ });
  }, abortPollIntervalMs);

  let terminal = false;
  try {
    const ctx = createJobContext({
      jobId: job.id,
      tenantId: job.tenantId,
      kind: job.kind,
      interactive: job.interactive,
      payload: job.payload,
      attempt: job.attempt,
      state: job.stateSnapshot,
      signal: abortController.signal,
      deps: {
        updateProgress: (jobId, progress) => jobsService.updateProgress(jobId, workerId, progress),
        saveStateSnapshot: (jobId, state) => jobsService.saveStateSnapshot(jobId, workerId, state),
      },
      runDb: opts.runDb,
      observation: opts.observation,
    });

    // Tagged-outcome race so a same-tick handler-success vs cancel-abort is
    // disambiguated. A post-race `signal.aborted` check would misclassify.
    const handlerOutcome: Promise<RaceOutcome> = handler(ctx).then(
      (result) => ({ kind: 'handler-success' as const, result }),
      (error: unknown) => ({ kind: 'handler-error' as const, error }),
    );
    settlement.markStarted();
    void handlerOutcome.then(settlement.notify);
    const abortOutcome: Promise<RaceOutcome> = new Promise((resolve) => {
      if (abortController.signal.aborted) {
        resolve({ kind: 'aborted', reason: String(abortController.signal.reason) });
        return;
      }
      abortController.signal.addEventListener('abort', () => {
        resolve({ kind: 'aborted', reason: String(abortController.signal.reason) });
      }, { once: true });
    });

    const outcome = await Promise.race([handlerOutcome, abortOutcome]);
    terminal = await recordOutcome(opts, outcome);
  } finally {
    clearTimeout(timeoutHandle);
    clearInterval(renewerHandle);
    clearInterval(abortPollerHandle);
    engineSignal.removeEventListener('abort', onEngineAbort);
  }
  // Past the timers: a renewal tick landing here would find the job already terminal, read that
  // as a lost lease and abort a run that has in fact succeeded.
  if (terminal) {
    await opts.onTerminal?.(job);
  }
};

const recordOutcome = async (opts: ExecuteJobOptions, outcome: RaceOutcome): Promise<boolean> => {
  const { job, workerId, jobsService } = opts;

  if (outcome.kind === 'handler-success') {
    const continuation = outcome.result && outcome.result.continuation === true ? outcome.result : undefined;
    // Whatever follows this run is inserted by the queue, in the transaction that ends it.
    const { recorded, bookedJobId } = await jobsService.recordSuccess(
      job.id,
      workerId,
      continuation && { state: continuation.state },
    );
    if (!recorded) {
      opts.onLostRace?.(job.id, 'success-after-lease-lost');
      return false;
    }
    opts.onJobSuccess?.(job.id, job.kind);
    if (continuation) {
      opts.onContinuation?.(job.id, job.kind, bookedJobId);
    } else if (bookedJobId !== undefined) {
      opts.onAnswered?.(job.id, job.kind, bookedJobId);
    }
    return true;
  }

  if (outcome.kind === 'aborted' && outcome.reason === ABORT_CANCEL) {
    const { recorded } = await jobsService.recordCancelled(job.id, workerId, true);
    if (!recorded) {
      opts.onLostRace?.(job.id, 'cancel-after-lease-lost');
      return false;
    }
    opts.onAnswerOwed?.(job.id);
    return true;
  }

  if (outcome.kind === 'aborted' && outcome.reason === ABORT_ENGINE) {
    // Preempted by shutdown: released without burning an attempt, so a rolling deploy cannot push
    // a healthy job to the dead-letter queue.
    const { outcome: release } = await jobsService.releaseClaim(job.id, workerId);
    if (release !== 'cancelled') {
      return false;
    }
    opts.onAnswerOwed?.(job.id);
    return true;
  }

  // Normalize aborts to typed errors so isErrorRetryable steers TimeoutError
  // / LeaseLostError to the non-retryable branch.
  let err: unknown;
  if (outcome.kind === 'handler-error') {
    err = outcome.error;
  } else if (outcome.reason === ABORT_TIMEOUT) {
    err = new TimeoutError(`Handler exceeded maxRuntimeMs (${job.maxRuntimeMs}ms)`);
  } else if (outcome.reason === ABORT_LEASE_LOST) {
    err = new LeaseLostError('Aborted: lease-lost');
  } else {
    err = new Error(`Aborted: ${outcome.reason}`);
  }

  // Only a handler's own error is deferred: an abort never is, even when the handler had raised it.
  if (outcome.kind === 'handler-error' && outcome.error instanceof InputsNotReadyError) {
    const deferral = await jobsService.deferRun(job.id, workerId, opts.deferralPolicy);
    if (deferral.outcome === 'deferred') {
      opts.onDeferred?.(job.id, job.kind, outcome.error, { runAfter: deferral.runAfter, delayMs: deferral.delayMs });
      return false;
    }
    if (deferral.outcome === 'cancelled') {
      if (deferral.answeringJobId !== undefined) {
        opts.onAnswered?.(job.id, job.kind, deferral.answeringJobId);
      }
      return true;
    }
    if (deferral.outcome === 'lost-race') {
      opts.onLostRace?.(job.id, 'defer-after-lease-lost');
      return false;
    }
  }

  const retryable = isErrorRetryable(err);
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // An abort ends the race but not the handler, so only a run whose handler raised the error is
  // known to have stopped writing by now.
  const handlerStillRunning = outcome.kind !== 'handler-error';
  const result = await jobsService.recordFailure(
    job.id,
    workerId,
    { message, stack },
    retryable,
    computeRetryDelayMs,
    handlerStillRunning,
  );
  if (result.outcome === 'lost-race') {
    opts.onLostRace?.(job.id, 'failure-after-lease-lost');
  } else if (result.outcome === 'retry') {
    opts.onJobFailure?.(job.id, job.kind, err, 'retry', result.runAfter);
  } else if (result.outcome === 'dlq') {
    opts.onJobFailure?.(job.id, job.kind, err, 'dlq', null);
  }
  const terminal = result.outcome === 'dlq' || result.outcome === 'cancelled';
  if (terminal && handlerStillRunning) {
    opts.onAnswerOwed?.(job.id);
  }
  return terminal;
};
