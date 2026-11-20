import { ACTIVE_JOB_STATUSES, JOB_LEASE_MS, JOB_LOG_LEVELS, JOB_STATUSES, RUN_CLAIMABILITIES, TERMINAL_JOB_STATUSES, TRIGGERED_BY_VALUES } from '@app/module';
import type { JobLogLine, JobLogRunGroup, PendingRunListItem, RunDetail, RunListItem, RunSnapshot, TerminalRunStatus } from '@app/module';
import { z } from 'zod';
import { config } from '../../../config';
import { JOB_LOG_RETENTION_RUNS } from '../../../config-schema';
import { redactSecrets } from '../../../utils/log-capture';

export const RunSnapshotSchema = z.object({
  id: z.string(),
  status: z.enum(JOB_STATUSES),
  enqueuedAt: z.string(),
  startedAt: z.string().nullable(),
  claimedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  processedTotal: z.number(),
  expectedTotal: z.number().nullable(),
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  triggeredBy: z.enum(TRIGGERED_BY_VALUES),
  triggeredById: z.string().nullable(),
  askedByOthers: z.boolean(),
}).nullable();

/** Narrows a stopped run's status without asserting: the read selects on these three, nothing else. */
export const terminalRunStatus = (run: RunSnapshot | null): TerminalRunStatus | null =>
  TERMINAL_JOB_STATUSES.find((status) => status === run?.status) ?? null;

/** Narrows an in-flight run's status without asserting: the read selects on these two, nothing else. */
export const activeRunStatus = (run: RunSnapshot | null): 'queued' | 'running' | null =>
  ACTIVE_JOB_STATUSES.find((status) => status === run?.status) ?? null;

export const serialiseRun = (run: RunSnapshot | null) => (run === null ? null : {
  id: run.id,
  status: run.status,
  enqueuedAt: run.enqueuedAt.toISOString(),
  startedAt: run.startedAt?.toISOString() ?? null,
  claimedAt: run.claimedAt?.toISOString() ?? null,
  finishedAt: run.finishedAt?.toISOString() ?? null,
  processedTotal: run.processedTotal,
  expectedTotal: run.expectedTotal,
  attempt: run.attempt,
  maxAttempts: run.maxAttempts,
  triggeredBy: run.triggeredBy,
  triggeredById: run.triggeredById,
  askedByOthers: run.askedByOthers,
});

export const logRetentionRuns = (): number => config().jobs?.log_retention_runs ?? JOB_LOG_RETENTION_RUNS;

/** The counts beside a section are aggregates, so they hold past this cap. */
export const RUN_LIST_CAP = 50;

export const RunListItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.enum(JOB_STATUSES),
  enqueuedAt: z.string(),
  startedAt: z.string().nullable(),
  claimedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  processedTotal: z.number().int(),
  expectedTotal: z.number().int().nullable(),
  currentStep: z.string().nullable(),
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  priority: z.number().int(),
  runAfter: z.string(),
  heartbeatAt: z.string().nullable(),
  leaseExpiresAt: z.string().nullable(),
  lastError: z.string().nullable(),
  errorCount: z.number().int(),
  triggeredBy: z.enum(TRIGGERED_BY_VALUES),
  triggeredById: z.string().nullable(),
  absorbedAsk: z.boolean(),
  interactive: z.boolean(),
});

/**
 * `payload` is handler-defined, so it stays off `RunListItemSchema`: that schema also serves
 * `connectors.listRuns`, gated by a different capability than Settings > Jobs.
 */
export const JobRunListItemSchema = RunListItemSchema.extend({ payload: z.string().nullable() });

export const RunHistorySchema = z.object({
  inProgress: z.array(RunListItemSchema),
  completed: z.array(RunListItemSchema),
  inProgressCount: z.number().int(),
  completedCount: z.number().int(),
  /** Lets the client take its own clock's skew out before comparing to the instants above. */
  serverNow: z.string(),
});

export const JobRunHistorySchema = RunHistorySchema.extend({
  inProgress: z.array(JobRunListItemSchema),
  completed: z.array(JobRunListItemSchema),
});

export const emptyRunHistory = () => ({ inProgress: [], completed: [], inProgressCount: 0, completedCount: 0, serverNow: new Date().toISOString() });

/** Truncated so a browser tab is never handed an unbounded string; `…` marks that a payload was cut. */
export const PAYLOAD_CHAR_CAP = 2_000;

/**
 * Stable key order makes two runs of the same kind diffable. `null` for an empty payload rather
 * than `'{}'`, so the front can tell "nothing to show" from "an empty object was logged".
 */
export const serialisePayload = (payload: Record<string, unknown>): string | null => {
  const keys = Object.keys(payload).sort();
  if (keys.length === 0) {
    return null;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    sorted[key] = payload[key];
  }
  const redacted = redactSecrets(JSON.stringify(sorted));
  return redacted.length > PAYLOAD_CHAR_CAP ? `${redacted.slice(0, PAYLOAD_CHAR_CAP)}…` : redacted;
};

export const serialiseRunListItem = (run: RunListItem) => ({
  id: run.id,
  kind: run.kind,
  status: run.status,
  enqueuedAt: run.enqueuedAt.toISOString(),
  startedAt: run.startedAt?.toISOString() ?? null,
  claimedAt: run.claimedAt?.toISOString() ?? null,
  finishedAt: run.finishedAt?.toISOString() ?? null,
  processedTotal: run.processedTotal,
  expectedTotal: run.expectedTotal,
  currentStep: run.progressMessage,
  attempt: run.attempt,
  maxAttempts: run.maxAttempts,
  priority: run.priority,
  runAfter: run.runAfter.toISOString(),
  // The lease starts at its last renewal, which is the last time the worker was heard from.
  heartbeatAt: run.status === 'running' && run.leasedUntil !== null
    ? new Date(run.leasedUntil.getTime() - JOB_LEASE_MS).toISOString()
    : null,
  leaseExpiresAt: run.status === 'running' ? run.leasedUntil?.toISOString() ?? null : null,
  lastError: run.errorMessage,
  errorCount: run.errorCount,
  triggeredBy: run.triggeredBy,
  triggeredById: run.triggeredById,
  absorbedAsk: run.absorbedAsk,
  interactive: run.interactive,
});

export const serialiseJobRunListItem = (run: RunListItem) => ({
  ...serialiseRunListItem(run),
  payload: serialisePayload(run.payload),
});

/** `pending`'s own row: the base run-list contract plus what the queue's order is computed from. */
export const PendingRunListItemSchema = JobRunListItemSchema.extend({
  claimability: z.enum(RUN_CLAIMABILITIES),
});

export const serialisePendingRunListItem = (run: PendingRunListItem) => ({
  ...serialiseJobRunListItem(run),
  claimability: run.claimability,
});

/**
 * A run's detail view: the base run-list contract plus the successor `getRun` resolves for it.
 * Its lines are read apart, by `jobs.listRunLogs`.
 */
export const RunDetailSchema = JobRunListItemSchema.extend({
  answeredById: z.string().nullable(),
});

export const serialiseRunDetail = (run: RunDetail) => ({
  ...serialiseJobRunListItem(run),
  answeredById: run.answeredById,
});

export const LogLineSchema = z.object({
  id: z.string(),
  level: z.enum(JOB_LOG_LEVELS),
  message: z.string(),
  detail: z.string().nullable(),
  occurredAt: z.string(),
});

/** One run; or, for a connector's live stream, a session with no run to introduce, read as a flat list. */
export const LogGroupSchema = z.object({
  runId: z.string().nullable(),
  status: z.enum(JOB_STATUSES).nullable(),
  startedAt: z.string().nullable(),
  lines: z.array(LogLineSchema),
});

export const JobLogsSchema = z.object({ groups: z.array(LogGroupSchema) });

export const serialiseLogLine = (line: JobLogLine) => ({
  id: line.id,
  level: line.level,
  message: line.message,
  detail: line.detail,
  occurredAt: line.occurredAt.toISOString(),
});

export const serialiseLogGroup = (group: JobLogRunGroup) => ({
  runId: group.runId,
  status: group.status,
  startedAt: group.startedAt?.toISOString() ?? null,
  lines: group.lines.map(serialiseLogLine),
});
