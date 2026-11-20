import type { DrizzleDB, JobContext, ProgressUpdate, StatementRecorder } from '@app/module';

export interface JobContextDeps {
  updateProgress: (jobId: string, progress: ProgressUpdate) => Promise<void>,
  saveStateSnapshot: (jobId: string, state: Record<string, unknown>) => Promise<void>,
}

export interface CreateJobContextOptions {
  jobId: string,
  tenantId: string,
  kind: string,
  interactive: boolean,
  payload: Record<string, unknown>,
  attempt: number,
  state: Record<string, unknown> | null,
  signal: AbortSignal,
  deps: JobContextDeps,
  runDb?: DrizzleDB,
  observation?: StatementRecorder,
}

export const createJobContext = (opts: CreateJobContextOptions): JobContext => ({
  jobId: opts.jobId,
  tenantId: opts.tenantId,
  kind: opts.kind,
  interactive: opts.interactive,
  payload: opts.payload,
  attempt: opts.attempt,
  state: opts.state,
  signal: opts.signal,
  updateProgress: (progress) => opts.deps.updateProgress(opts.jobId, progress),
  saveStateSnapshot: (state) => opts.deps.saveStateSnapshot(opts.jobId, state),
  runDb: opts.runDb,
  observation: opts.observation,
});
