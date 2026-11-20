import type { DrizzleDB, JobObservation } from '@app/module';
import {
  createServices, jobDependenciesService, schema, StatementRecorder, SUBSCRIBE_ALL_SENTINEL,
} from '@app/module';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

export interface RunObservation {
  db: DrizzleDB,
  recorder: StatementRecorder,
}

/**
 * A Drizzle instance over the shared pool whose logger attributes every statement of one run.
 * The recorder's EXPLAINs go to the same pool, beside the connection the run itself holds.
 */
export const createRunObservation = (pool: Pool): RunObservation => {
  const recorder = new StatementRecorder(async (sqlText, params) => {
    const result = await pool.query(sqlText, params);
    return result.rows;
  });
  return { db: drizzle(pool, { schema, logger: recorder }), recorder };
};

/**
 * Waits for the run's pending attributions and persists the observation for (kind, tenant) under
 * the job's own origin, so the writer tags the persistence transaction and the dispatcher drops it
 * as the job's echo. Returns what was persisted.
 *
 * `widen` adds the run's tables to the persisted set instead of replacing it, for a run that
 * resumed from a state: it read only what was left of the work, and a set narrowed to that would
 * stop waking the job on what the earlier runs of the same pass read.
 */
export const finalizeRunObservation = async (
  pool: Pool,
  observation: RunObservation,
  kind: string,
  tenantId: string,
  interactive: boolean,
  onUnattributed: (context: string) => void,
  widen = false,
): Promise<JobObservation> => {
  const resolved = await observation.recorder.resolve();
  resolved.unattributed.forEach(onUnattributed);
  const persisted: JobObservation = {
    reads: resolved.reads ?? [SUBSCRIBE_ALL_SENTINEL],
    writes: resolved.writes,
  };
  const services = createServices([jobDependenciesService], drizzle(pool, { schema }))
    .withOrigin({ type: 'job', tenantId, jobKind: kind, interactive });
  if (widen) {
    return services.jobDependencies.mergeObservation(kind, tenantId, persisted);
  }
  await services.jobDependencies.replaceObservation(kind, tenantId, persisted);
  return persisted;
};
