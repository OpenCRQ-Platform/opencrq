import { uuidv7 } from 'uuidv7';
import type { JobDependencyAccess } from './schema';
import type { InferRepository } from '../../registry';
import { defineService } from '../../registry';
import { jobDependenciesRepository } from './repository';

export interface JobDependencyRow {
  jobKind: string,
  tenantId: string,
  tableName: string,
  access: JobDependencyAccess,
}

export interface JobObservation {
  reads: Array<string>,
  writes: Array<string>,
}

/** What a run hands the dispatcher: its observation, and whether `job_dependencies` holds it. */
export interface CompletedRunObservation {
  observation: JobObservation,
  /** False when the run could not write it: `job_dependencies` still holds the previous set. */
  persisted: boolean,
}

const writeObservation = async (
  repo: InferRepository<typeof jobDependenciesRepository>,
  jobKind: string,
  tenantId: string,
  observation: JobObservation,
): Promise<void> => {
  await repo.deleteDependencies(jobKind, tenantId);
  const rows = [
    ...observation.reads.map((tableName) => ({ tableName, access: 'read' as const })),
    ...observation.writes.map((tableName) => ({ tableName, access: 'write' as const })),
  ];
  if (rows.length > 0) {
    await repo.insertDependencies(rows.map((row) => ({ id: uuidv7(), jobKind, tenantId, ...row })));
  }
};

export const jobDependenciesService = defineService(
  'jobDependencies',
  jobDependenciesRepository,
).implement({
  getAllObservations: async ({ repo }): Promise<Array<JobDependencyRow>> => repo.findAllDependencies(),

  replaceObservation: async ({ atomic }, jobKind: string, tenantId: string, observation: JobObservation): Promise<void> => {
    await atomic(async ({ repo }) => writeObservation(repo, jobKind, tenantId, observation));
  },

  /**
   * Adds `observation` to the persisted set rather than replacing it, and returns the union: for a
   * run that covered only part of its job's work, whose reads say nothing of the part it skipped.
   */
  mergeObservation: async ({ atomic }, jobKind: string, tenantId: string, observation: JobObservation): Promise<JobObservation> =>
    atomic(async ({ repo }) => {
      const held = await repo.findDependencies(jobKind, tenantId);
      const tablesOf = (access: JobDependencyAccess, added: Array<string>) => [...new Set([
        ...held.filter((row) => row.access === access).map((row) => row.tableName),
        ...added,
      ])].sort();
      const merged: JobObservation = { reads: tablesOf('read', observation.reads), writes: tablesOf('write', observation.writes) };
      await writeObservation(repo, jobKind, tenantId, merged);
      return merged;
    }),
});
