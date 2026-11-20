import type { JobLogLevel, JobStatus, TriggeredBy } from '@app/module/client';

/**
 * Declared locally rather than inferred from a router: `connectors.listRuns` and `jobs.listRuns`
 * both render `RunListItemSchema` from `back/src/features/app-router/jobs/run-contract.ts`, so
 * either output satisfies this shape structurally and no shared component ends up depending on one
 * router rather than the other.
 */
export interface JobRunListItem {
  id: string,
  kind: string,
  status: JobStatus,
  enqueuedAt: string,
  startedAt: string | null,
  claimedAt: string | null,
  finishedAt: string | null,
  processedTotal: number,
  expectedTotal: number | null,
  currentStep: string | null,
  attempt: number,
  maxAttempts: number,
  priority: number,
  runAfter: string,
  heartbeatAt: string | null,
  leaseExpiresAt: string | null,
  lastError: string | null,
  errorCount: number,
  triggeredBy: TriggeredBy,
  triggeredById: string | null,
  /** Absent for `connectors.listRuns`, whose `RunListItemSchema` output carries no payload at all. */
  payload?: string | null,
}

export interface JobRunHistory {
  inProgress: Array<JobRunListItem>,
  completed: Array<JobRunListItem>,
  inProgressCount: number,
  completedCount: number,
  /** Lets the client take its own clock's skew out before comparing to the instants above. */
  serverNow: string,
}

export interface JobLogLineData {
  id: string,
  level: JobLogLevel,
  message: string,
  detail: string | null,
  occurredAt: string,
}

/** One run; or, for a connector's live stream, a session with no run to introduce, read as a flat list. */
export interface JobLogGroup {
  runId: string | null,
  status: JobStatus | null,
  startedAt: string | null,
  lines: Array<JobLogLineData>,
}
