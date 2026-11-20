import type { JobStatus, TriggeredBy } from './schema';
import { StructuredError } from '@app/utils';
import type { DrizzleDB } from '../../db';
import type { StatementRecorder } from '../../db/statement-observation';

export type { JobStatus, TriggeredBy };

export const JOBS_CHANGED_CHANNEL = 'jobs_changed';

/** How long a claim holds without renewal: the worker renews well within it, the reaper waits for it. */
export const JOB_LEASE_MS = 30_000;

export interface EnqueueJobOptions {
  kind: string,
  tenantId: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
  priority?: number,
  runAfter?: Date,
  maxRuntimeMs?: number,
  maxAttempts?: number,
  bounded?: boolean,
  triggeredBy?: TriggeredBy,
  triggeredById?: string,
  /** Seeds the new row's resume state, so a continuation starts where the run before it stopped. */
  stateSnapshot?: Record<string, unknown>,
  /**
   * Whether somebody waits on this run's result. The enqueue site is the only place that knows it,
   * since it alone sees both who asked and what the run will do; it defaults to `false` so a site
   * that has not thought about it books a sweep rather than claiming a waiter it cannot name.
   */
  interactive?: boolean,
  /**
   * Leaves an active row holding the key or the payload as it is, where the default records the ask
   * on it and books a run after it. For an ask that a run already under way answers.
   */
  skipIfActive?: boolean,
}

export interface ScheduledBooking {
  status: JobStatus,
  finishedAt: Date | null,
}

/**
 * What makes a risk scenario's figures pending. The kinds and the key belong to the features that
 * book those jobs, so the caller names them and this module stays unaware of them.
 */
export interface ScenarioComputation {
  riskScenarioId: string,
  /** A run of this kind is pending for the scenario when its payload names it, or names none (a tenant-wide run). */
  recomputeKind: string,
  /** The idempotency key the scenario's own simulation is booked under. */
  simulationKey: string,
  /** Kinds whose any active run may still produce the scenario's figures, whatever their payload. */
  tenantWideKinds: ReadonlyArray<string>,
}

export interface EnqueueJobResult {
  jobId: string,
  alreadyExisted: boolean,
}

/** What a terminal transition hands back, `absorbedAsk` being the debt it leaves its caller to settle. */
export interface SettledJob {
  id: string,
  absorbedAsk: boolean,
  absorbedAskInteractive: boolean,
}

/** `bookedJobId` names the run booked in the same transaction: a continuation, or the answer. */
export interface RecordSuccessResult {
  recorded: boolean,
  bookedJobId?: string,
}

export interface ListJobsFilters {
  tenantId?: string,
  kind?: string,
  status?: JobStatus | ReadonlyArray<JobStatus>,
  limit?: number,
  offset?: number,
}

export interface RunSnapshot {
  id: string,
  kind: string,
  status: JobStatus,
  enqueuedAt: Date,
  startedAt: Date | null,
  claimedAt: Date | null,
  finishedAt: Date | null,
  processedTotal: number,
  expectedTotal: number | null,
  attempt: number,
  maxAttempts: number,
  triggeredBy: TriggeredBy,
  triggeredById: string | null,
  askedByOthers: boolean,
}

export interface ActiveRunCounts {
  queued: number,
  running: number,
}

/** Kept server-side: `payloadHash`, `idempotencyKey`, `stateSnapshot`, `claimedBy`, and an error's `stack`. */
export interface RunListItem {
  id: string,
  kind: string,
  status: JobStatus,
  enqueuedAt: Date,
  startedAt: Date | null,
  claimedAt: Date | null,
  finishedAt: Date | null,
  processedTotal: number,
  expectedTotal: number | null,
  progressMessage: string | null,
  attempt: number,
  maxAttempts: number,
  priority: number,
  runAfter: Date,
  leasedUntil: Date | null,
  errorMessage: string | null,
  errorCount: number,
  triggeredBy: TriggeredBy,
  triggeredById: string | null,
  payload: Record<string, unknown>,
  absorbedAsk: boolean,
  interactive: boolean,
}

export interface RunCounts {
  active: number,
  terminal: number,
}

export interface RetentionBounds {
  runOlderThan: Date,
}

export interface PurgeLimits {
  batchSize: number,
  maxBatches: number,
}

export interface PurgeResult {
  runsDeleted: number,
}

/** Two orderings rather than one column and a direction: a run in flight has no `finished_at`. */
export type RunListOrder = 'enqueued-asc' | 'finished-desc';

/**
 * Whether a queued run would be the one a worker claims next, from this tenant's own view of the
 * queue: `'waiting-for-schedule'` when `runAfter` has not come due, `'blocked-by-sibling'` when a
 * run of the same kind is already `running` with a live lease, `'next'` otherwise. The queue is
 * global and several workers pull from it in parallel, so this is a property of the tenant's own
 * rows, not a promise about when any of them runs.
 */
export const RUN_CLAIMABILITIES = ['next', 'waiting-for-schedule', 'blocked-by-sibling'] as const;
export type RunClaimability = (typeof RUN_CLAIMABILITIES)[number];

export interface PendingRunListItem extends RunListItem {
  claimability: RunClaimability,
}

export interface RunDetail extends RunListItem {
  /** The successor run honouring `absorbedAsk`, once one has been booked. */
  answeredById: string | null,
}

/** `'duration'` sorts on `finished_at - claimed_at`, the expression the duration column displays. */
export const RUN_SORT_KEYS = [
  'enqueuedAt', 'startedAt', 'claimedAt', 'finishedAt', 'kind', 'status', 'triggeredBy', 'attempt', 'priority', 'duration',
] as const;
export type RunSortKey = (typeof RUN_SORT_KEYS)[number];

/** Every run across every kind, filtered, sorted and paged server-side, for the Runs view. */
export interface RunQuery {
  tenantId: string,
  kinds: ReadonlyArray<string> | null,
  statuses: ReadonlyArray<JobStatus> | null,
  triggeredBy: ReadonlyArray<TriggeredBy> | null,
  enqueuedFrom: Date | null,
  enqueuedTo: Date | null,
  startedFrom: Date | null,
  startedTo: Date | null,
  finishedFrom: Date | null,
  finishedTo: Date | null,
  /** Matches `kind`, `progress_message`, `error_message` and the payload's own JSON text. */
  search: string | null,
  sortBy: RunSortKey,
  sortDesc: boolean,
  limit: number,
  offset: number,
}

export interface RunListPage<T = RunListItem> {
  items: ReadonlyArray<T>,
  total: number,
}

export interface QueuePage {
  limit: number,
  offset: number,
}

/** One page per section, and the kinds this tenant's queue serializes: the only two things a
 * caller supplies that `RunQuery` does not already carry for the three status-only sections. */
export interface QueueQuery {
  tenantId: string,
  /** Kinds that may not have two runs in flight for one tenant, read from the static catalogue
   * since the job runtime's own registry is empty in the http process. */
  serializedKinds: ReadonlyArray<string>,
  /** Groups of kinds sharing one per-tenant slot, from the same catalogue. */
  sharedSlots: ReadonlyArray<ReadonlyArray<string>>,
  pending: QueuePage,
  running: QueuePage,
  failed: QueuePage,
  succeeded: QueuePage,
}

export interface QueueSections {
  pending: RunListPage<PendingRunListItem>,
  running: RunListPage,
  failed: RunListPage,
  succeeded: RunListPage,
}

export interface JobErrorRecord {
  id: string,
  occurredAt: Date,
  attempt: number,
  retryable: boolean,
  message: string,
}

/** What one job kind currently shows: a run in flight, the last one that stopped, either or neither. */
export interface RunSummary {
  kind: string,
  activeRun: RunSnapshot | null,
  lastTerminalRun: RunSnapshot | null,
}

/** `runAfter` is when the queue hands the run out again, stamped by the database clock. */
export type FailureOutcome =
  | { outcome: 'retry', runAfter: Date }
  | { outcome: 'dlq' }
  /** A cancel reached the run before it could be retried. */
  | { outcome: 'cancelled' }
  | { outcome: 'lost-race' };

/** `runAfter` is stamped by the database clock, like a retry's, and `delayMs` measured on it. */
export type DeferOutcome =
  | { outcome: 'deferred', runAfter: Date, delayMs: number }
  | { outcome: 'expired' }
  /** A cancel reached the run before it could be deferred. */
  | { outcome: 'cancelled', answeringJobId: string | undefined }
  | { outcome: 'lost-race' };

/** `cancelled` when a cancel reached the run before it could be released. */
export type ReleaseOutcome = { outcome: 'released' } | { outcome: 'cancelled' } | { outcome: 'lost-race' };

export interface ProgressUpdate {
  processedTotal?: number,
  expectedTotal?: number | null,
  /** Null clears it, undefined leaves it. */
  message?: string | null,
}

/** A (kind, tenant) pair a worker still holds for a serialized kind, past the job row's own status. */
export interface SerializedSlot {
  kind: string,
  tenantId: string,
}

export interface ClaimedJob {
  id: string,
  tenantId: string,
  kind: string,
  payload: Record<string, unknown>,
  attempt: number,
  maxAttempts: number,
  maxRuntimeMs: number,
  bounded: boolean,
  stateSnapshot: Record<string, unknown> | null,
  processedTotal: number,
  expectedTotal: number | null,
  leasedUntil: Date,
  triggeredBy: TriggeredBy,
  triggeredById: string | null,
  interactive: boolean,
}

export interface JobContext<TPayload = Record<string, unknown>, TState = Record<string, unknown>> {
  readonly jobId: string,
  readonly tenantId: string,
  readonly kind: string,
  readonly interactive: boolean,
  readonly payload: TPayload,
  readonly attempt: number,
  readonly state: TState | null,
  readonly signal: AbortSignal,
  updateProgress: (progress: ProgressUpdate) => Promise<void>,
  saveStateSnapshot: (state: TState) => Promise<void>,
  /**
   * Present when the job registered as observed: a Drizzle instance over the shared pool whose
   * logger records every statement of the run. The handler must build its services on it, or
   * its reads escape the subscription.
   */
  readonly runDb?: DrizzleDB,
  readonly observation?: StatementRecorder,
}

/** What the runtime acts on once the run's row is terminal, which is past the handler's reach. */
export interface JobRunResult<TState = Record<string, unknown>> {
  /** Work was left behind the run's own bound: the runtime books it again, through the dedupe. */
  continuation?: boolean,
  /**
   * Where the continuation resumes, in the shape the handler reads back from `ctx.state`. The run's
   * own snapshot cannot serve: the booking is an insert, so the new row starts with no state unless
   * one is handed over here, and a key the handler does not read resumes it from the beginning.
   */
  state?: TState,
}

export type JobHandler<TPayload = Record<string, unknown>, TState = Record<string, unknown>> = (
  ctx: JobContext<TPayload, TState>,
) => Promise<JobRunResult<TState> | void>;

export class NonRetryableError extends StructuredError {
  override readonly name: string = 'NonRetryableError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { data: {}, ...options });
  }
}

// Retryable by default: timeouts might be linked to network or IO latency, thus being succeed on retry
export class TimeoutError extends StructuredError {
  override readonly name: string = 'TimeoutError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { data: {}, ...options });
  }
}

// Non-retryable: another worker owns the job. recordFailure's claimed_by fence
// will 0-row into the lost-race branch.
export class LeaseLostError extends NonRetryableError {
  override readonly name: string = 'LeaseLostError';

  public readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.context = context;
  }
}

/**
 * The run's inputs are on their way but not there yet. The runtime puts the run back in the queue
 * without recording an error or spending an attempt, until it is older than the deferral policy
 * allows; past that it fails as the NonRetryableError it is, which is also how any caller other
 * than the runtime reads it.
 */
export class InputsNotReadyError extends NonRetryableError {
  override readonly name: string = 'InputsNotReadyError';
}

export const isErrorRetryable = (err: unknown): boolean => {
  if (err instanceof NonRetryableError) {
    return false;
  }
  return true;
};
