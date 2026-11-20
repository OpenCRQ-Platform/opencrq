import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_CATALOGUE_ENTRIES } from '@app/module';
import type { JobRegistration } from '@app/back/src/engines/job-runtime/handler-registry';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The job runtime's own modules build their database engine from the backend config while this
// file is still being evaluated, so the connection is resolved inside the factory rather than
// from its imports.
vi.mock('../../../../back/src/config', async () => {
  const setup = await import('../../setup/pg-config');
  const { SCORE_HISTORY_RETENTION_DAYS } = await import('@app/module');
  return {
    config: () => ({
      postgres: { ...setup.pgConfig, database: setup.getWorkerDbName() },
      jobs: { enabled: true },
      recompute: { score_history_retention_days: SCORE_HISTORY_RETENTION_DAYS },
    }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const workerFeatureNames = (): Array<string> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../../../../back/src/index-worker.ts'), 'utf8');
  return [...source.matchAll(/^import '\.\/features\/([\w-]+)';/gm)].map((match) => match[1]);
};

/**
 * The http process that serves `jobs.listJobKinds` registers no job handler, so the catalogue in
 * `module` cannot be read off the job runtime's registry at request time and is hand-kept instead.
 * This is what keeps the two from drifting apart: every kind the worker actually registers, with
 * the flags it registers, must be in the catalogue, and nothing else may be.
 */
describe('job catalogue / runtime registry agreement', () => {
  let registrations: Array<JobRegistration>;

  beforeAll(async () => {
    for (const name of workerFeatureNames()) {
      await import(`../../../../back/src/features/${name}/index.ts`);
    }
    const { listFeatures } = await import('../../../../back/src/features/features-manager');
    listFeatures().forEach((feature) => feature.activate(new AbortController().signal));
    const { jobRuntimeEngine } = await import('../../../../back/src/engines/job-runtime');
    registrations = jobRuntimeEngine.listRegisteredJobs();
  });

  it('registers exactly the catalogued kinds, with the same observed/daily/serialized flags and shared slots', () => {
    const registeredByKind = new Map(registrations.map(({ kind, options }) => [kind, options]));

    expect([...registeredByKind.keys()].sort()).toEqual(
      [...JOB_CATALOGUE_ENTRIES.map((entry) => entry.kind)].sort(),
    );

    for (const entry of JOB_CATALOGUE_ENTRIES) {
      const options = registeredByKind.get(entry.kind);
      expect(options).not.toBeUndefined();
      expect({
        observed: options?.observed === true,
        daily: options?.daily === true,
        serialized: options?.serialized === true,
        serializedWith: options?.serializedWith,
      }).toEqual({ observed: entry.observed, daily: entry.daily, serialized: entry.serialized, serializedWith: entry.serializedWith });
    }
  });
});
