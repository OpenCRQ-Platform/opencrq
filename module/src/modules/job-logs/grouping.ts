import type { JobStatus } from '../jobs/schema';
import type { JobLogLevel } from './schema';

export interface JobLogLine {
  id: string,
  level: JobLogLevel,
  message: string,
  detail: string | null,
  occurredAt: Date,
}

export interface JobLogRun {
  id: string,
  status: JobStatus,
  startedAt: Date | null,
  enqueuedAt: Date,
}

export interface JobLogRunGroup {
  runId: string,
  status: JobStatus,
  startedAt: Date | null,
  enqueuedAt: Date,
  lines: Array<JobLogLine>,
}

/** Runs arrive newest first and leave oldest first, which is the order the work happened in. */
export const groupRunLines = (
  runs: ReadonlyArray<JobLogRun>,
  rows: ReadonlyArray<JobLogLine & { jobId: string | null }>,
): Array<JobLogRunGroup> => {
  const linesByJobId = new Map<string, Array<JobLogLine>>();
  for (const run of runs) {
    linesByJobId.set(run.id, []);
  }
  for (const row of rows) {
    const bucket = row.jobId === null ? undefined : linesByJobId.get(row.jobId);
    bucket?.push({
      id: row.id,
      level: row.level,
      message: row.message,
      detail: row.detail,
      occurredAt: row.occurredAt,
    });
  }
  return runs
    .map((run) => ({
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      enqueuedAt: run.enqueuedAt,
      lines: linesByJobId.get(run.id) ?? [],
    }))
    .reverse();
};
