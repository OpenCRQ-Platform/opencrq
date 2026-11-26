import type { CompletedRunObservation, SerializedSlot } from '@app/module';
import { createServices, deferralPolicyFor, jobLogsService, jobsService, SUBSCRIBE_ALL_SENTINEL, workersService } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { config, getProcessName } from '../../config';
import { JOB_DRAIN_MS } from '../../utils/shutdown-budget';
import { flushLogCapture } from '../../utils/log-capture';
import { createLogger } from '../../utils/logger';
import { dbEngine } from '../db';
import { registerEngine } from '../engines-manager';
import { recordUnattributedRun } from '../../utils/recompute-metrics';
import { executeJob, LEASE_MS } from './execution-loop';
import { HandlerRegistry } from './handler-registry';
import { startListenNotifyListener } from './listen-notify-listener';
import { createRunObservation, finalizeRunObservation } from './run-observation';
import { createGracefulDrain } from './shutdown';

const JOB_RUNTIME_ENGINE_KEY = 'job-runtime';

const REAP_INTERVAL_MS = 60_000;
const HANDLER_SETTLE_GRACE_MS = 60_000;

const handlerRegistry = new HandlerRegistry();

export interface RunLifecycleListener {
  onRunStarted?: (kind: string, tenantId: string) => void,
  /**
   * The run's own observation, or null when the run failed or was unobserved. Fired once the
   * handler has settled, which an abort (timeout, lease lost, shutdown) outlives.
   */
  onRunCompleted?: (kind: string, tenantId: string, durationMs: number, observation: CompletedRunObservation | null) => void,
}

const runListeners: Array<RunLifecycleListener> = [];

const startJobRuntimeEngine = (signal: AbortSignal) => {
  const logger = createLogger({ engine: JOB_RUNTIME_ENGINE_KEY });
  const { logTrace, logWarn, logWarnFromError, logFromError } = logger;

  const jobsConfig = config().jobs;
  if (!jobsConfig || !jobsConfig.enabled) {
    logTrace('Job runtime engine disabled by config');
    return {};
  }
  const maxConcurrent = jobsConfig.max_concurrent;
  const pollingFallbackMs = jobsConfig.polling_fallback_ms;
  // A deferred run waits for a job the recompute dispatcher books, at most its debounce cap later.
  const deferralPolicy = deferralPolicyFor(config().recompute.debounce_cap_ms);

  const workerId = uuidv7();
  const activeJobs = new Set<string>();
  /*
   * The runs whose handler has not settled, which outlives `activeJobs`: a run releases its
   * concurrency slot as soon as `executeJob` returns, and an aborted one returns while its
   * handler is still reading and writing. Shutdown drains on this rather than on the slot, or it
   * would end the database pools under a handler that is still using them. Keyed by job id, holding its kind.
   */
  const unsettledHandlers = new Map<string, string>();
  /*
   * The serialized (kind, tenant) pairs this worker holds, which the queue's own "no sibling is
   * running" test cannot answer for: an aborted run's row goes terminal while its handler is still
   * reading and writing, and the poll and the `jobs_changed` listener both claim during that window.
   * Held from the claim to the settle, so the pair is covered whatever the job row says meanwhile.
   */
  const heldSerializedSlots = new Map<string, SerializedSlot>();
  // Incremented synchronously before `await claimNext` so concurrent drain
  // triggers (NOTIFY, polling, initial kick) can't all read size=0 and breach
  // maxConcurrent. Released on no-claim / error; otherwise transferred to activeJobs.
  let reservedSlots = 0;

  const services = createServices([jobsService, workersService, jobLogsService], dbEngine.controlDb).withOrigin({ type: 'system' });

  const inFlightCount = () => activeJobs.size + reservedSlots;

  const tryClaimAndRun = async (): Promise<boolean> => {
    if (signal.aborted || inFlightCount() >= maxConcurrent) {
      return false;
    }
    const kinds = handlerRegistry.listKinds();
    if (kinds.length === 0) {
      return false;
    }

    reservedSlots += 1;
    let claimed;
    try {
      claimed = await services.jobs.claimNext(
        workerId,
        kinds,
        LEASE_MS,
        handlerRegistry.listSerializedKinds(),
        [...heldSerializedSlots.values()].flatMap((slot) => handlerRegistry.slotMates(slot.kind)
          .map((kind) => ({ kind, tenantId: slot.tenantId }))),
        handlerRegistry.listSharedSlots(),
      );
    } catch (err) {
      reservedSlots -= 1;
      logFromError(err, 'claimNext failed');
      return false;
    }
    if (!claimed) {
      reservedSlots -= 1;
      return false;
    }

    activeJobs.add(claimed.id);
    unsettledHandlers.set(claimed.id, claimed.kind);
    reservedSlots -= 1;

    const slotKey = `${claimed.kind}\u0000${claimed.tenantId}`;
    if (handlerRegistry.isSerialized(claimed.kind)) {
      heldSerializedSlots.set(slotKey, { kind: claimed.kind, tenantId: claimed.tenantId });
    }
    const releaseSerializedSlot = () => heldSerializedSlots.delete(slotKey);

    const registration = handlerRegistry.getOptions(claimed.kind);
    const observation = registration?.observed ? createRunObservation(dbEngine.pool) : undefined;

    const startedAtMs = Date.now();
    let succeeded = false;
    runListeners.forEach((listener) => listener.onRunStarted?.(claimed.kind, claimed.tenantId));

    let markHandlerSettled = (): void => {};
    const handlerSettled = new Promise<void>((resolve) => {
      markHandlerSettled = resolve;
    });
    let answerOwedFor: string | undefined;

    void executeJob({
      job: claimed,
      workerId,
      jobsService: services.jobs,
      handlerRegistry,
      engineSignal: signal,
      deferralPolicy,
      runDb: observation?.db,
      observation: observation?.recorder,
      onStarted: (job) => {
        logTrace(`Attempt ${job.attempt} of ${job.maxAttempts} started`, { jobId: job.id, kind: job.kind });
      },
      onLostRace: (jobId, reason) => {
        logTrace('Lost lease race during execute', { jobId, reason, kind: claimed.kind });
      },
      onRenewError: (err, jobId) => {
        logFromError(err, 'renewLease transient error', { jobId, kind: claimed.kind });
      },
      onJobSuccess: (jobId, kind, continued) => {
        succeeded = true;
        // A segment that handed the rest of its pass to a continuation did not complete the job:
        // onContinuation logs its own line, so the console of a partial segment never reads as a success.
        if (!continued) {
          logTrace('Job completed successfully', { jobId, kind, attempt: claimed.attempt });
        }
      },
      onTerminal: async (job) => {
        try {
          await flushLogCapture();
          await services.jobLogs.trimToRecentRuns(job.tenantId, job.kind, jobsConfig.log_retention_runs);
        } catch (err) {
          logFromError(err, 'Trimming captured job logs failed', { jobId: job.id, kind: job.kind });
        }
      },
      onContinuation: (jobId, kind, continuationJobId) => {
        const next = continuationJobId === undefined ? 'the continuation already booked' : `run ${continuationJobId}`;
        logTrace(`Segment ended partial: the rest of the pass continues in ${next}`, { jobId, kind, continuationJobId });
      },
      onAnswered: (jobId, kind, answeringJobId) => {
        logTrace('Run booked the answer to an ask it absorbed', { jobId, kind, answeringJobId });
      },
      onJobFailure: (jobId, kind, err, outcome, nextAttemptAt) => {
        // A retry is a failure the runtime recovers from on its own: only the move to the DLQ alerts.
        if (outcome === 'retry') {
          logWarnFromError(err, 'Job failed, retry scheduled', {
            jobId, kind, attempt: claimed.attempt, maxAttempts: claimed.maxAttempts, retryAt: nextAttemptAt?.toISOString() ?? 'now',
          });
        } else {
          logFromError(err, 'Job failed, moved to DLQ', { jobId, kind, attempt: claimed.attempt });
        }
      },
      onDeferred: (jobId, kind, err, { runAfter, delayMs }) => {
        logTrace('Run deferred, its inputs are not ready yet', { jobId, kind, reason: err.message, runAfter });
        // `delayMs` counts from the deferral's transaction, which committed before this timer
        // starts, so the drain cannot come before `run_after` whatever the two clocks read.
        setTimeout(safeDrain, delayMs).unref();
      },
      onAnswerOwed: (jobId) => {
        answerOwedFor = jobId;
      },
      onHandlerSettled: markHandlerSettled,
    })
      .catch((err) => {
        logFromError(err, 'executeJob threw', { jobId: claimed.id, kind: claimed.kind });
      })
      .then(async (): Promise<CompletedRunObservation | null> => {
        // The concurrency slot answers for the run, never for the bookkeeping behind it: an
        // EXPLAIN queued on an exhausted pool would otherwise hold the slot for the process's life.
        activeJobs.delete(claimed.id);
        // Only a successful run replaces the persisted observation.
        if (observation && succeeded) {
          return finalizeRunObservation(dbEngine.pool, observation, claimed.kind, claimed.tenantId, claimed.interactive, (context) => {
            recordUnattributedRun(claimed.kind);
            logTrace('Unattributed read widened the subscription', { kind: claimed.kind, context });
          }, claimed.stateSnapshot !== null).then((persisted): CompletedRunObservation => ({ observation: persisted, persisted: true }))
            .catch((err): CompletedRunObservation => {
              // The previous set may be narrower than what this run read, so the dispatcher routes
              // on everything until a run persists again.
              logFromError(err, 'observation persistence failed, subscription widened', { jobId: claimed.id, kind: claimed.kind });
              return { observation: { reads: [SUBSCRIBE_ALL_SENTINEL], writes: [] }, persisted: false };
            });
        }
        return null;
      })
      .then(async (completed) => {
        // An aborted run returns while its handler is still reading and writing: announcing the
        // completion now would let a follow-up start a second run of the same (kind, tenant), and
        // the duration fed to the debounce would undercount what the run actually cost. The wait is
        // bounded because a handler that never honours its abort would otherwise leave the
        // dispatcher holding that (kind, tenant) as running for the life of the process.
        await Promise.race([handlerSettled, new Promise<void>((resolve) => {
          setTimeout(resolve, HANDLER_SETTLE_GRACE_MS).unref();
        })]);
        releaseSerializedSlot();
        if (answerOwedFor !== undefined) {
          // Past the wait above the interrupted handler has stopped, or spent its grace, so the key
          // it held is free and the ask it absorbed can have a run of its own.
          await services.jobs.answerAbsorbedAsk(answerOwedFor)
            .then((answeringJobId) => {
              if (answeringJobId !== undefined) {
                logTrace('Run booked the answer to an ask it absorbed', { jobId: claimed.id, kind: claimed.kind, answeringJobId });
              }
            })
            .catch((err: unknown) => {
              logFromError(err, 'Answering the ask an interrupted run absorbed failed', { jobId: claimed.id, kind: claimed.kind });
            });
        }
        // Only now: the shutdown drain waits on this set, and an answer still owed when the process
        // exits is never booked.
        unsettledHandlers.delete(claimed.id);
        // `jobs_changed` fires on an insert or a return to `queued`, so a sibling that was refused
        // because this run held its slot, or because its kind is serialized per tenant, is announced
        // by nothing: without this it waits for the poll.
        safeDrain();
        const durationMs = Date.now() - startedAtMs;
        runListeners.forEach((listener) => listener.onRunCompleted?.(claimed.kind, claimed.tenantId, durationMs, completed));
      })
      .catch((err) => {
        activeJobs.delete(claimed.id);
        releaseSerializedSlot();
        unsettledHandlers.delete(claimed.id);
        safeDrain();
        logFromError(err, 'run finalization failed', { jobId: claimed.id, kind: claimed.kind });
      });

    return true;
  };

  const drainQueue = async (): Promise<void> => {
    while (!signal.aborted) {
      const claimed = await tryClaimAndRun();
      if (!claimed) {
        return;
      }
    }
  };

  let draining: Promise<void> | null = null;
  let drainRequested = false;

  /**
   * One drain loop at a time in this process. A claim that has not committed is invisible to the
   * next loop's "no sibling of this kind and tenant is running" test, so two loops claiming at once
   * put two runs of a serialized kind in flight; and the wake-ups arrive in bursts, six inserts
   * firing six notifications and two runs ending within a few milliseconds of each other. A wake-up
   * during a loop re-runs it once at the end rather than starting a second.
   */
  const safeDrain = (): void => {
    if (draining !== null) {
      drainRequested = true;
      return;
    }
    draining = drainQueue()
      .catch((err) => logFromError(err, 'drainQueue failed'))
      .finally(() => {
        draining = null;
        if (drainRequested) {
          drainRequested = false;
          safeDrain();
        }
      });
  };
  const safeReap = () => services.jobs.reapOrphans().catch((err) => logFromError(err, 'reapOrphans failed'));
  // Not tied to claiming a job: a worker holding nothing stamps nothing on the queue, so liveness
  // read from `jobs.claimed_by` cannot tell idle from absent.
  const safeHeartbeat = () => services.workers.heartbeat(workerId, getProcessName())
    .catch((err) => logFromError(err, 'worker heartbeat failed'));

  let pollingHandle: ReturnType<typeof setInterval> | undefined;
  let reapHandle: ReturnType<typeof setInterval> | undefined;
  let heartbeatHandle: ReturnType<typeof setInterval> | undefined;

  // Deferred from `start` to `onEnginesStarted` so the worker doesn't race the
  // DB engine's migration — `claimNext` against a missing `jobs` table would
  // unhandledRejection → process.exit(1).
  const onEnginesStarted = (): void => {
    if (signal.aborted) {
      return;
    }
    startListenNotifyListener({
      signal,
      onNotify: () => {
        safeDrain();
      },
      onListening: () => {
        safeDrain();
      },
    }).catch((err) => logFromError(err, 'LISTEN listener stopped unexpectedly'));

    pollingHandle = setInterval(() => {
      safeDrain();
    }, pollingFallbackMs);

    reapHandle = setInterval(() => {
      safeReap();
    }, REAP_INTERVAL_MS);

    safeHeartbeat();
    heartbeatHandle = setInterval(() => {
      safeHeartbeat();
    }, jobsConfig.heartbeat_interval_ms);

    safeDrain();

    logTrace('Job runtime engine started', { workerId, maxConcurrent, pollingFallbackMs });
  };

  const stop = () => {
    if (pollingHandle) {
      clearInterval(pollingHandle);
      pollingHandle = undefined;
    }
    if (reapHandle) {
      clearInterval(reapHandle);
      reapHandle = undefined;
    }
    if (heartbeatHandle) {
      clearInterval(heartbeatHandle);
      heartbeatHandle = undefined;
    }
  };

  signal.addEventListener('abort', stop, { once: true });

  const drainHandlers = createGracefulDrain({ size: () => unsettledHandlers.size + reservedSlots }, JOB_DRAIN_MS);

  return {
    onEnginesStarted,
    onEnginesStopping: async () => {
      if (!await drainHandlers()) {
        logWarn('Shutdown drain timed out, job handlers still running', {
          jobs: [...unsettledHandlers].map(([jobId, kind]) => ({ jobId, kind })),
          reservedSlots,
        });
      }
    },
    stop,
  };
};

export const jobRuntimeEngine = registerEngine({
  key: JOB_RUNTIME_ENGINE_KEY,
  start: startJobRuntimeEngine,
  api: {
    listRegisteredJobs: () => handlerRegistry.listRegistrations(),
    getHandler: (kind: string) => handlerRegistry.get(kind),
    addRunListener: (listener: RunLifecycleListener) => {
      runListeners.push(listener);
    },
  },
  registrationApi: {
    registerHandler: handlerRegistry.register,
  },
});
